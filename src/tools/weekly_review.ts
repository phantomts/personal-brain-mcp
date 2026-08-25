/**
 * weekly_review — Sunday-flavored digest. Looks back 7 days and forward 7 days.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  end_date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "weekly_review",
    "Sunday-flavored weekly digest: journal entries logged this week, house projects that moved, workouts completed, gifts given/bought, and what's coming next week.",
    inputSchema,
    async ({ end_date }) => {
      try {
        const end = end_date ? new Date(end_date) : new Date();
        const start = new Date(end.getTime() - 7 * 86_400_000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const nextWeekIso = new Date(end.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
        const todayIso = end.toISOString().slice(0, 10);

        const [journal, decisions, projects, workouts, gifts, upcoming] = await Promise.all([
          ctx.supabase.from("memory").select("title, body, occurred_at, mood").eq("type", "journal").gte("occurred_at", startIso).lte("occurred_at", endIso).order("occurred_at"),
          ctx.supabase.from("memory").select("title, body, occurred_at").eq("type", "decision").gte("occurred_at", startIso).lte("occurred_at", endIso),
          ctx.supabase.from("house_projects").select("name, status, next_step").gte("updated_at", startIso),
          ctx.supabase.from("workouts").select("activity, duration_min").gte("performed_at", startIso),
          ctx.supabase.from("gifts").select("idea, status, given_at, people:person_id (name)").gte("created_at", startIso),
          ctx.supabase.from("upcoming_dates").select("*").gte("due_date", todayIso).lte("due_date", nextWeekIso).order("due_date").limit(30),
        ]);

        const out: string[] = [];
        out.push(`# Weekly review — week ending ${todayIso}\n`);

        out.push(`## Journal (${journal.data?.length ?? 0} entries)`);
        for (const j of (journal.data ?? []) as any[]) {
          out.push(`- ${j.occurred_at.slice(0, 10)}${j.mood ? ` (${j.mood})` : ""}: ${j.title ?? truncate(j.body, 80)}`);
        }
        if (!journal.data?.length) out.push("_(none)_");
        out.push("");

        if (decisions.data?.length) {
          out.push(`## Decisions`);
          for (const d of decisions.data as any[]) out.push(`- ${d.title ?? truncate(d.body, 80)}`);
          out.push("");
        }

        out.push(`## House projects moved this week`);
        if (projects.data?.length) {
          for (const p of projects.data as any[]) out.push(`- ${p.name} [${p.status}]${p.next_step ? ` → ${p.next_step}` : ""}`);
        } else out.push("_(none)_");
        out.push("");

        const totalMin = (workouts.data ?? []).reduce((a: number, w: any) => a + (w.duration_min ?? 0), 0);
        out.push(`## Workouts: ${workouts.data?.length ?? 0} (${totalMin} min total)\n`);

        if (gifts.data?.length) {
          out.push(`## Gifts moved`);
          for (const g of gifts.data as any[]) out.push(`- [${g.status}] ${g.people?.name ?? "?"}: ${g.idea}`);
          out.push("");
        }

        out.push(`## Next 7 days`);
        if (upcoming.data?.length) {
          for (const u of upcoming.data as any[]) out.push(`- ${u.due_date} · [${u.kind}] ${u.label}${u.detail ? ` · ${u.detail}` : ""}`);
        } else out.push("_(quiet week)_");

        return ok(out.join("\n"));
      } catch (e) {
        return fail("weekly_review failed", e);
      }
    },
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
