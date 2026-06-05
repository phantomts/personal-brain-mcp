/**
 * WhatsApp adapter — STUB.
 *
 * Not wired up by default because Meta's Cloud API requires:
 *   - A Meta Business account (verified)
 *   - A WhatsApp Business app
 *   - A dedicated phone number (cannot reuse personal WhatsApp)
 *   - 24-48hr review for production messaging
 *
 * If/when you decide it's worth the slog, fill in the TODOs below and add:
 *   WHATSAPP_VERIFY_TOKEN          (you set this; Meta uses it for webhook verification)
 *   WHATSAPP_APP_SECRET            (Meta provides for signature verification)
 *   WHATSAPP_PHONE_NUMBER_ID       (Meta provides per number)
 *   WHATSAPP_ACCESS_TOKEN          (Meta provides per app)
 *
 * Without these env vars, this adapter rejects all requests.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
import type { Adapter, NormalizedMessage } from "./types";

export const whatsappAdapter: Adapter = {
  async verify(req, env) {
    const verifyToken = (env as any).WHATSAPP_VERIFY_TOKEN as string | undefined;
    if (!verifyToken) return false;

    // Meta verifies webhook ownership via GET with hub.* params.
    // (We only see POST here normally; GET verification is handled in the
    // Worker entry as a special case if you want to support it.)

    // For POST requests, Meta signs the body with the app secret in
    // X-Hub-Signature-256. TODO: implement HMAC-SHA256 verification.
    // const sig = req.headers.get("x-hub-signature-256");
    // ...
    return false; // disabled until implemented
  },

  async parse(_req): Promise<NormalizedMessage | null> {
    // TODO: parse WhatsApp Cloud API payload:
    //   body.entry[].changes[].value.messages[].text.body
    //   body.entry[].changes[].value.contacts[].wa_id
    //   body.entry[].changes[].value.messages[].id
    return null;
  },

  async reply(_msg, _text, _env) {
    // TODO: POST to https://graph.facebook.com/v20.0/<phone_number_id>/messages
    // with { messaging_product: "whatsapp", to: msg.user_external_id, text: { body: text } }
  },
};
