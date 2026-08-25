/**
 * health_metrics — read-side for vitals ingested from iPhone Shortcut / wearable.
 *
 * Ingestion is intentionally separate: build an iPhone Shortcut that POSTs
 * to a future /ingest/health endpoint on this Worker, or write a small
 * cron in n8n that pulls from your wearable's API. Keeps the MCP read-only
 * for sensitive data.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  metric: z.string().describe("e.g. 'weight_lb','sleep_hours','resting_hr','steps','hrv_ms'"),
  period_days: z.number().int().min(1).max(365).default(30),
  agg: z.enum(["raw", "daily_avg", "weekly_avg", "trend"]).default("trend"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "health_metrics",
    "Query health metrics ingested from iPhone/wearable. Returns recent values, daily/weekly averages, or trend summary (first half vs second half of period).",
    inputSchema,
    async ({ metric, period_days, agg }) => {
      try {
        const since = new Date(Date.now() - period_days * 86_400_000).toISOString();
        const { data, error } = await ctx.supabase
          .from("health_metrics")
          .select("recorded_at, value")
          .eq("metric", metric)
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: true });
        if (error) return fail("query failed", error);
        if (!data?.length) return ok(`No ${metric} data in the last ${period_days} days.`);
        const rows = data as Array<{ recorded_at: string; value: number }>;

        if (agg === "raw") {
          return ok(rows.slice(-30).map((r) => `- ${r.recorded_at.slice(0, 10)}: ${r.value}`).join("\n"));
        }
        if (agg === "daily_avg" || agg === "weekly_avg") {
          const bucketSize = agg === "daily_avg" ? 1 : 7;
          const buckets: Record<string, { sum: number; n: number }> = {};
          for (const r of rows) {
            const d = new Date(r.recorded_at);
            const bucket = bucketSize === 1
              ? r.recorded_at.slice(0, 10)
              : startOfWeek(d).toISOString().slice(0, 10);
            const b = (buckets[bucket] ??= { sum: 0, n: 0 });
            b.sum += r.value;
            b.n++;
          }
          return ok(
            Object.entries(buckets)
              .map(([k, v]) => `- ${k}: ${(v.sum / v.n).toFixed(2)} (n=${v.n})`)
              .join("\n"),
          );
        }
        // trend
        const mid = Math.floor(rows.length / 2);
        const avg = (arr: typeof rows) => arr.reduce((a, r) => a + r.value, 0) / arr.length;
        const first = avg(rows.slice(0, mid));
        const second = avg(rows.slice(mid));
        const delta = second - first;
        const pct = first !== 0 ? (delta / first) * 100 : 0;
        return ok(
          `**${metric}** over last ${period_days} days (n=${rows.length})\n` +
            `- First half avg: ${first.toFixed(2)}\n` +
            `- Second half avg: ${second.toFixed(2)}\n` +
            `- Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
        );
      } catch (e) {
        return fail("health_metrics failed", e);
      }
    },
  );
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}
