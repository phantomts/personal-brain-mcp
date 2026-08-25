/**
 * daily_personal_briefing — composes data from several tables into one
 * morning-friendly markdown digest:
 *   - upcoming birthdays in next 30 days
 *   - active house project(s) by priority
 *   - open shopping list count
 *   - yesterday's journal entry (if any)
 *
 * No LLM calls here — pure data assembly. Cheap to call often.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "daily_personal_briefing",
    "Generate your morning personal briefing: upcoming birthdays, active house projects, open shopping list, and yesterday's journal entry.",
    inputSchema,
    async ({ date }) => {
      try {
        const today = date ? new Date(date) : new Date();
        const yesterday = new Date(today.getTime() - 86_400_000);

        const [people, projects, shopping, lastJournal] = await Promise.all([
          ctx.supabase.from("people").select("name, birthday, relationship").not("birthday", "is", null),
          ctx.supabase
            .from("house_projects")
            .select("name, status, priority, next_step")
            .in("status", ["in_progress", "blocked"])
            .order("priority", { ascending: false })
            .limit(5),
          ctx.supabase.from("shopping").select("item", { count: "exact" }).eq("status", "open"),
          ctx.supabase
            .from("memory")
            .select("title, body, occurred_at")
            .eq("type", "journal")
            .gte("occurred_at", startOfDay(yesterday).toISOString())
            .lt("occurred_at", startOfDay(today).toISOString())
            .order("occurred_at", { ascending: false })
            .limit(1),
        ]);

        if (people.error) return fail("people query failed", people.error);
        if (projects.error) return fail("projects query failed", projects.error);
        if (shopping.error) return fail("shopping query failed", shopping.error);
        if (lastJournal.error) return fail("journal query failed", lastJournal.error);

        const out: string[] = [];
        out.push(`# Personal briefing — ${today.toISOString().slice(0, 10)}\n`);

        // Birthdays in next 30 days
        const upcoming = (people.data ?? [])
          .map((p: any) => ({ ...p, daysAway: daysToNextBirthday(p.birthday, today) }))
          .filter((p) => p.daysAway <= 30)
          .sort((a, b) => a.daysAway - b.daysAway);
        if (upcoming.length) {
          out.push("## Upcoming birthdays (next 30 days)");
          for (const p of upcoming) {
            out.push(`- **${p.name}**${p.relationship ? ` (${p.relationship})` : ""} — in ${p.daysAway} day${p.daysAway === 1 ? "" : "s"}`);
          }
          out.push("");
        }

        // Active projects
        if (projects.data?.length) {
          out.push("## Active house projects");
          for (const p of projects.data as any[]) {
            out.push(`- **${p.name}** [${p.status}${p.priority ? `/${p.priority}` : ""}]${p.next_step ? ` → ${p.next_step}` : ""}`);
          }
          out.push("");
        }

        // Shopping count
        const openCount = (shopping as any).count ?? shopping.data?.length ?? 0;
        out.push(`## Shopping list\n${openCount} open item${openCount === 1 ? "" : "s"}.\n`);

        // Yesterday's journal
        if (lastJournal.data?.length) {
          const j = lastJournal.data[0]! as any;
          out.push(`## Yesterday's journal`);
          if (j.title) out.push(`_${j.title}_`);
          out.push(j.body.length > 600 ? j.body.slice(0, 600) + "…" : j.body);
        }

        return ok(out.join("\n"));
      } catch (e) {
        return fail("daily_personal_briefing failed", e);
      }
    },
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysToNextBirthday(isoDate: string, from: Date): number {
  const [, m, d] = isoDate.split("-").map(Number);
  if (!m || !d) return Infinity;
  let next = new Date(from.getFullYear(), m - 1, d);
  if (next < startOfDay(from)) next = new Date(from.getFullYear() + 1, m - 1, d);
  return Math.ceil((next.getTime() - startOfDay(from).getTime()) / 86_400_000);
}
