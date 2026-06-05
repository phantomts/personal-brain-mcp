/**
 * Telegram adapter.
 *
 * Setup:
 *   1. Talk to @BotFather in Telegram, /newbot, get TELEGRAM_BOT_TOKEN.
 *   2. Generate a random TELEGRAM_WEBHOOK_SECRET (openssl rand -hex 32).
 *   3. wrangler secret put TELEGRAM_BOT_TOKEN
 *      wrangler secret put TELEGRAM_WEBHOOK_SECRET
 *   4. Tell Telegram to send updates to your Worker:
 *        curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *             -d "url=https://<your-worker>.workers.dev/inbound/telegram" \
 *             -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *   5. Find your Telegram user id (talk to @userinfobot). Add `telegram:<id>`
 *      to INBOUND_ALLOWED_USERS env var.
 *
 * Verification: Telegram includes the secret in `X-Telegram-Bot-Api-Secret-Token`.
 */
import type { Adapter, NormalizedMessage } from "./types";
import type { Env } from "../index";

export const telegramAdapter: Adapter = {
  async verify(req, env) {
    const want = (env as any).TELEGRAM_WEBHOOK_SECRET as string | undefined;
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (!want || !got) return false;
    if (want.length !== got.length) return false;
    let m = 0;
    for (let i = 0; i < got.length; i++) m |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return m === 0;
  },

  async parse(req) {
    const body = (await req.json()) as any;
    const m = body?.message ?? body?.edited_message;
    if (!m || typeof m.text !== "string") return null; // skip non-text events
    return {
      source: "telegram",
      user_external_id: String(m.from?.id ?? ""),
      user_display: m.from?.username || m.from?.first_name || "unknown",
      text: m.text,
      message_id: String(m.message_id ?? ""),
      chat_id: String(m.chat?.id ?? ""),
    };
  },

  async reply(msg, text, env) {
    const token = (env as any).TELEGRAM_BOT_TOKEN as string | undefined;
    if (!token || !msg.chat_id) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: msg.chat_id,
        text,
        reply_to_message_id: msg.message_id ? Number(msg.message_id) : undefined,
      }),
    });
  },
};
