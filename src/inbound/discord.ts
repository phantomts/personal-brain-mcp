/**
 * Discord adapter — uses Interactions endpoint (slash commands), not gateway.
 *
 * Slash command pattern: /capture <text>
 *
 * Setup:
 *   1. Create a Discord app at https://discord.com/developers/applications
 *   2. Bot tab → Reset Token → save as DISCORD_BOT_TOKEN (not strictly needed
 *      for interactions, but keeps options open for richer replies later).
 *   3. General Information → Public Key → save as DISCORD_PUBLIC_KEY.
 *   4. wrangler secret put DISCORD_PUBLIC_KEY
 *      wrangler secret put DISCORD_APP_ID
 *      wrangler secret put DISCORD_BOT_TOKEN  (optional but recommended)
 *   5. Register the /capture slash command (one-time, see shortcuts/discord-setup.md).
 *   6. In Discord app settings → "Interactions Endpoint URL" set to:
 *        https://<your-worker>.workers.dev/inbound/discord
 *   7. Find your Discord user id (Settings → Advanced → Developer Mode → right-click
 *      your name → Copy User ID). Add `discord:<id>` to INBOUND_ALLOWED_USERS.
 *
 * Verification: Discord signs every request with Ed25519. We verify with
 * the public key. The Web Crypto API supports Ed25519 natively on Workers.
 */
import type { Adapter, NormalizedMessage } from "./types";
import type { Env } from "../index";

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;

export const discordAdapter: Adapter = {
  async verify(req, env) {
    const publicKey = (env as any).DISCORD_PUBLIC_KEY as string | undefined;
    if (!publicKey) return false;
    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");
    if (!signature || !timestamp) return false;

    // Clone so .parse can read the body again. Workers Request bodies are
    // single-use otherwise.
    const bodyText = await req.clone().text();
    const message = new TextEncoder().encode(timestamp + bodyText);
    const sig = hexToBytes(signature);
    const key = hexToBytes(publicKey);

    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "Ed25519" } as any,
        false,
        ["verify"],
      );
      return await crypto.subtle.verify("Ed25519" as any, cryptoKey, sig, message);
    } catch {
      return false;
    }
  },

  async parse(req) {
    const body = (await req.json()) as any;

    // Discord pings the endpoint when you save it in the dashboard. Respond
    // with type 1 to confirm. We use a sentinel return that the router
    // catches via the global PING_HANDLER below.
    if (body?.type === INTERACTION_TYPE_PING) {
      // Signal "ping" via a special non-message return. The router treats
      // null as "ignored"; we want a typed 200 with the right body, so the
      // router needs to handle this. See discord_ping_response below.
      (globalThis as any).__lastDiscordPing = true;
      return null;
    }

    if (body?.type !== INTERACTION_TYPE_APPLICATION_COMMAND) return null;
    const command = body?.data?.name;
    if (command !== "capture") return null;

    const textOpt = (body?.data?.options ?? []).find((o: any) => o.name === "text");
    const text: string | undefined = textOpt?.value;
    if (!text) return null;

    const user = body?.member?.user ?? body?.user;
    return {
      source: "discord",
      user_external_id: String(user?.id ?? ""),
      user_display: user?.username ?? "unknown",
      text,
      message_id: String(body?.id ?? ""),
      chat_id: String(body?.channel_id ?? ""),
    };
  },

  async reply(msg, text, env) {
    // For Interactions, the "reply" pattern is to POST a followup message
    // using the interaction token. But Discord requires the initial
    // response within 3 seconds. The router responds immediately via
    // discord_ping_response (below); this `reply` sends a followup
    // message to the channel via the bot token.
    const token = (env as any).DISCORD_BOT_TOKEN as string | undefined;
    if (!token || !msg.chat_id) return;
    await fetch(`https://discord.com/api/v10/channels/${msg.chat_id}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: text, message_reference: { message_id: msg.message_id } }),
    });
  },
};

/**
 * Discord requires an immediate response to interactions. The router
 * detects ping vs command and uses these helpers. The actual write to
 * the brain happens after the immediate ack.
 */
export function isDiscordPing(): boolean {
  const flag = (globalThis as any).__lastDiscordPing;
  (globalThis as any).__lastDiscordPing = false;
  return !!flag;
}

export function discordPingResponse(): Response {
  return new Response(JSON.stringify({ type: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function discordDeferredResponse(): Response {
  // Type 5 = deferred channel message; we'll send the followup separately.
  return new Response(JSON.stringify({ type: 5, data: { flags: 64 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
