/**
 * subscriptions_audit — what am I paying for, monthly equivalent, what's
 * up for renewal soon.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["audit", "renewing_soon", "add", "cancel"]).default("audit"),
  category: z.string().optional(),
  within_days: z.number().int().default(30),
  sub: z
    .object({
      name: z.string(),
      category: z.string().optional(),
      amount_cents: z.number().int(),
      cadence: z.enum(["monthly", "quarterly", "annual", "weekly"]),
      renews_on: z.string().optional(),
      payment_method: z.string().optional(),
      url: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  sub_id: z.string().uuid().optional(),
};

const monthlyFactor: Record<string, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "subscriptions_audit",
    "Audit recurring subscriptions: total monthly spend, biggest line items, what renews soon. Also add/cancel.",
    inputSchema,
    async ({ action, category, within_days, sub, sub_id }) => {
      try {
        if (action === "audit") {
          let q = ctx.supabase.from("subscriptions").select("*").eq("active", true);
          if (category) q = q.eq("category", category);
          const { data, error } = await q;
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No active subscriptions.");
          const enriched = data.map((s: any) => ({
            ...s,
            monthly_cents: Math.round(s.amount_cents * (monthlyFactor[s.cadence] ?? 1)),
          }));
          enriched.sort((a, b) => b.monthly_cents - a.monthly_cents);
          const total = enriched.reduce((acc, s) => acc + s.monthly_cents, 0);
          const lines = enriched.map(
            (s) => `- $${(s.monthly_cents / 100).toFixed(2)}/mo · **${s.name}** (${s.cadence})${s.category ? ` · ${s.category}` : ""}${s.renews_on ? ` · renews ${s.renews_on}` : ""}`,
          );
          return ok(`${lines.join("\n")}\n\n**Total: $${(total / 100).toFixed(2)} / month** ($${((total * 12) / 100).toFixed(2)} / year)`);
        }
        if (action === "renewing_soon") {
          const cutoff = new Date(Date.now() + within_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("subscriptions")
            .select("*")
            .eq("active", true)
            .not("renews_on", "is", null)
            .lte("renews_on", cutoff)
            .order("renews_on");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`Nothing renewing in the next ${within_days} days.`);
          return ok(data.map((s: any) => `- ${s.renews_on} · ${s.name} · $${(s.amount_cents / 100).toFixed(2)}`).join("\n"));
        }
        if (action === "add") {
          if (!sub) return fail("'sub' required");
          const { data, error } = await ctx.supabase.from("subscriptions").insert(sub).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added subscription "${data.name}".`);
        }
        if (action === "cancel") {
          if (!sub_id) return fail("'sub_id' required");
          const { error } = await ctx.supabase
            .from("subscriptions")
            .update({ active: false, cancelled_at: new Date().toISOString().slice(0, 10) })
            .eq("id", sub_id);
          if (error) return fail("update failed", error);
          return ok("Cancelled.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("subscriptions_audit failed", e);
      }
    },
  );
}
