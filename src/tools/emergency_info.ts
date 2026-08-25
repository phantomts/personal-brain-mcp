/**
 * emergency_info — "in case of" information: who to call, where things are,
 * what to do. The morbid-but-essential table.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "update", "remove"]).default("list"),
  category: z.string().optional(),
  include_sensitive: z.boolean().default(false),
  payload: z.record(z.unknown()).optional(),
  id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "emergency_info",
    "Critical in-case-of information: who to call, where the will is, spare key locations, kids' emergency contacts. include_sensitive defaults false to avoid returning encrypted/redacted detail unless asked.",
    inputSchema,
    async ({ action, category, include_sensitive, payload, id }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("emergency_info").select("*");
          if (category) q = q.eq("category", category);
          if (!include_sensitive) q = q.eq("sensitive", false);
          const { data, error } = await q.order("category").order("label");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No emergency info recorded.");
          const byCategory: Record<string, string[]> = {};
          for (const e of data as any[]) {
            (byCategory[e.category] ??= []).push(
              `- **${e.label}**: ${e.detail}${e.who_to_call ? ` · call ${e.who_to_call}` : ""}${e.phone ? ` (${e.phone})` : ""}${e.sensitive ? " 🔒" : ""}`,
            );
          }
          return ok(
            Object.entries(byCategory)
              .map(([c, items]) => `## ${c}\n${items.join("\n")}`)
              .join("\n\n"),
          );
        }
        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { error } = await ctx.supabase.from("emergency_info").insert(payload as any);
          if (error) return fail("insert failed", error);
          return ok("Added.");
        }
        if (action === "update") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("emergency_info").update(payload as any).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }
        if (action === "remove") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("emergency_info").delete().eq("id", id);
          if (error) return fail("delete failed", error);
          return ok("Removed.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("emergency_info failed", e);
      }
    },
  );
}
