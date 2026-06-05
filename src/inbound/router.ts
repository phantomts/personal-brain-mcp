/**
 * Inbound chat router — source-agnostic webhook handler.
 *
 * Each chat platform (Telegram, Discord, etc.) registers an Adapter that
 * implements verify/parse/reply. The router:
 *   1. Loads the right adapter by URL segment
 *   2. Verifies the request (adapter-specific)
 *   3. Parses to NormalizedMessage
 *   4. Authorizes against INBOUND_ALLOWED_USERS allowlist
 *   5. Routes the text through the same logic as /ingest/capture
 *   6. Acks via adapter.reply()
 *
 * Discord is the most fiddly because of its Interactions protocol:
 * - PING events need an immediate type=1 response (no parse)
 * - Slash commands need a type=5 (deferred) response within 3s; the
 *   actual work + followup happens after.
 *
 * Telegram and WhatsApp are simpler: webhook in, parse, reply via API,
 * 200 OK.
 */
import type { Env } from "../index";
import { telegramAdapter } from "./telegram";
import { discordAdapter, isDiscordPing, discordPingResponse, discordDeferredResponse } from "./discord";
import { whatsappAdapter } from "./whatsapp";
import type { Adapter, NormalizedMessage } from "./types";
import { commitCapture } from "./capture_pipe";

const ADAPTERS: Record<string, Adapter> = {
  telegram: telegramAdapter,
  discord: discordAdapter,
  whatsapp: whatsappAdapter,
};

export async function handleInbound(
  req: Request,
  env: Env,
  source: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const adapter = ADAPTERS[source];
  if (!adapter) return json({ error: `unknown source: ${source}` }, 404);

  // 1. Verify provider signature/secret
  const okVerify = await adapter.verify(req, env);
  if (!okVerify) return new Response("unauthorized", { status: 401 });

  // 2. Parse to normalized shape
  let msg: NormalizedMessage | null;
  try {
    msg = await adapter.parse(req, env);
  } catch (e) {
    return json({ error: "parse failed", detail: String(e) }, 400);
  }

  // Discord ping handshake — adapter.parse() sets a flag; respond with type 1.
  if (source === "discord" && isDiscordPing()) {
    return discordPingResponse();
  }

  if (!msg) return new Response("ignored", { status: 200 });

  // 3. Authorize
  if (!isAllowed(msg, env)) {
    // 200 to prevent providers from disabling the webhook for repeated 401s.
    // For Discord, we still need to satisfy the 3s rule with a valid response.
    if (source === "discord") return discordDeferredResponse();
    return new Response("ignored: unauthorized user", { status: 200 });
  }

  // 4. Commit + reply
  //    For Discord: ack immediately (deferred), do the work in waitUntil,
  //    send followup via reply().
  //    For everything else: do the work inline (it's <500ms typically) and
  //    reply via the provider API.
  if (source === "discord") {
    ctx.waitUntil(processAndReply(adapter, msg, env));
    return discordDeferredResponse();
  }

  await processAndReply(adapter, msg, env);
  return new Response("ok", { status: 200 });
}

async function processAndReply(adapter: Adapter, msg: NormalizedMessage, env: Env): Promise<void> {
  try {
    const result = await commitCapture(msg.text, env);
    const ack = result.ok
      ? `✓ ${result.routed_to}${result.detail ? `: ${result.detail}` : ""}`
      : `✗ ${result.error}`;
    await adapter.reply(msg, ack, env).catch(() => {});
  } catch (e) {
    await adapter.reply(msg, `✗ error: ${String(e).slice(0, 200)}`, env).catch(() => {});
  }
}

function isAllowed(msg: NormalizedMessage, env: Env): boolean {
  // Allowlist format: "telegram:123456,discord:987654321"
  // Missing env var = deny all.
  const raw = (env as any).INBOUND_ALLOWED_USERS as string | undefined;
  if (!raw) return false;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(`${msg.source}:${msg.user_external_id}`);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
