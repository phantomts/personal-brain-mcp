/**
 * workouts — log + summarize. Pairs with health_metrics for trend questions.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["recent", "log", "summary"]).default("recent"),
  period_days: z.number().int().min(1).max(365).default(30),
  workout: z
    .object({
      activity: z.string(),
      duration_min: z.number().int().optional(),
      distance_mi: z.number().optional(),
      calories: z.number().int().optional(),
      intensity: z.enum(["easy", "moderate", "hard"]).optional(),
      notes: z.string().optional(),
      performed_at: z.string().optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "workouts",
    "View recent workouts, log a new workout, or get a weekly summary by activity.",
    inputSchema,
    async ({ action, period_days, workout }) => {
      try {
        const since = new Date(Date.now() - period_days * 86_400_000).toISOString();
        if (action === "recent") {
          const { data, error } = await ctx.supabase
            .from("workouts")
            .select("*")
            .gte("performed_at", since)
            .order("performed_at", { ascending: false })
            .limit(30);
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No workouts in the last ${period_days} days.`);
          return ok(
            data
              .map(
                (w: any) =>
                  `- ${w.performed_at.slice(0, 10)} · ${w.activity}${w.duration_min ? ` · ${w.duration_min}min` : ""}${w.distance_mi ? ` · ${w.distance_mi}mi` : ""}${w.intensity ? ` · ${w.intensity}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "log") {
          if (!workout?.activity) return fail("'workout.activity' required");
          const { error } = await ctx.supabase.from("workouts").insert({ ...workout, source: "manual" });
          if (error) return fail("insert failed", error);
          return ok("Workout logged.");
        }
        if (action === "summary") {
          const { data, error } = await ctx.supabase
            .from("workouts")
            .select("activity, duration_min, distance_mi")
            .gte("performed_at", since);
          if (error) return fail("query failed", error);
          const agg: Record<string, { count: number; min: number; mi: number }> = {};
          for (const w of (data ?? []) as any[]) {
            const a = (agg[w.activity] ??= { count: 0, min: 0, mi: 0 });
            a.count++;
            a.min += w.duration_min ?? 0;
            a.mi += w.distance_mi ?? 0;
          }
          const lines = Object.entries(agg)
            .sort(([, a], [, b]) => b.count - a.count)
            .map(([act, v]) => `- ${act}: ${v.count}× · ${v.min} min${v.mi ? ` · ${v.mi.toFixed(1)} mi` : ""}`);
          return ok(lines.length ? `Last ${period_days} days:\n${lines.join("\n")}` : "No workouts.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("workouts failed", e);
      }
    },
  );
}
