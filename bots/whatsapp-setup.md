# WhatsApp bot setup

Status: **stubbed but not implemented.** This doc captures what you'd need to do if you decide it's worth the slog.

## Why it's not on by default

WhatsApp Business Cloud API (Meta) requires:

1. A **verified Meta Business** account. Verification = uploading business docs and waiting 1-7 days.
2. A **dedicated phone number** for the WhatsApp Business profile. **You cannot use your personal WhatsApp number** — it must be a number that's not currently registered on WhatsApp (consumer or business).
3. A Meta **App** registered in the developer portal with the WhatsApp product enabled.
4. **Display name approval** (1-3 days review by Meta).
5. **Webhook verification** via challenge token.
6. Once live, you pay per conversation for business-initiated messages (user-initiated messages within 24hr are free).

For personal capture, this is a lot of overhead vs. Telegram's "10 minutes free."

## When it might be worth it

- You have international friends/family who only use WhatsApp and you want them to ping the brain on your behalf (e.g. "Mom remembered her phone number was 555-xxxx")
- You're already running a Meta Business setup for something else and adding WhatsApp is incremental
- You want to push outbound notifications (briefings) to WhatsApp specifically

Otherwise: skip.

## What to fill in

The stub in `src/inbound/whatsapp.ts` has TODOs for:

1. **GET handshake** — Meta calls `GET /inbound/whatsapp?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y`. The Worker already handles this in `src/index.ts` — you only need to set `WHATSAPP_VERIFY_TOKEN`.

2. **POST signature verification** — Meta signs the request body with HMAC-SHA256 using `WHATSAPP_APP_SECRET`. Header: `X-Hub-Signature-256`. Implement in `verify()`:
   ```ts
   const got = req.headers.get("x-hub-signature-256")?.replace(/^sha256=/, "");
   const body = await req.clone().text();
   const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
   const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
   const wantHex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
   // constant-time compare wantHex vs got
   ```

3. **Parse** — payload is `body.entry[].changes[].value.messages[].text.body`. Sender id is `value.contacts[].wa_id`. Message id is `messages[].id`.

4. **Reply** — POST to:
   ```
   https://graph.facebook.com/v20.0/<WHATSAPP_PHONE_NUMBER_ID>/messages
   ```
   With:
   ```json
   {
     "messaging_product": "whatsapp",
     "to": "<wa_id>",
     "type": "text",
     "text": { "body": "<ack text>" }
   }
   ```
   Bearer auth with `WHATSAPP_ACCESS_TOKEN`.

## Steps if you're committed

1. https://business.facebook.com → create or verify Meta Business
2. https://developers.facebook.com → create an App → add **WhatsApp** product
3. App dashboard → WhatsApp → set up. Meta provides:
   - Phone Number ID
   - Temporary access token (24hr)
   - Permanent system user token (set up separately)
4. Generate your own verify token (any random string): `openssl rand -hex 16` → save as `WHATSAPP_VERIFY_TOKEN`
5. Push secrets:
   ```bash
   wrangler secret put WHATSAPP_VERIFY_TOKEN
   wrangler secret put WHATSAPP_APP_SECRET
   wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   wrangler secret put WHATSAPP_ACCESS_TOKEN
   ```
6. In Meta dashboard → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<your-worker>.workers.dev/inbound/whatsapp`
   - Verify Token: same as `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and Save**. Meta hits the GET endpoint.
7. Subscribe to webhook fields: `messages`.
8. Add your phone (the destination phone, not the bot's) as a test recipient until your business is fully approved.
9. Fill in the TODOs in `whatsapp.ts`.
10. Deploy and test.

## What I'd skip

The official "Meta Business Verification" process if you don't have a real business need. For *personal* messaging-to-self use cases, an unverified app in development mode works but can only message a small list of test numbers. That's fine for a private brain.

## Cost

- Free: webhook receipts (incoming messages)
- Free: business-initiated messages within 24hr of a user-initiated message
- Paid: business-initiated messages outside the 24hr window (~$0.01-0.15 per message depending on country)

For *receiving* user messages → routing to brain, you'd never pay. The paid tier is only if you start using WhatsApp for outbound briefings, which you don't need (use Telegram for that).
