/**
 * pantry — what's on hand, what's expiring, add/consume items.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "remove", "expiring"]).default("get"),
  query: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  expires_within_days: z.number().int().min(0).max(365).default(14),
  // for add:
  items: z
    .array(
      z.object({
        item: z.string(),
        category: z.string().optional(),
        quantity: z.string().optional(),
        location: z.string().optional(),
        expires_at: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  // for remove:
  item_ids: z.array(z.string().uuid()).optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "pantry",
    "Check pantry contents, add items, mark items consumed, or list what's expiring soon.",
    inputSchema,
    async ({ action, query, category, location, expires_within_days, items, item_ids }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("pantry").select("*").limit(100);
          if (query) q = q.ilike("item", `%${query}%`);
          if (category) q = q.eq("category", category);
          if (location) q = q.ilike("location", `%${location}%`);
          const { data, error } = await q.order("item", { ascending: true });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("Pantry is empty (or no matches).");
          return ok(
            data
              .map((p: any) => `- ${p.item}${p.quantity ? ` × ${p.quantity}` : ""}${p.location ? ` [${p.location}]` : ""}${p.expires_at ? ` · exp ${p.expires_at}` : ""}`)
              .join("\n"),
          );
        }
        if (action === "expiring") {
          const cutoff = new Date(Date.now() + expires_within_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("pantry")
            .select("*")
            .not("expires_at", "is", null)
            .lte("expires_at", cutoff)
            .order("expires_at", { ascending: true });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`Nothing expiring within ${expires_within_days} days.`);
          return ok(data.map((p: any) => `- ${p.item} — ${p.expires_at}${p.location ? ` [${p.location}]` : ""}`).join("\n"));
        }
        if (action === "add") {
          if (!items?.length) return fail("'items' required");
          const { data, error } = await ctx.supabase.from("pantry").insert(items).select("item");
          if (error) return fail("insert failed", error);
          return ok(`Added ${data?.length ?? 0} pantry item(s).`);
        }
        if (action === "remove") {
          if (!item_ids?.length) return fail("'item_ids' required");
          const { data, error } = await ctx.supabase.from("pantry").delete().in("id", item_ids).select("item");
          if (error) return fail("delete failed", error);
          return ok(`Removed ${data?.length ?? 0} item(s).`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("pantry failed", e);
      }
    },
  );
}
