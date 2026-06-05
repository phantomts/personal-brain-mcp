/**
 * Shared capture pipeline used by both /ingest/capture (HTTP) and
 * /inbound/* (chat bots). Same routing heuristics, same commit logic,
 * same result shape.
 */
import type { Env } from "../index";
import { createSupabase } from "../lib/supabase";
import OpenAI from "openai";

export type CommitResult =
  | { ok: true; routed_to: string; detail?: string }
  | { ok: false; error: string };

export async function commitCapture(text: string, env: Env, options?: { embed?: boolean }): Promise<CommitResult> {
  const cleaned = text.trim();
  if (!cleaned) return { ok: false, error: "empty text" };

  const supa = createSupabase(env);
  const route = routeText(cleaned);

  try {
    switch (route.tool) {
      case "shopping": {
        const { error } = await supa.from("shopping").insert(route.payload as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, routed_to: "shopping", detail: (route.payload as any).item };
      }
      case "reading": {
        const { error } = await supa.from("reading_list").insert(route.payload as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, routed_to: "reading_list" };
      }
      case "content": {
        const { error } = await supa.from("content_queue").insert(route.payload as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, routed_to: "content_queue" };
      }
      case "wishlist": {
        const { error } = await supa.from("wishlist").insert(route.payload as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, routed_to: "wishlist" };
      }
      case "journal":
      default: {
        // Always embed for chat-source journal entries — capture frequency is
        // low enough that the latency doesn't matter, and chronic missing
        // embeddings make ask_brain quality drop.
        const wantEmbed = options?.embed !== false;
        let embedding: number[] | null = null;
        if (wantEmbed) {
          try {
            const oai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
            const r = await oai.embeddings.create({ model: "text-embedding-3-small", input: cleaned });
            embedding = r.data[0]!.embedding;
          } catch {
            // soft-fail
          }
        }
        const { error } = await supa
          .from("memory")
          .insert({ ...(route.payload as any), embedding: embedding as any });
        if (error) return { ok: false, error: error.message };
        return {
          ok: true,
          routed_to: "memory",
          detail: `${(route.payload as any).type}${embedding ? "" : " (no embedding)"}`,
        };
      }
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

type Route = { tool: "shopping" | "reading" | "content" | "wishlist" | "journal"; payload: Record<string, unknown> };

function routeText(t: string): Route {
  const lower = t.toLowerCase();

  const urlMatch = t.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const url = urlMatch[0];
    if (/youtube\.com|youtu\.be|spotify|podcast|apple\.co\/podcast/.test(url)) {
      return {
        tool: "content",
        payload: {
          title: t.replace(url, "").trim() || "Untitled",
          kind: /youtu/.test(url) ? "video" : "podcast",
          url,
        },
      };
    }
    return { tool: "reading", payload: { title: t.replace(url, "").trim() || "Untitled", kind: "article", url } };
  }

  if (/^(buy|get|grab|pick up|need|add to (the )?list)\b/.test(lower) || /\b(grocery|groceries|hardware|amazon)\b/.test(lower)) {
    return { tool: "shopping", payload: { item: t.replace(/^(buy|get|grab|pick up|need|add to (the )?list)\s*/i, "") } };
  }
  if (/^(i want|want a|want the|would love|want to own)\b/.test(lower)) {
    return { tool: "wishlist", payload: { item: t.replace(/^(i want|want a|want the|would love|want to own)\s*/i, "") } };
  }
  if (/\b(decided|decision|i'm going to|going with|chose|chosen)\b/.test(lower)) {
    return { tool: "journal", payload: { type: "decision", body: t, occurred_at: new Date().toISOString() } };
  }
  if (/\b(grateful|gratitude|thank|thankful)\b/.test(lower)) {
    return { tool: "journal", payload: { type: "gratitude", body: t, occurred_at: new Date().toISOString() } };
  }
  return { tool: "journal", payload: { type: "journal", body: t, occurred_at: new Date().toISOString() } };
}
