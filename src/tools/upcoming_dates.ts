/**
 * upcoming_dates — unified "next N days" across every dated table.
 * Reads the brain.upcoming_dates view defined in migration 0002.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  days: z.number().int().min(1).max(365).default(30),
  kinds: z
    .array(
      z.enum([
        "birthday",
        "maintenance",
        "warranty_expires",
        "medication_refill",
        "subscription_renews",
        "trip_departs",
        "provider_visit",
        "contact_followup",
      ]),
    )
    .optional()
    .describe("Filter to specific kinds"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "upcoming_dates",
    "Unified view of every upcoming date in the next N days: birthdays, maintenance due, warranties expiring, medication refills, subscription renewals, trips, provider visits, and follow-ups owed.",
    inputSchema,
    async ({ days, kinds }) => {
      try {
        const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        let q = ctx.supabase
          .from("upcoming_dates")
          .select("*")
          .gte("due_date", new Date().toISOString().slice(0, 10))
          .lte("due_date", cutoff);
        if (kinds?.length) q = q.in("kind", kinds);
        const { data, error } = await q.order("due_date", { ascending: true }).limit(200);
        if (error) return fail("query failed", error);
        if (!data?.length) return ok(`Nothing on the radar in the next ${days} days.`);
        const byDate: Record<string, string[]> = {};
        for (const r of data as any[]) {
          (byDate[r.due_date] ??= []).push(`  - [${r.kind}] ${r.label}${r.detail ? ` · ${r.detail}` : ""}`);
        }
        const lines = Object.entries(byDate).map(([d, items]) => `**${d}**\n${items.join("\n")}`);
        return ok(lines.join("\n\n"));
      } catch (e) {
        return fail("upcoming_dates failed", e);
      }
    },
  );
}
