# Telegram bot setup

Time: ~10 minutes. No business verification, no developer account, free forever.

## Steps

### 1. Create the bot

In Telegram, start a chat with **@BotFather**. Send:

```
/newbot
```

Follow prompts:
- Bot name: anything readable (e.g. `your Brain`)
- Username: must end in `bot` and be globally unique (e.g. `your_brain_bot` or `yourname_brain_bot`)

BotFather replies with a token like `123456789:ABCdefGHIjklMNOpqr...`. **Save this as `TELEGRAM_BOT_TOKEN`.**

Optional but recommended — restrict the bot so it only responds to direct messages (not random groups):
```
/setjoingroups → Disable
/setprivacy → Enable
```

### 2. Find your Telegram user ID

In Telegram, start a chat with **@userinfobot**. Send any message. It replies with your numeric user ID (e.g. `123456789`). **Save this.**

### 3. Generate a webhook secret

On your laptop:

```bash
openssl rand -hex 32
```

Save as `TELEGRAM_WEBHOOK_SECRET`.

### 4. Push secrets to the Worker

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put INBOUND_ALLOWED_USERS   # value: telegram:<your-user-id>
```

If you already have other users in `INBOUND_ALLOWED_USERS`, append: `telegram:123456,discord:987654`.

### 5. Register the webhook with Telegram

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-worker>.workers.dev/inbound/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Look for `"url":"https://.../inbound/telegram"` and `"has_custom_certificate":false`. The `pending_update_count` should be 0 (or low).

### 6. Test

Open your bot's chat in Telegram. Send:
```
test
```

Expected reply within a second or two: `✓ memory: journal`

Then try:
```
buy more coffee filters
```
Expected: `✓ shopping: more coffee filters`

```
https://www.youtube.com/watch?v=abc123 great talk on MCP
```
Expected: `✓ content_queue`

```
I want the Sony WH-1000XM6 headphones
```
Expected: `✓ wishlist`

```
decided to upgrade the HVAC this fall
```
Expected: `✓ memory: decision`

### 7. Verify in Supabase

Open Supabase Studio → `brain` schema → check that rows appeared in `shopping`, `content_queue`, `wishlist`, `memory`. The memory rows should have non-null embeddings (because chat sources always embed).

## If something fails

**No reply, no error in Telegram:**
- Check `wrangler tail` while sending a message. You should see a request log.
- If no request appears: the webhook isn't registered. Re-run step 5 and check `getWebhookInfo`.

**`401` in Worker logs:**
- `TELEGRAM_WEBHOOK_SECRET` doesn't match. Re-push both (Telegram side via step 5, Worker side via `wrangler secret put`).

**`200 ignored: unauthorized user`:**
- Your Telegram user ID isn't in `INBOUND_ALLOWED_USERS`. Verify with @userinfobot and re-push the env var.

**Bot replies `✗ <error>`:**
- The brain returned an error. Check the error string. Most common: Supabase migration not applied (run `supabase db push`).

## Optional: customize behavior

**Mute notifications:**
In Telegram, long-press the bot chat → notifications → mute. You'll still get the ack reply for confirmation; it just won't ping you.

**Pin the bot:**
Long-press the chat → Pin to Chats. Now it's always at the top of your Telegram list. Tap-tap-type-send = capture.

**Set bot commands** (shows a `/` menu when you tap the input):
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
  -H "content-type: application/json" \
  -d '{"commands":[
    {"command":"start","description":"How to use this bot"},
    {"command":"help","description":"Show capture patterns"}
  ]}'
```

(Current code doesn't handle `/start` or `/help` specially — they'd route to `memory` as journal. Could add command handling in the Telegram adapter if you care.)

## Rotating the bot token

If you ever leak the bot token:
1. `/revoke` in BotFather → get a new token
2. `wrangler secret put TELEGRAM_BOT_TOKEN` with the new value
3. Re-run step 5 (setWebhook) with the new token

The webhook secret is independent and rotates separately.
