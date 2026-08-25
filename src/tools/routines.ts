/**
 * routines — event-invoked checklists (morning routine, leaving for trip,
 * closing the cabin, hosting guests).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "get", "create", "add_step", "update_step", "remove_step", "archive"]).default("list"),
  routine: z.string().optional(),
  payload: z
    .object({
      name: z.string().optional(),
      trigger_kind: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  step: z
    .object({
      step_order: z.number().int().optional(),
      step: z.string().optional(),
      optional: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  step_id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "routines",
    "Event-invoked checklists (morning routine, leaving for a trip, closing the cabin). Manage routines and their ordered steps.",
    inputSchema,
    async ({ action, routine, payload, step, step_id }) => {
      try {
        async function resolveRoutine(): Promise<string | null> {
          if (!routine) return null;
          if (/^[0-9a-f-]{36}$/i.test(routine)) return routine;
          const { data } = await ctx.supabase.from("routines").select("id").ilike("name", `%${routine}%`).limit(1).maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          const { data, error } = await ctx.supabase.from("routines").select("*").eq("active", true).order("name");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No routines.");
          return ok(data.map((r: any) => `- **${r.name}**${r.trigger_kind ? ` (${r.trigger_kind})` : ""}${r.description ? `: ${r.description}` : ""}`).join("\n"));
        }

        if (action === "get") {
          const id = await resolveRoutine();
          if (!id) return ok(`No routine matched "${routine}".`);
          const [r, steps] = await Promise.all([
            ctx.supabase.from("routines").select("*").eq("id", id).single(),
            ctx.supabase.from("routine_steps").select("*").eq("routine_id", id).order("step_order"),
          ]);
          if (r.error) return fail("query failed", r.error);
          const lines = [`## ${r.data.name}`];
          if (r.data.description) lines.push(`_${r.data.description}_`);
          for (const s of (steps.data ?? []) as any[]) {
            lines.push(`${s.step_order}. [ ] ${s.step}${s.optional ? " (opt)" : ""}${s.notes ? ` — ${s.notes}` : ""}`);
          }
          return ok(lines.join("\n"));
        }

        if (action === "create") {
          if (!payload?.name) return fail("'payload.name' required");
          const { data, error } = await ctx.supabase.from("routines").insert(payload as any).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Created routine "${data.name}". Add steps with action=add_step.`);
        }

        if (action === "add_step") {
          const id = await resolveRoutine();
          if (!id) return fail(`No routine matched "${routine}"`);
          if (!step?.step) return fail("'step.step' required");
          // Auto-assign step_order if missing
          let order = step.step_order;
          if (order == null) {
            const { data: existing } = await ctx.supabase.from("routine_steps").select("step_order").eq("routine_id", id).order("step_order", { ascending: false }).limit(1);
            order = ((existing?.[0]?.step_order as number) ?? 0) + 1;
          }
          const { error } = await ctx.supabase.from("routine_steps").insert({ routine_id: id, step_order: order, step: step.step, optional: step.optional ?? false, notes: step.notes });
          if (error) return fail("insert failed", error);
          return ok(`Added step ${order}.`);
        }

        if (action === "update_step") {
          if (!step_id) return fail("'step_id' required");
          const { error } = await ctx.supabase.from("routine_steps").update(step as any).eq("id", step_id);
          if (error) return fail("update failed", error);
          return ok("Step updated.");
        }

        if (action === "remove_step") {
          if (!step_id) return fail("'step_id' required");
          const { error } = await ctx.supabase.from("routine_steps").delete().eq("id", step_id);
          if (error) return fail("delete failed", error);
          return ok("Step removed.");
        }

        if (action === "archive") {
          const id = await resolveRoutine();
          if (!id) return fail(`No routine matched "${routine}"`);
          await ctx.supabase.from("routines").update({ active: false }).eq("id", id);
          return ok("Archived.");
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("routines failed", e);
      }
    },
  );
}
