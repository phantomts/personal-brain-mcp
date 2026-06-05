/**
 * Normalized inbound message shape. Every adapter parses its provider-
 * specific webhook payload into this.
 */
import type { Env } from "../index";

export type NormalizedMessage = {
  source: "telegram" | "discord" | "whatsapp" | "imessage" | "signal";
  user_external_id: string;       // Telegram user id, Discord user id, etc.
  user_display: string;           // For logs and replies
  text: string;                   // The actual message body
  message_id: string;             // Provider's message id (for reply threading)
  chat_id?: string;               // Channel/chat where reply goes
  attachments?: Array<{ kind: string; url: string; mime?: string }>;
};

export type AdapterResult =
  | { kind: "ok"; routed_to: string; detail?: string }
  | { kind: "ignore"; reason: string }
  | { kind: "error"; status: number; reason: string };

export interface Adapter {
  /** Verify the request is genuinely from this provider (signature/secret). */
  verify(req: Request, env: Env): Promise<boolean>;
  /** Parse the webhook payload into a NormalizedMessage. Return null to skip non-message events. */
  parse(req: Request, env: Env): Promise<NormalizedMessage | null>;
  /** Send an ack/reply back to the user via this provider's API. Best-effort. */
  reply(msg: NormalizedMessage, text: string, env: Env): Promise<void>;
}
