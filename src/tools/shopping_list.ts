/**
 * shopping_list — get / add / mark-bought in one tool.
 * Keeps the tool surface small; the action arg selects behavior.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "mark_bought"]),
  items: z.array(z.string()).optional()
    .describe("Required for 'add' (item names) or 'mark_bought' (item ids or exact names)"),
  category: z.string().optional()
    .describe("For 'add': applies to all items. For 'get': filters."),
  include_bought: z.boolean().default(false),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "shopping_list",
    "View or modify your household shopping list. action='get' lists items, 'add' appends, 'mark_bought' closes items.",
    inputSchema,
    async ({ action, items, category, include_bought }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("shopping").select("*");
          if (!include_bought) q = q.eq("status", "open");
          if (category) q = q.ilike("category", `%${category}%`);
          q = q.order("added_at", { ascending: true });
          const { data, error } = await q;
          if (error) return fail("query failed", error);
          if (!data || data.length === 0) return ok("Shopping list is empty.");
          const lines = data.map((s: any) => {
            const cat = s.category ? ` [${s.category}]` : "";
            const qty = s.quantity ? ` × ${s.quantity}` : "";
            return `- ${s.status === "bought" ? "~~" : ""}${s.item}${qty}${cat}${s.status === "bought" ? "~~" : ""}`;
          });
          return ok(lines.join("\n"));
        }

        if (action === "add") {
          if (!items?.length) return fail("'items' required for action=add");
          const rows = items.map((item) => ({ item, category: category ?? null }));
          const { data, error } = await ctx.supabase.from("shopping").insert(rows).select("item");
          if (error) return fail("insert failed", error);
          return ok(`Added ${data?.length ?? 0} item(s) to shopping list.`);
        }

        if (action === "mark_bought") {
          if (!items?.length) return fail("'items' required for action=mark_bought");
          const { data, error } = await ctx.supabase
            .from("shopping")
            .update({ status: "bought", bought_at: new Date().toISOString() })
            .in("item", items)
            .eq("status", "open")
            .select("item");
          if (error) return fail("update failed", error);
          return ok(`Marked ${data?.length ?? 0} item(s) bought.`);
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("shopping_list failed", e);
      }
    },
  );
}
