/**
 * Cloudflare Worker entry for personal-brain-mcp.
 *
 * MCP transport: Streamable HTTP, stateless, protocol revision 2026-07-28
 * (with a compatibility path for 2025-03-26 / 2025-06-18 / 2025-11-25).
 *
 * Routes:
 *   GET  /health                                      public uptime check (no auth)
 *   POST /mcp                                         the MCP endpoint (MCP bearer / OAuth)
 *   GET|DELETE /mcp                                   405 — the GET stream was removed
 *   GET  /.well-known/oauth-protected-resource        RFC 9728 metadata (OAuth mode only)
 *   POST /ingest/<kind>                               write-only ingest (INGEST bearer)
 *   POST /inbound/<source>                            chat-bot webhooks (per-source verification)
 *   GET  /inbound/whatsapp                            Meta webhook verification handshake
 *   GET  /sse, POST /message                          removed — see MIGRATION-2026-07-28.md
 *
 * Auth model:
 *   MCP_BEARER_TOKEN            full tool access for LLM clients (default mode)
 *   OAUTH_ISSUER + MCP_RESOURCE OAuth 2.1 resource-server mode with audience binding
 *   INGEST_BEARER_TOKEN         write-only HTTP capture for iPhone Shortcuts
 *   per-source verification     cryptographic check for chat webhooks
 *   INBOUND_ALLOWED_USERS       allowlist of <source>:<userid>
 */
import { buildRegistry } from "./mcp";
import { authorize, protectedResourceMetadata } from "./auth";
import { handleMcpPost, json } from "./protocol/dispatch";
import { originAllowed } from "./protocol/headers";
import { LATEST_PROTOCOL_VERSION, SERVER_INFO, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol/versions";
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
  /** Comma-separated allowlist of browser origins; "*" to allow all. */
  MCP_ALLOWED_ORIGINS?: string;
  /** OAuth 2.1 resource-server mode (optional). */
  OAUTH_ISSUER?: string;
  OAUTH_JWKS_URL?: string;
  MCP_RESOURCE?: string;
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
   * wrangler.toml [triggers].crons.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDailyProactivePush(env).catch((e) => {
        console.error("[cron] proactive_push failed:", e);
      }),
    );
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: SERVER_INFO.name,
        version: SERVER_INFO.version,
        protocol: LATEST_PROTOCOL_VERSION,
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        transport: "streamable-http",
        endpoint: "/mcp",
      });
    }

    if (url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
      return protectedResourceMetadata(env);
    }

    // WhatsApp GET verification handshake.
    if (url.pathname === "/inbound/whatsapp" && req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
        return new Response(challenge ?? "", { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }

    const inboundMatch = url.pathname.match(/^\/inbound\/([a-z_]+)\/?$/);
    if (inboundMatch && req.method === "POST") {
      return handleInbound(req, env, inboundMatch[1]!, ctx);
    }

    const ingestMatch = url.pathname.match(/^\/ingest\/([a-z_]+)\/?$/);
    if (ingestMatch && req.method === "POST") {
      return handleIngest(req, env, ingestMatch[1]!);
    }

    // The deprecated HTTP+SSE transport. Tell old clients where to go instead
    // of failing in a confusing way.
    if (url.pathname === "/sse" || url.pathname === "/message") {
      return json(
        {
          error: "transport_removed",
          message:
            "The HTTP+SSE transport was removed. Use POST /mcp (Streamable HTTP). See MIGRATION-2026-07-28.md.",
          endpoint: "/mcp",
        },
        410,
      );
    }

    if (url.pathname === "/mcp") {
      // DNS-rebinding protection: reject browser origins that are not allowlisted.
      if (!originAllowed(req, env.MCP_ALLOWED_ORIGINS)) {
        return json({ jsonrpc: "2.0", error: { code: -32600, message: "Origin not allowed" } }, 403);
      }
      // The GET stream, DELETE session teardown and Mcp-Session-Id are gone.
      if (req.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }

      const auth = await authorize(req, env);
      if (!auth.ok) return auth.response!;

      return handleMcpPost(req, { registry: getRegistry(env) });
    }

    return new Response("not found", { status: 404 });
  },
};

/**
 * The registry is pure metadata plus handlers bound to this Worker's env, so
 * it is built once per isolate rather than once per request.
 */
let cachedRegistry: ReturnType<typeof buildRegistry> | null = null;
function getRegistry(env: Env) {
  if (!cachedRegistry) cachedRegistry = buildRegistry(env);
  return cachedRegistry;
}
