/**
 * Daily cron: run proactive_check and push the result to your configured
 * chat sink (Telegram by default).
 *
 * Wired in src/index.ts via the `scheduled` handler. Cron expression is
 * in wrangler.toml under [triggers]. Default: daily at 13:00 UTC = 8:00 AM
 * Eastern (no DST adjustment; pick a UTC time that hits your morning).
 *
 * The cron does NOT go through MCP. It calls Supabase directly using the
 * same signal-gathering logic as the proactive_check tool, then pushes via
 * the configured outbound channel.
 *
 * Customize:
 *   CRON_PUSH_CHANNEL  = "telegram" | "discord" | "none"   (default: telegram)
 *   CRON_PUSH_CHAT_ID  = string                            (Telegram chat id OR Discord channel id)
 *   CRON_MIN_URGENCY   = number 0-10                       (default: 4)
 *   CRON_LIMIT         = number                            (default: 10)
 *   CRON_SUPPRESS_EMPTY = "true" | "false"                 (default: "true" — skip push if nothing urgent)
 */
import { createSupabase } from "../lib/supabase";
import type { Env } from "../index";

type Signal = { urgency: number; category: string; subject: string; detail: string; due?: string };

export async function runDailyProactivePush(env: Env): Promise<{ sent: boolean; signals: number; reason?: string }> {
  const channel = (env as any).CRON_PUSH_CHANNEL ?? "telegram";
  const minUrgency = parseInt((env as any).CRON_MIN_URGENCY ?? "4", 10);
  const limit = parseInt((env as any).CRON_LIMIT ?? "10", 10);
  const suppressEmpty = ((env as any).CRON_SUPPRESS_EMPTY ?? "true") === "true";

  const signals = await gatherSignals(env, minUrgency, limit);
  if (signals.length === 0 && suppressEmpty) {
    return { sent: false, signals: 0, reason: "nothing urgent and suppress_empty=true" };
  }

  const body = formatBody(signals);

  if (channel === "none") {
    return { sent: false, signals: signals.length, reason: "channel=none" };
  }
  if (channel === "telegram") {
    await pushTelegram(env, body);
    return { sent: true, signals: signals.length };
  }
  if (channel === "discord") {
    await pushDiscord(env, body);
    return { sent: true, signals: signals.length };
  }
  return { sent: false, signals: signals.length, reason: `unknown channel ${channel}` };
}

async function gatherSignals(env: Env, minUrgency: number, limit: number): Promise<Signal[]> {
  const supa = createSupabase(env);
  const signals: Signal[] = [];
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const lookaheadIso = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);

  // 1. Overdue maintenance
  const { data: maint } = await supa
    .from("maintenance_tasks")
    .select("name, next_due_at, vendor")
    .eq("active", true)
    .lt("next_due_at", todayIso);
  for (const m of (maint ?? []) as any[]) {
    const daysOver = Math.floor((today.getTime() - new Date(m.next_due_at).getTime()) / 86_400_000);
    signals.push({
      urgency: Math.min(10, 4 + Math.floor(daysOver / 30)),
      category: "maintenance_overdue",
      subject: m.name,
      detail: `${daysOver}d overdue${m.vendor ? ` · ${m.vendor}` : ""}`,
      due: m.next_due_at,
    });
  }

  // 2. Contact follow-ups owed
  const { data: followups } = await supa
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

  // 3. Refills due
  const { data: refills } = await supa
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
  const { data: docs } = await supa
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

  // 5. Vehicles
  const { data: vehicles } = await supa
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

  // 6. Neglected stay-in-touch contacts
  const { data: stayInTouch } = await supa.from("personal_contacts").select("id, name, relationship, tags");
  const stayIds = ((stayInTouch ?? []) as any[]).filter((c) => (c.tags ?? []).includes("stay_in_touch"));
  if (stayIds.length) {
    const { data: latest } = await supa
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

  // 7. Pet health due
  const { data: petHealth } = await supa
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
  const { data: blocked } = await supa
    .from("house_projects")
    .select("name, updated_at, next_step")
    .eq("status", "blocked");
  for (const p of (blocked ?? []) as any[]) {
    const days = Math.floor((today.getTime() - new Date(p.updated_at).getTime()) / 86_400_000);
    if (days >= 14) {
      signals.push({
        urgency: Math.min(6, 3 + Math.floor(days / 14)),
        category: "project_blocked",
        subject: p.name,
        detail: `blocked ${days}d${p.next_step ? ` · ${p.next_step}` : ""}`,
      });
    }
  }

  return signals.filter((s) => s.urgency >= minUrgency).sort((a, b) => b.urgency - a.urgency).slice(0, limit);
}

function formatBody(signals: Signal[]): string {
  if (signals.length === 0) return "🌅 Morning. Nothing urgent today.";
  const lines = [`🌅 *Morning briefing — ${signals.length} item${signals.length === 1 ? "" : "s"} need attention*`, ""];
  for (const s of signals) {
    lines.push(`• [${s.urgency}/10] ${s.category} — *${s.subject}*${s.detail ? `\n   ${s.detail}` : ""}`);
  }
  return lines.join("\n");
}

async function pushTelegram(env: Env, text: string): Promise<void> {
  const token = (env as any).TELEGRAM_BOT_TOKEN as string | undefined;
  const chatId = (env as any).CRON_PUSH_CHAT_ID as string | undefined;
  if (!token || !chatId) throw new Error("Telegram push requires TELEGRAM_BOT_TOKEN and CRON_PUSH_CHAT_ID");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!r.ok) throw new Error(`telegram push failed: ${r.status} ${await r.text()}`);
}

async function pushDiscord(env: Env, text: string): Promise<void> {
  const token = (env as any).DISCORD_BOT_TOKEN as string | undefined;
  const channelId = (env as any).CRON_PUSH_CHAT_ID as string | undefined;
  if (!token || !channelId) throw new Error("Discord push requires DISCORD_BOT_TOKEN and CRON_PUSH_CHAT_ID");
  const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!r.ok) throw new Error(`discord push failed: ${r.status} ${await r.text()}`);
}
