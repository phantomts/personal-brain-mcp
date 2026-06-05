/**
 * meal_plan — view or set planned meals by date and slot.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "set", "clear"]).default("get"),
  start_date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
  days: z.number().int().min(1).max(31).default(7),
  // for set:
  plan_date: z.string().optional(),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  recipe_id: z.string().uuid().optional(),
  freeform: z.string().optional(),
  notes: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "meal_plan",
    "View or modify the meal plan. action=get returns the plan for the next N days. action=set assigns a recipe (or freeform text) to a date+slot. action=clear removes a slot.",
    inputSchema,
    async ({ action, start_date, days, plan_date, slot, recipe_id, freeform, notes }) => {
      try {
        if (action === "get") {
          const start = start_date ?? new Date().toISOString().slice(0, 10);
          const end = new Date(new Date(start).getTime() + days * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("meal_plan")
            .select("plan_date, slot, freeform, notes, recipe_id, recipes:recipe_id (name)")
            .gte("plan_date", start)
            .lt("plan_date", end)
            .order("plan_date", { ascending: true });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No meals planned ${start} – ${end}.`);
          const byDate: Record<string, string[]> = {};
          for (const m of data as any[]) {
            const label = m.recipes?.name ?? m.freeform ?? "(no name)";
            (byDate[m.plan_date] ??= []).push(`  - ${m.slot}: ${label}${m.notes ? ` (${m.notes})` : ""}`);
          }
          const lines = Object.entries(byDate).map(([d, items]) => `**${d}**\n${items.join("\n")}`);
          return ok(lines.join("\n\n"));
        }

        if (action === "set") {
          if (!plan_date || !slot) return fail("plan_date and slot required");
          if (!recipe_id && !freeform) return fail("recipe_id or freeform required");
          const { error } = await ctx.supabase
            .from("meal_plan")
            .upsert({ plan_date, slot, recipe_id, freeform, notes }, { onConflict: "plan_date,slot" });
          if (error) return fail("upsert failed", error);
          return ok(`Set ${slot} on ${plan_date}.`);
        }

        if (action === "clear") {
          if (!plan_date || !slot) return fail("plan_date and slot required");
          const { error } = await ctx.supabase.from("meal_plan").delete().eq("plan_date", plan_date).eq("slot", slot);
          if (error) return fail("delete failed", error);
          return ok(`Cleared ${slot} on ${plan_date}.`);
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("meal_plan failed", e);
      }
    },
  );
}
