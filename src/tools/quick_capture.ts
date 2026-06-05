/**
 * quick_capture — heuristic router that takes free text and decides where
 * it belongs. Lightweight rules; the LLM should still confirm before
 * committing for ambiguous inputs.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  text: z.string().min(1),
  commit: z.boolean().default(false).describe("If false, returns the routing suggestion only. If true, performs the insert."),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "quick_capture",
    "Take free-text input and route to the right table. By default returns a routing suggestion (commit=false). With commit=true, performs the insert. Routes journal, shopping items, reading list, content queue, contacts to call back, and gift ideas.",
    inputSchema,
    async ({ text, commit }) => {
      try {
        const routed = route(text);
        if (!commit) {
          return ok(
            `**Suggested route:** ${routed.tool}\n\n**Parsed:**\n\`\`\`json\n${JSON.stringify(routed.payload, null, 2)}\n\`\`\`\n\n_Re-run with commit=true to insert._`,
          );
        }
        // Commit
        switch (routed.tool) {
          case "shopping_list": {
            await ctx.supabase.from("shopping").insert(routed.payload as any);
            return ok(`Added to shopping list: ${(routed.payload as any).item}`);
          }
          case "reading_list": {
            await ctx.supabase.from("reading_list").insert(routed.payload as any);
            return ok(`Added to reading list.`);
          }
          case "content_queue": {
            await ctx.supabase.from("content_queue").insert(routed.payload as any);
            return ok(`Queued content.`);
          }
          case "log_journal": {
            let embedding: number[] | null = null;
            try {
              embedding = await ctx.embed.one(text);
            } catch {}
            await ctx.supabase.from("memory").insert({ ...(routed.payload as any), embedding: embedding as any });
            return ok(`Logged journal entry.`);
          }
          case "wishlist": {
            await ctx.supabase.from("wishlist").insert(routed.payload as any);
            return ok(`Added to wishlist.`);
          }
          default:
            return fail(`unhandled route ${routed.tool}`);
        }
      } catch (e) {
        return fail("quick_capture failed", e);
      }
    },
  );
}

type Route = { tool: string; payload: Record<string, unknown> };

function route(text: string): Route {
  const t = text.trim();
  const lower = t.toLowerCase();

  // URL → content queue or reading list
  const urlMatch = t.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const url = urlMatch[0];
    if (/youtube\.com|youtu\.be|spotify|podcast|apple\.co\/podcast/.test(url)) {
      return {
        tool: "content_queue",
        payload: { title: t.replace(url, "").trim() || "Untitled", kind: /youtube|youtu\.be/.test(url) ? "video" : "podcast", url },
      };
    }
    return {
      tool: "reading_list",
      payload: { title: t.replace(url, "").trim() || "Untitled", kind: "article", url },
    };
  }

  // Shopping list cues
  if (/^(buy|get|grab|pick up|need|add to (the )?list)\b/.test(lower) || /\b(grocery|groceries|hardware|amazon)\b/.test(lower)) {
    return { tool: "shopping_list", payload: { item: t.replace(/^(buy|get|grab|pick up|need|add to (the )?list)\s*/i, "") } };
  }

  // Wishlist cues
  if (/^(i want|want a|want the|would love|want to own)\b/.test(lower)) {
    return { tool: "wishlist", payload: { item: t.replace(/^(i want|want a|want the|would love|want to own)\s*/i, "") } };
  }

  // Decision cues → memory type=decision
  if (/\b(decided|decision|i'm going to|going with|chose|chosen)\b/.test(lower)) {
    return { tool: "log_journal", payload: { type: "decision", body: t, occurred_at: new Date().toISOString() } };
  }

  // Gratitude cues
  if (/\b(grateful|gratitude|thank|thankful)\b/.test(lower)) {
    return { tool: "log_journal", payload: { type: "gratitude", body: t, occurred_at: new Date().toISOString() } };
  }

  // Default: journal
  return { tool: "log_journal", payload: { type: "journal", body: t, occurred_at: new Date().toISOString() } };
}
