/**
 * bucket_list — life goals separate from business OKRs.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "update_status", "complete"]).default("get"),
  status: z.enum(["someday", "planning", "in_progress", "done", "dropped", "all"]).default("all"),
  category: z.string().optional(),
  item: z
    .object({
      goal: z.string(),
      category: z.string().optional(),
      target_year: z.number().int().optional(),
      why: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  item_id: z.string().uuid().optional(),
  new_status: z.enum(["someday", "planning", "in_progress", "done", "dropped"]).optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "bucket_list",
    "your life bucket list (travel, skills, experiences). Get filtered list, add, update status, or mark complete.",
    inputSchema,
    async ({ action, status, category, item, item_id, new_status }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("bucket_list").select("*").limit(100);
          if (status !== "all") q = q.eq("status", status);
          if (category) q = q.eq("category", category);
          const { data, error } = await q.order("target_year", { ascending: true });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("Bucket list is empty.");
          return ok(
            data
              .map(
                (b: any) =>
                  `- [${b.status}]${b.target_year ? ` ${b.target_year}:` : ""} **${b.goal}**${b.category ? ` (${b.category})` : ""}${b.why ? `\n   _why: ${b.why}_` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!item?.goal) return fail("'item.goal' required");
          const { data, error } = await ctx.supabase.from("bucket_list").insert(item).select("id, goal").single();
          if (error) return fail("insert failed", error);
          return ok(`Added "${data.goal}".`);
        }
        if (action === "update_status") {
          if (!item_id || !new_status) return fail("'item_id' and 'new_status' required");
          const updates: any = { status: new_status };
          if (new_status === "done") updates.completed_at = new Date().toISOString().slice(0, 10);
          const { error } = await ctx.supabase.from("bucket_list").update(updates).eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok(`Status: ${new_status}.`);
        }
        if (action === "complete") {
          if (!item_id) return fail("'item_id' required");
          const { error } = await ctx.supabase
            .from("bucket_list")
            .update({ status: "done", completed_at: new Date().toISOString().slice(0, 10) })
            .eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok("🎉 Marked complete.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("bucket_list failed", e);
      }
    },
  );
}
