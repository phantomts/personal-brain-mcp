/**
 * packing_list — templates by trip type. Returns checklist.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "save"]).default("get"),
  trip_type: z.string().optional(),
  name: z.string().optional(),
  items: z
    .array(
      z.object({
        item: z.string(),
        category: z.string().optional(),
        optional: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "packing_list",
    "Get a saved packing template by name or trip_type, or save a new one. Use before a trip to print a checklist.",
    inputSchema,
    async ({ action, trip_type, name, items }) => {
      try {
        if (action === "get") {
          let q = ctx.supabase.from("packing_templates").select("*").limit(5);
          if (name) q = q.ilike("name", `%${name}%`);
          if (trip_type) q = q.eq("trip_type", trip_type);
          const { data, error } = await q;
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No matching templates.");
          return ok(data.map(formatTemplate).join("\n\n---\n\n"));
        }
        if (action === "save") {
          if (!name || !items?.length) return fail("'name' and 'items' required");
          const { data, error } = await ctx.supabase
            .from("packing_templates")
            .insert({ name, trip_type, items })
            .select("id, name")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Saved template "${data.name}".`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("packing_list failed", e);
      }
    },
  );
}

function formatTemplate(t: any): string {
  const lines = [`## ${t.name}${t.trip_type ? ` (${t.trip_type})` : ""}`];
  const byCat: Record<string, string[]> = {};
  for (const it of (t.items ?? []) as any[]) {
    const c = it.category ?? "general";
    (byCat[c] ??= []).push(`- [ ] ${it.item}${it.optional ? " (opt)" : ""}${it.notes ? ` — ${it.notes}` : ""}`);
  }
  for (const [c, items] of Object.entries(byCat)) {
    lines.push(`\n**${c}**\n${items.join("\n")}`);
  }
  return lines.join("\n");
}
