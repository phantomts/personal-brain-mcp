/**
 * reading_list — to-read, reading, finished. Books, articles, papers, essays.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "update_status", "rate"]).default("get"),
  status: z.enum(["to_read", "reading", "finished", "abandoned", "all"]).default("all"),
  kind: z.enum(["book", "article", "paper", "essay"]).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  item: z
    .object({
      title: z.string(),
      author: z.string().optional(),
      kind: z.enum(["book", "article", "paper", "essay"]).default("book"),
      url: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  item_id: z.string().uuid().optional(),
  new_status: z.enum(["to_read", "reading", "finished", "abandoned"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "reading_list",
    "your reading list (books, articles, papers). Get filtered list, add new items, update status, or rate finished items.",
    inputSchema,
    async ({ action, status, kind, limit, item, item_id, new_status, rating, notes }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("reading_list").select("*").limit(limit);
          if (status !== "all") q = q.eq("status", status);
          if (kind) q = q.eq("kind", kind);
          const { data, error } = await q.order("added_at", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("Nothing in reading list.");
          return ok(
            data
              .map((r: any) => `- [${r.status}] **${r.title}**${r.author ? ` — ${r.author}` : ""}${r.rating ? ` · ${r.rating}/5` : ""}${r.url ? `\n   ${r.url}` : ""}`)
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!item?.title) return fail("'item.title' required");
          const { data, error } = await ctx.supabase.from("reading_list").insert(item).select("id, title").single();
          if (error) return fail("insert failed", error);
          return ok(`Added "${data.title}" to reading list.`);
        }
        if (action === "update_status") {
          if (!item_id || !new_status) return fail("'item_id' and 'new_status' required");
          const updates: any = { status: new_status };
          if (new_status === "reading") updates.started_at = new Date().toISOString().slice(0, 10);
          if (new_status === "finished") updates.finished_at = new Date().toISOString().slice(0, 10);
          const { error } = await ctx.supabase.from("reading_list").update(updates).eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok(`Marked as ${new_status}.`);
        }
        if (action === "rate") {
          if (!item_id || !rating) return fail("'item_id' and 'rating' required");
          const { error } = await ctx.supabase
            .from("reading_list")
            .update({ rating, notes })
            .eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok(`Rated ${rating}/5.`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("reading_list failed", e);
      }
    },
  );
}
