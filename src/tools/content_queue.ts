/**
 * content_queue — saved videos, podcasts, articles, newsletters.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "mark_watched"]).default("get"),
  status: z.enum(["queued", "watched", "dropped", "all"]).default("queued"),
  kind: z.enum(["video", "podcast", "article", "newsletter"]).optional(),
  max_duration_min: z.number().int().optional(),
  item: z
    .object({
      title: z.string(),
      kind: z.enum(["video", "podcast", "article", "newsletter"]),
      url: z.string().optional(),
      source: z.string().optional(),
      duration_min: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  item_id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "content_queue",
    "Saved videos/podcasts/articles to consume later. Get filtered queue (optionally by max duration — great for picking something to watch on a treadmill), add new items, or mark watched.",
    inputSchema,
    async ({ action, status, kind, max_duration_min, item, item_id }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("content_queue").select("*").limit(50);
          if (status !== "all") q = q.eq("status", status);
          if (kind) q = q.eq("kind", kind);
          if (max_duration_min) q = q.lte("duration_min", max_duration_min);
          const { data, error } = await q.order("added_at", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("Queue is empty.");
          return ok(
            data
              .map(
                (c: any) => `- [${c.kind}${c.duration_min ? `, ${c.duration_min}m` : ""}] **${c.title}**${c.source ? ` · ${c.source}` : ""}${c.url ? `\n   ${c.url}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!item?.title) return fail("'item.title' required");
          const { data, error } = await ctx.supabase.from("content_queue").insert(item).select("id, title").single();
          if (error) return fail("insert failed", error);
          return ok(`Queued "${data.title}".`);
        }
        if (action === "mark_watched") {
          if (!item_id) return fail("'item_id' required");
          const { error } = await ctx.supabase
            .from("content_queue")
            .update({ status: "watched", watched_at: new Date().toISOString() })
            .eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok("Marked watched.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("content_queue failed", e);
      }
    },
  );
}
