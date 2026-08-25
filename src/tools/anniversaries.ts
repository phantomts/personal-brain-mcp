/**
 * anniversaries — wedding, met dates, deaths, milestones. Repeating or
 * one-time. Surfaces in upcoming_dates.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "remove"]).default("list"),
  kind: z.string().optional(),
  payload: z
    .object({
      label: z.string(),
      occurs_on: z.string(),
      kind: z.string().optional(),
      involves: z.array(z.string()).optional(),
      recurring: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "anniversaries",
    "Anniversaries and important repeating dates beyond birthdays (wedding, met, deaths, milestones).",
    inputSchema,
    async ({ action, kind, payload, id }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("anniversaries").select("*").eq("active", true);
          if (kind) q = q.eq("kind", kind);
          const { data, error } = await q.order("occurs_on");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No anniversaries recorded.");
          return ok(
            data
              .map((a: any) => `- **${a.label}** — ${a.occurs_on}${a.recurring === false ? " (one-time)" : ""}${a.involves?.length ? ` · ${a.involves.join(", ")}` : ""}`)
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { error } = await ctx.supabase.from("anniversaries").insert(payload as any);
          if (error) return fail("insert failed", error);
          return ok(`Added ${payload.label}.`);
        }
        if (action === "remove") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("anniversaries").update({ active: false }).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Archived.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("anniversaries failed", e);
      }
    },
  );
}
