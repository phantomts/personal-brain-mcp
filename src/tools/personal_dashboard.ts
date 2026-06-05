/**
 * personal_dashboard — bigger sibling to daily_personal_briefing. Designed
 * for weekly/monthly consumption: trends across health, finance, relationships,
 * projects, goals.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  period_days: z.number().int().min(7).max(365).default(30),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "personal_dashboard",
    "Bigger-picture dashboard for weekly/monthly consumption. Trends across health, finance, relationships, projects, and goals.",
    inputSchema,
    async ({ period_days }) => {
      try {
        const since = new Date(Date.now() - period_days * 86_400_000);
        const sinceIso = since.toISOString();
        const sinceDate = since.toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const futureCutoff = new Date(Date.now() + period_days * 86_400_000).toISOString().slice(0, 10);

        const [journals, workouts, expenses, subs, projects, personalProjects, bucket, neglected, upcoming] = await Promise.all([
          ctx.supabase.from("memory").select("type", { count: "exact" }).gte("occurred_at", sinceIso).eq("archived", false),
          ctx.supabase.from("workouts").select("duration_min").gte("performed_at", sinceIso),
          ctx.supabase.from("household_expenses").select("category, amount_cents").gte("occurred_at", sinceDate),
          ctx.supabase.from("subscriptions").select("amount_cents, cadence").eq("active", true),
          ctx.supabase.from("house_projects").select("status", { count: "exact" }).in("status", ["in_progress", "blocked"]),
          ctx.supabase.from("personal_projects").select("status", { count: "exact" }).eq("status", "active"),
          ctx.supabase.from("bucket_list").select("status", { count: "exact" }).eq("status", "in_progress"),
          ctx.supabase.from("contact_interactions").select("contact_id, occurred_at"),
          ctx.supabase.from("upcoming_dates").select("*").gte("due_date", today).lte("due_date", futureCutoff).limit(100),
        ]);

        const out: string[] = [`# Personal dashboard — last ${period_days} days\n`];

        const workoutTotal = ((workouts.data ?? []) as any[]).reduce((a, w) => a + (w.duration_min ?? 0), 0);
        const expenseTotal = ((expenses.data ?? []) as any[]).reduce((a, e) => a + e.amount_cents, 0);
        const factor: any = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };
        const subsMonthly = ((subs.data ?? []) as any[]).reduce((a, s) => a + s.amount_cents * (factor[s.cadence] ?? 1), 0);

        out.push("## Activity");
        out.push(`- Journal entries: ${(journals as any).count ?? journals.data?.length ?? 0}`);
        out.push(`- Workouts: ${workouts.data?.length ?? 0} (${workoutTotal} min)`);
        out.push("");

        out.push("## Money");
        out.push(`- Household spend: $${(expenseTotal / 100).toFixed(2)}`);
        out.push(`- Subscriptions (monthly equiv): $${(subsMonthly / 100).toFixed(2)}`);
        out.push("");

        out.push("## Projects");
        out.push(`- House projects in flight: ${(projects as any).count ?? 0}`);
        out.push(`- Personal projects active: ${(personalProjects as any).count ?? 0}`);
        out.push(`- Bucket-list items in progress: ${(bucket as any).count ?? 0}`);
        out.push("");

        // Neglected: contacts where last interaction is > 60 days
        const lastByContact = new Map<string, Date>();
        for (const i of ((neglected.data ?? []) as any[])) {
          const d = new Date(i.occurred_at);
          const cur = lastByContact.get(i.contact_id);
          if (!cur || d > cur) lastByContact.set(i.contact_id, d);
        }
        const overdue: Array<[string, number]> = [];
        for (const [id, d] of lastByContact) {
          const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
          if (days > 60) overdue.push([id, days]);
        }
        if (overdue.length) {
          out.push("## Relationships");
          out.push(`- ${overdue.length} contact(s) gone >60 days without contact. Use last_seen for details.`);
          out.push("");
        }

        out.push(`## Upcoming (next ${period_days} days)`);
        out.push(`- ${upcoming.data?.length ?? 0} dated items on the radar.`);

        return ok(out.join("\n"));
      } catch (e) {
        return fail("personal_dashboard failed", e);
      }
    },
  );
}
