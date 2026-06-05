/**
 * POST /ingest/expense
 *
 * Quick household-expense capture from Shortcuts ("Hey Siri, log $42 for groceries at Aldi").
 *
 * Body:
 * {
 *   "amount": 42.50,            // OR "amount_cents": 4250
 *   "category": "grocery",
 *   "vendor": "Aldi",           // optional
 *   "description": "weekly",    // optional
 *   "occurred_at": "YYYY-MM-DD" // optional, defaults today
 * }
 */
import type { Env } from "../index";
import { createSupabase } from "../lib/supabase";

const ALLOWED_CATEGORIES = ["house_project", "grocery", "utility", "maintenance", "subscription", "auto", "other"];

export async function ingestExpense(body: unknown, env: Env): Promise<{ status: number; body: unknown }> {
  const b = body as any;
  if (!b || typeof b !== "object") return { status: 400, body: { error: "object required" } };

  const cents = typeof b.amount_cents === "number"
    ? Math.round(b.amount_cents)
    : typeof b.amount === "number"
      ? Math.round(b.amount * 100)
      : null;
  if (cents == null || !Number.isFinite(cents) || cents <= 0) {
    return { status: 400, body: { error: "'amount' (dollars) or 'amount_cents' (int) required and positive" } };
  }
  if (!b.category || !ALLOWED_CATEGORIES.includes(b.category)) {
    return { status: 400, body: { error: `category must be one of ${ALLOWED_CATEGORIES.join(", ")}` } };
  }

  const supa = createSupabase(env);
  const { error } = await supa.from("household_expenses").insert({
    category: b.category,
    subcategory: b.subcategory ?? null,
    amount_cents: cents,
    vendor: b.vendor ?? null,
    description: b.description ?? null,
    occurred_at: b.occurred_at ?? new Date().toISOString().slice(0, 10),
  });
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true, amount_cents: cents } };
}
