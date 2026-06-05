/**
 * POST /ingest/capture
 *
 * One-line free-text capture from a Shortcut, share sheet, or quick widget.
 * Uses the shared commitCapture pipeline so HTTP-side and chat-bot-side
 * stay consistent.
 *
 * Body:
 * {
 *   "text": "buy more coffee filters",
 *   "embed": true   // optional, default false for Shortcut latency
 * }
 */
import type { Env } from "../index";
import { commitCapture } from "../inbound/capture_pipe";

export async function ingestCapture(body: unknown, env: Env): Promise<{ status: number; body: unknown }> {
  const b = body as any;
  const text: string | undefined = b?.text;
  if (!text || typeof text !== "string" || !text.trim()) {
    return { status: 400, body: { error: "'text' (non-empty string) required" } };
  }
  // Shortcuts default to no embed for snappy feedback.
  const result = await commitCapture(text, env, { embed: b?.embed === true });
  if (!result.ok) return { status: 500, body: { error: result.error } };
  return { status: 200, body: { ok: true, routed_to: result.routed_to, detail: result.detail } };
}
