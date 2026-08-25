/**
 * proactive_check — Friday-style "things needing attention." Designed to be
 * called by a cron from an LLM client (or n8n) on a schedule. Returns a
 * structured list of items the assistant should consider surfacing to you,
 * with a suggested urgency score.
 *
 * Pure read tool. Composes signals across many tables, scores them, and
 * returns the top N. The CLIENT decides whether/how to notify (Telegram,
 * push, daily briefing inclusion, etc.).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  min_urgency: z.number().min(0).max(10).default(3).describe("Only return items at or above this urgency"),
  limit: z.number().int().default(15),
  lookback_days: z.number().int().default(30),
  lookahead_days: z.number().int().default(14),
};

type Signal = { urgency: number; category: string; subject: string; detail: string; due?: string };

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "proactive_check",
    "Things that need your attention: overdue maintenance, neglected contacts, refills due, contact follow-ups owed, expiring documents, overdue medications. Returns a ranked list. Cron-friendly. Client decides how to surface results.",
    inputSchema,
    async ({ min_urgency, limit, lookback_days, lookahead_days }) => {
      try {
        const signals: Signal[] = [];
        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);
        const lookaheadIso = new Date(today.getTime() + lookahead_days * 86_400_000).toISOString().slice(0, 10);
        const lookbackIso = new Date(today.getTime() - lookback_days * 86_400_000).toISOString();

        // 1. Overdue maintenance (urgency scales with days overdue)
        const { data: maint } = await ctx.supabase
          .from("maintenance_tasks")
          .select("name, next_due_at, vendor")
          .eq("active", true)
          .lt("next_due_at", todayIso);
        for (const m of (maint ?? []) as any[]) {
          const daysOverdue = Math.floor((today.getTime() - new Date(m.next_due_at).getTime()) / 86_400_000);
          signals.push({
            urgency: Math.min(10, 4 + Math.floor(daysOverdue / 30)),
            category: "maintenance_overdue",
            subject: m.name,
            detail: `${daysOverdue} days overdue${m.vendor ? ` · ${m.vendor}` : ""}`,
            due: m.next_due_at,
          });
        }

        // 2. Contact follow-ups owed
        const { data: followups } = await ctx.supabase
          .from("contact_interactions")
          .select("next_followup, summary, personal_contacts:contact_id (name)")
          .not("next_followup", "is", null)
          .lte("next_followup", todayIso);
        for (const f of (followups ?? []) as any[]) {
          signals.push({
            urgency: 5,
            category: "followup_owed",
            subject: f.personal_contacts?.name ?? "?",
            detail: f.summary ?? "follow up",
            due: f.next_followup,
          });
        }

        // 3. Refills due soon
        const { data: refills } = await ctx.supabase
          .from("medications")
          .select("name, refill_due_at, people:person_id (name)")
          .eq("active", true)
          .not("refill_due_at", "is", null)
          .lte("refill_due_at", lookaheadIso);
        for (const r of (refills ?? []) as any[]) {
          const overdue = new Date(r.refill_due_at).getTime() < today.getTime();
          signals.push({
            urgency: overdue ? 8 : 4,
            category: "refill_due",
            subject: `${r.people?.name ?? "?"} · ${r.name}`,
            detail: overdue ? "REFILL OVERDUE" : `refill by ${r.refill_due_at}`,
            due: r.refill_due_at,
          });
        }

        // 4. Documents expiring
        const { data: docs } = await ctx.supabase
          .from("documents")
          .select("name, expires_at, category")
          .not("expires_at", "is", null)
          .lte("expires_at", lookaheadIso);
        for (const d of (docs ?? []) as any[]) {
          const overdue = new Date(d.expires_at).getTime() < today.getTime();
          signals.push({
            urgency: overdue ? 9 : 5,
            category: "document_expiring",
            subject: d.name,
            detail: `${d.category} · ${overdue ? "EXPIRED" : `expires ${d.expires_at}`}`,
            due: d.expires_at,
          });
        }

        // 5. Vehicle registration / insurance / inspection
        const { data: vehicles } = await ctx.supabase
          .from("vehicles")
          .select("nickname, make, model, registration_renews_at, insurance_renews_at, inspection_due_at")
          .eq("active", true);
        for (const v of (vehicles ?? []) as any[]) {
          const vname = v.nickname ?? `${v.make ?? ""} ${v.model ?? ""}`.trim();
          for (const [field, label] of [
            ["registration_renews_at", "registration"],
            ["insurance_renews_at", "insurance"],
            ["inspection_due_at", "inspection"],
          ] as const) {
            const d = (v as any)[field];
            if (d && d <= lookaheadIso) {
              const overdue = d < todayIso;
              signals.push({
                urgency: overdue ? 9 : 5,
                category: `vehicle_${label}`,
                subject: vname,
                detail: `${overdue ? "OVERDUE" : "due"} ${d}`,
                due: d,
              });
            }
          }
        }

        // 6. Neglected contacts (no interaction in 90+ days, but flagged as
        //    "stay in touch" via tag — only fire for tagged ones to avoid noise)
        const { data: stayInTouch } = await ctx.supabase
          .from("personal_contacts")
          .select("id, name, relationship, tags");
        const stayIds = ((stayInTouch ?? []) as any[]).filter((c) => (c.tags ?? []).includes("stay_in_touch"));
        if (stayIds.length) {
          const { data: latest } = await ctx.supabase
            .from("contact_interactions")
            .select("contact_id, occurred_at")
            .in("contact_id", stayIds.map((c) => c.id))
            .order("occurred_at", { ascending: false });
          const latestByContact = new Map<string, string>();
          for (const l of (latest ?? []) as any[]) {
            if (!latestByContact.has(l.contact_id)) latestByContact.set(l.contact_id, l.occurred_at);
          }
          for (const c of stayIds) {
            const last = latestByContact.get(c.id);
            const days = last ? Math.floor((today.getTime() - new Date(last).getTime()) / 86_400_000) : 9999;
            if (days >= 90) {
              signals.push({
                urgency: Math.min(7, 3 + Math.floor(days / 60)),
                category: "neglected_contact",
                subject: c.name,
                detail: `${last ? days + "d since contact" : "never logged"}${c.relationship ? ` · ${c.relationship}` : ""}`,
              });
            }
          }
        }

        // 7. Pets — overdue/upcoming health events
        const { data: petHealth } = await ctx.supabase
          .from("pet_health_events")
          .select("kind, next_due_at, pets:pet_id (name)")
          .not("next_due_at", "is", null)
          .lte("next_due_at", lookaheadIso);
        for (const e of (petHealth ?? []) as any[]) {
          const overdue = new Date(e.next_due_at).getTime() < today.getTime();
          signals.push({
            urgency: overdue ? 7 : 4,
            category: "pet_health_due",
            subject: e.pets?.name ?? "?",
            detail: `${e.kind} ${overdue ? "OVERDUE" : `due ${e.next_due_at}`}`,
            due: e.next_due_at,
          });
        }

        // 8. House projects blocked > 14 days
        const { data: blocked } = await ctx.supabase
          .from("house_projects")
          .select("name, updated_at, next_step")
          .eq("status", "blocked");
        for (const p of (blocked ?? []) as any[]) {
          const daysBlocked = Math.floor((today.getTime() - new Date(p.updated_at).getTime()) / 86_400_000);
          if (daysBlocked >= 14) {
            signals.push({
              urgency: Math.min(6, 3 + Math.floor(daysBlocked / 14)),
              category: "project_blocked",
              subject: p.name,
              detail: `blocked ${daysBlocked}d${p.next_step ? ` · ${p.next_step}` : ""}`,
            });
          }
        }

        // Filter, sort, and format
        const filtered = signals.filter((s) => s.urgency >= min_urgency).sort((a, b) => b.urgency - a.urgency).slice(0, limit);
        if (!filtered.length) return ok("Nothing urgent. ✅");

        const lines = filtered.map(
          (s) => `- [${s.urgency}/10] **${s.category}** · ${s.subject} — ${s.detail}${s.due ? ` (${s.due})` : ""}`,
        );
        return ok(`# Proactive check\n\n${lines.join("\n")}\n\n_(${filtered.length} item(s) at urgency ≥ ${min_urgency})_`);
      } catch (e) {
        return fail("proactive_check failed", e);
      }
    },
  );
}
