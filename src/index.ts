/**
 * Cloudflare Worker entry for personal-brain-mcp.
 *
 * Routes:
 *   GET  /health             — public uptime check (no auth)
 *   GET  /sse                — MCP SSE stream (MCP bearer)
 *   POST /message            — MCP message ingress (MCP bearer)
 *   POST /ingest/<kind>      — write-only ingest endpoints (INGEST bearer)
 *   POST /inbound/<source>   — chat-bot webhooks (per-source verification)
 *   GET  /inbound/whatsapp   — Meta webhook verification handshake
 *
 * Auth model:
 *   MCP_BEARER_TOKEN         → full tool access for LLM clients
 *   INGEST_BEARER_TOKEN      → write-only HTTP capture for iPhone Shortcuts
 *   per-source verification  → cryptographic check for chat webhooks
 *                              (Telegram secret header, Discord Ed25519, etc.)
 *   INBOUND_ALLOWED_USERS    → comma-separated allowlist of <source>:<userid>
 */
import { buildServer } from "./mcp";
import { requireAuth } from "./auth";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { handleIngest } from "./ingest/router";
import { handleInbound } from "./inbound/router";
import { runDailyProactivePush } from "./cron/proactive_push";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  MCP_BEARER_TOKEN: string;
  INGEST_BEARER_TOKEN: string;
  INBOUND_ALLOWED_USERS?: string;
  // Cron push config (see src/cron/proactive_push.ts)
  CRON_PUSH_CHANNEL?: string;
  CRON_PUSH_CHAT_ID?: string;
  CRON_MIN_URGENCY?: string;
  CRON_LIMIT?: string;
  CRON_SUPPRESS_EMPTY?: string;
  // Per-source secrets — all optional; adapter denies if missing.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APP_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
}

export default {
  /**
   * Cron handler. Triggered by Cloudflare on the schedule defined in
   * wrangler.toml [triggers].crons. We dispatch by cron expression so
   * one Worker can host multiple scheduled jobs in the future.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Default cron: the daily proactive push.
    // If you add more cron entries to wrangler.toml, branch on event.cron.
    ctx.waitUntil(
      runDailyProactivePush(env).catch((e) => {
        console.error("[cron] proactive_push failed:", e);
      }),
    );
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "personal-brain-mcp" });
    }

    // WhatsApp GET verification handshake (Meta calls this when you save
    // the webhook URL in their dashboard).
    if (url.pathname === "/inbound/whatsapp" && req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
        return new Response(challenge ?? "", { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }

    // Inbound chat webhooks (Telegram, Discord, WhatsApp)
    const inboundMatch = url.pathname.match(/^\/inbound\/([a-z_]+)\/?$/);
    if (inboundMatch && req.method === "POST") {
      return handleInbound(req, env, inboundMatch[1]!, ctx);
    }

    // Ingest endpoints (HTTP, separate INGEST_BEARER_TOKEN)
    const ingestMatch = url.pathname.match(/^\/ingest\/([a-z_]+)\/?$/);
    if (ingestMatch && req.method === "POST") {
      return handleIngest(req, env, ingestMatch[1]!);
    }

    // MCP endpoints (full auth)
    const denied = requireAuth(req, env);
    if (denied) return denied;

    if (url.pathname === "/sse" && req.method === "GET") {
      return handleSse(req, env, ctx);
    }
    if (url.pathname === "/message" && req.method === "POST") {
      return handleMessage(req, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
};

let activeTransport: SSEServerTransport | null = null;

async function handleSse(_req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const server = buildServer(env);
  activeTransport = new SSEServerTransport("/message", writable as any);
  ctx.waitUntil(server.connect(activeTransport));
  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}

async function handleMessage(req: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (!activeTransport) return json({ error: "no active sse session" }, 409);
  const body = await req.json();
  await activeTransport.handlePostMessage(req as any, undefined as any, body);
  return new Response(null, { status: 202 });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
