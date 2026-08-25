/**
 * log_household_expense — capture any non-business expense (house project,
 * grocery, utility, maintenance). Optionally links to a project or
 * maintenance task to roll up spend.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["log", "summary"]).default("log"),
  category: z
    .enum(["house_project", "grocery", "utility", "maintenance", "subscription", "auto", "other"])
    .optional(),
  subcategory: z.string().optional(),
  amount_cents: z.number().int().optional(),
  vendor: z.string().optional(),
  description: z.string().optional(),
  occurred_at: z.string().optional(),
  project_id: z.string().uuid().optional(),
  maintenance_id: z.string().uuid().optional(),
  // for summary:
  since_days: z.number().int().min(1).max(3650).default(30),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "log_household_expense",
    "Log a household expense or get a category summary. action=log records one expense; action=summary returns spend-by-category over the past N days.",
    inputSchema,
    async ({ action, category, subcategory, amount_cents, vendor, description, occurred_at, project_id, maintenance_id, since_days }) => {
      try {
        if (action === "log") {
          if (!category || amount_cents == null) return fail("category and amount_cents required");
          const { data, error } = await ctx.supabase
            .from("household_expenses")
            .insert({ category, subcategory, amount_cents, vendor, description, occurred_at, project_id, maintenance_id })
            .select("id, occurred_at")
            .single();
          if (error) return fail("insert failed", error);

          // If linked to a project, roll up spent_cents
          if (project_id) {
            await ctx.supabase.rpc("noop"); // placeholder — see migration note below
            // Simple approach: re-sum from expenses.
            const { data: sum } = await ctx.supabase
              .from("household_expenses")
              .select("amount_cents")
              .eq("project_id", project_id);
            const total = (sum ?? []).reduce((a: number, r: any) => a + (r.amount_cents ?? 0), 0);
            await ctx.supabase.from("house_projects").update({ spent_cents: total }).eq("id", project_id);
          }
          return ok(`Logged $${(amount_cents / 100).toFixed(2)} ${category} expense on ${data.occurred_at}.`);
        }

        if (action === "summary") {
          const since = new Date(Date.now() - since_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("household_expenses")
            .select("category, amount_cents")
            .gte("occurred_at", since);
          if (error) return fail("query failed", error);
          const totals: Record<string, number> = {};
          for (const r of (data ?? []) as any[]) {
            totals[r.category] = (totals[r.category] ?? 0) + r.amount_cents;
          }
          const lines = Object.entries(totals)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, cents]) => `- ${cat}: $${(cents / 100).toFixed(2)}`);
          const grand = Object.values(totals).reduce((a, b) => a + b, 0);
          return ok(`Household spend, last ${since_days} days:\n${lines.join("\n")}\n\n**Total: $${(grand / 100).toFixed(2)}**`);
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("log_household_expense failed", e);
      }
    },
  );
}
