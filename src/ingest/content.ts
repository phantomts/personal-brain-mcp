/**
 * POST /ingest/content
 *
 * Share-sheet target for YouTube/podcast/article URLs.
 *
 * Body:
 * {
 *   "url": "https://...",
 *   "title": "...",       // optional; if missing, falls back to host
 *   "kind": "video"|"podcast"|"article"|"newsletter"  // optional; auto-detect from URL
 *   "duration_min": 12,   // optional
 *   "source": "youtube",  // optional
 *   "tags": ["ai","mcp"]  // optional
 * }
 */
import type { Env } from "../index";
import { createSupabase } from "../lib/supabase";

export async function ingestContent(body: unknown, env: Env): Promise<{ status: number; body: unknown }> {
  const b = body as any;
  if (!b?.url || typeof b.url !== "string") {
    return { status: 400, body: { error: "'url' required" } };
  }

  let kind: string = b.kind;
  if (!kind) {
    if (/youtube\.com|youtu\.be/.test(b.url)) kind = "video";
    else if (/spotify|apple\.co\/podcast|podcast/.test(b.url)) kind = "podcast";
    else kind = "article";
  }

  let host: string;
  try {
    host = new URL(b.url).host;
  } catch {
    return { status: 400, body: { error: "invalid url" } };
  }

  const supa = createSupabase(env);
  const row = {
    title: b.title || host,
    kind,
    url: b.url,
    source: b.source ?? host,
    duration_min: b.duration_min,
    tags: b.tags ?? [],
  };
  const { error } = await supa.from("content_queue").insert(row as any);
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true, kind, title: row.title } };
}
