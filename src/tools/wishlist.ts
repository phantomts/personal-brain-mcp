/**
 * wishlist — things you wants (distinct from gifts-to-give and bucket-list-experiences).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "update_status"]).default("list"),
  status: z.enum(["open", "received", "dropped", "purchased_self", "all"]).default("open"),
  category: z.string().optional(),
  occasion_hint: z.string().optional(),
  max_price_cents: z.number().int().optional(),
  item: z
    .object({
      item: z.string(),
      category: z.string().optional(),
      price_cents: z.number().int().optional(),
      priority: z.enum(["low", "med", "high"]).optional(),
      url: z.string().optional(),
      occasion_hint: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  item_id: z.string().uuid().optional(),
  new_status: z.enum(["open", "received", "dropped", "purchased_self"]).optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "wishlist",
    "your personal wishlist (things he wants). Useful when family/friends ask gift ideas. Filter by category, occasion, or price ceiling.",
    inputSchema,
    async ({ action, status, category, occasion_hint, max_price_cents, item, item_id, new_status }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("wishlist").select("*").limit(100);
          if (status !== "all") q = q.eq("status", status);
          if (category) q = q.eq("category", category);
          if (occasion_hint) q = q.eq("occasion_hint", occasion_hint);
          if (max_price_cents) q = q.lte("price_cents", max_price_cents);
          const { data, error } = await q.order("priority", { ascending: false }).order("created_at", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("Wishlist is empty (or no matches).");
          return ok(
            data
              .map((w: any) => `- [${w.priority ?? "?"}] **${w.item}**${w.price_cents ? ` · ~$${(w.price_cents / 100).toFixed(0)}` : ""}${w.category ? ` · ${w.category}` : ""}${w.occasion_hint ? ` · for ${w.occasion_hint}` : ""}${w.url ? `\n   ${w.url}` : ""}`)
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!item?.item) return fail("'item.item' required");
          const { data, error } = await ctx.supabase.from("wishlist").insert(item).select("id, item").single();
          if (error) return fail("insert failed", error);
          return ok(`Added "${data.item}" to wishlist.`);
        }
        if (action === "update_status") {
          if (!item_id || !new_status) return fail("'item_id' and 'new_status' required");
          const updates: any = { status: new_status };
          if (new_status === "received") updates.received_at = new Date().toISOString().slice(0, 10);
          const { error } = await ctx.supabase.from("wishlist").update(updates).eq("id", item_id);
          if (error) return fail("update failed", error);
          return ok(`Marked ${new_status}.`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("wishlist failed", e);
      }
    },
  );
}
