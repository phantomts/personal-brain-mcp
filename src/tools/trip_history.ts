/**
 * trip_history — past and upcoming personal trips, with filters.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "log_return"]).default("list"),
  query: z.string().optional(),
  trip_type: z.string().optional(),
  min_rating: z.number().int().min(1).max(5).optional(),
  upcoming_only: z.boolean().default(false),
  // for add:
  trip: z
    .object({
      name: z.string(),
      destination: z.string().optional(),
      country: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      trip_type: z.string().optional(),
      companions: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .optional(),
  // for log_return:
  trip_id: z.string().uuid().optional(),
  highlights: z.string().optional(),
  lowlights: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  total_cost_cents: z.number().int().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "trip_history",
    "Personal travel history. action=list shows trips (filterable), add creates a planned/past trip, log_return adds highlights/rating after the trip.",
    inputSchema,
    async ({ action, query, trip_type, min_rating, upcoming_only, trip, trip_id, highlights, lowlights, rating, total_cost_cents }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("trips").select("*").limit(50);
          if (query) q = q.or(`name.ilike.%${query}%,destination.ilike.%${query}%,country.ilike.%${query}%`);
          if (trip_type) q = q.eq("trip_type", trip_type);
          if (min_rating) q = q.gte("rating", min_rating);
          if (upcoming_only) q = q.gte("start_date", new Date().toISOString().slice(0, 10));
          const { data, error } = await q.order("start_date", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No trips match.");
          return ok(data.map(formatTrip).join("\n\n"));
        }
        if (action === "add") {
          if (!trip?.name) return fail("'trip.name' required");
          const { data, error } = await ctx.supabase.from("trips").insert(trip).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added trip "${data.name}" (id ${data.id}).`);
        }
        if (action === "log_return") {
          if (!trip_id) return fail("'trip_id' required");
          const { data, error } = await ctx.supabase
            .from("trips")
            .update({ highlights, lowlights, rating, total_cost_cents })
            .eq("id", trip_id)
            .select("name")
            .single();
          if (error) return fail("update failed", error);
          return ok(`Logged return for "${data.name}".`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("trip_history failed", e);
      }
    },
  );
}

function formatTrip(t: any): string {
  const lines = [`### ${t.name}${t.destination ? ` — ${t.destination}` : ""}`];
  const dates = [t.start_date, t.end_date].filter(Boolean).join(" → ");
  const meta = [dates, t.trip_type, t.rating ? `${t.rating}/5` : null].filter(Boolean).join(" · ");
  if (meta) lines.push(`_${meta}_`);
  if (t.companions?.length) lines.push(`- With: ${t.companions.join(", ")}`);
  if (t.highlights) lines.push(`- ✨ ${t.highlights}`);
  if (t.lowlights) lines.push(`- ⚠ ${t.lowlights}`);
  if (t.total_cost_cents) lines.push(`- Cost: $${(t.total_cost_cents / 100).toFixed(2)}`);
  return lines.join("\n");
}
