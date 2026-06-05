/**
 * POST /ingest/health
 *
 * Accepts an array of vitals (or a single vital) from iPhone Shortcuts,
 * Apple Health export, or any wearable webhook. Inserts into brain.health_metrics.
 *
 * Body shape (flexible — accepts single object or array):
 * {
 *   "metric": "weight_lb" | "sleep_hours" | "resting_hr" | "steps" | "hrv_ms" | <any>,
 *   "value": number,
 *   "recorded_at": ISO string (optional; defaults to now),
 *   "source": string (optional; e.g. "apple_health"),
 *   "notes": string (optional)
 * }
 *
 * OR:
 * { "samples": [ {metric,value,recorded_at?,source?,notes?}, ... ] }
 */
import type { Env } from "../index";
import { createSupabase } from "../lib/supabase";

type Sample = {
  metric: string;
  value: number;
  recorded_at?: string;
  source?: string;
  notes?: string;
};

export async function ingestHealth(body: unknown, env: Env): Promise<{ status: number; body: unknown }> {
  const samples: Sample[] = normalize(body);
  if (!samples.length) return { status: 400, body: { error: "no samples" } };

  for (const s of samples) {
    if (!s.metric || typeof s.value !== "number" || !Number.isFinite(s.value)) {
      return { status: 400, body: { error: "each sample requires metric (string) and value (finite number)", offending: s } };
    }
  }

  const supabase = createSupabase(env);
  const rows = samples.map((s) => ({
    metric: s.metric,
    value: s.value,
    recorded_at: s.recorded_at ?? new Date().toISOString(),
    source: s.source ?? "iphone_shortcut",
    notes: s.notes,
  }));

  const { error, count } = await supabase.from("health_metrics").insert(rows, { count: "exact" });
  if (error) return { status: 500, body: { error: "insert failed", detail: error.message } };

  return { status: 200, body: { ok: true, inserted: count ?? rows.length } };
}

function normalize(body: unknown): Sample[] {
  if (!body || typeof body !== "object") return [];
  const b = body as any;
  if (Array.isArray(b)) return b as Sample[];
  if (Array.isArray(b.samples)) return b.samples as Sample[];
  if (typeof b.metric === "string" && typeof b.value === "number") return [b as Sample];
  return [];
}
