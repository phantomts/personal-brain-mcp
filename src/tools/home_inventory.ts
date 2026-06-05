/**
 * home_inventory — search/list household items: appliances, paint, filters,
 * tools, electronics. Supports get/add/update via action arg.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "update"]).default("get"),
  query: z.string().optional().describe("Fuzzy match on name (get)"),
  category: z.string().optional(),
  area: z.string().optional(),
  // For add/update:
  item: z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().optional(),
      category: z.string().optional(),
      area: z.string().optional(),
      brand: z.string().optional(),
      model_number: z.string().optional(),
      serial_number: z.string().optional(),
      purchased_at: z.string().optional(),
      purchase_price_cents: z.number().int().optional(),
      vendor: z.string().optional(),
      warranty_until: z.string().optional(),
      warranty_notes: z.string().optional(),
      attrs: z.record(z.unknown()).optional(),
      notes: z.string().optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "home_inventory",
    "View, add, or update household items (appliances, paint codes, HVAC filter sizes, tools, electronics). Includes warranty info.",
    inputSchema,
    async ({ action, query, category, area, item }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("home_inventory").select("*").limit(50);
          if (query) q = q.ilike("name", `%${query}%`);
          if (category) q = q.eq("category", category);
          if (area) q = q.ilike("area", `%${area}%`);
          const { data, error } = await q.order("updated_at", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No inventory items match.");
          return ok(data.map(formatItem).join("\n\n"));
        }
        if (action === "add") {
          if (!item?.name) return fail("'item.name' required for add");
          const { data, error } = await ctx.supabase.from("home_inventory").insert(item).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added "${data.name}" (id ${data.id}).`);
        }
        if (action === "update") {
          if (!item?.id) return fail("'item.id' required for update");
          const { id, ...rest } = item;
          const { data, error } = await ctx.supabase
            .from("home_inventory")
            .update(rest)
            .eq("id", id)
            .select("name")
            .single();
          if (error) return fail("update failed", error);
          return ok(`Updated "${data.name}".`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("home_inventory failed", e);
      }
    },
  );
}

function formatItem(it: any): string {
  const lines: string[] = [`### ${it.name}${it.brand ? ` — ${it.brand}` : ""}`];
  const meta = [it.category, it.area, it.model_number && `model ${it.model_number}`].filter(Boolean).join(" · ");
  if (meta) lines.push(`_${meta}_`);
  if (it.serial_number) lines.push(`- Serial: ${it.serial_number}`);
  if (it.purchased_at) lines.push(`- Purchased: ${it.purchased_at}${it.vendor ? ` from ${it.vendor}` : ""}`);
  if (it.warranty_until) lines.push(`- Warranty until: ${it.warranty_until}${it.warranty_notes ? ` — ${it.warranty_notes}` : ""}`);
  if (it.attrs && Object.keys(it.attrs).length) {
    lines.push(
      "- Attrs: " +
        Object.entries(it.attrs)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
    );
  }
  if (it.notes) lines.push(`\n${it.notes}`);
  return lines.join("\n");
}
