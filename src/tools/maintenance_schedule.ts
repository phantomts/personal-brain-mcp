/**
 * maintenance_schedule — list due/upcoming, log completion (auto-rolls next_due_at).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "log_done", "add"]).default("get"),
  window_days: z.number().int().min(0).max(365).default(60),
  task_id: z.string().uuid().optional(),
  performed_at: z.string().optional(),
  cost_cents: z.number().int().optional(),
  vendor: z.string().optional(),
  notes: z.string().optional(),
  // For add:
  new_task: z
    .object({
      name: z.string(),
      interval_days: z.number().int().optional(),
      next_due_at: z.string().optional(),
      vendor: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "maintenance_schedule",
    "Maintenance tasks (HVAC filters, septic, gutters, vehicle service). action=get lists due within N days, log_done records completion and rolls next_due_at, add creates a recurring task.",
    inputSchema,
    async ({ action, window_days, task_id, performed_at, cost_cents, vendor, notes, new_task }) => {
      try {
        if (action === "get") {
          const cutoff = new Date(Date.now() + window_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("maintenance_tasks")
            .select("*")
            .eq("active", true)
            .lte("next_due_at", cutoff)
            .order("next_due_at", { ascending: true });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No maintenance due in the next ${window_days} days.`);
          const today = new Date().toISOString().slice(0, 10);
          return ok(
            data
              .map((m: any) => {
                const overdue = m.next_due_at < today ? " **OVERDUE**" : "";
                return `- ${m.name} — due ${m.next_due_at}${overdue}${m.vendor ? ` · ${m.vendor}` : ""}${m.interval_days ? ` · every ${m.interval_days}d` : ""}`;
              })
              .join("\n"),
          );
        }

        if (action === "log_done") {
          if (!task_id) return fail("'task_id' required");
          const today = performed_at ?? new Date().toISOString().slice(0, 10);
          const { data: task, error: tErr } = await ctx.supabase
            .from("maintenance_tasks")
            .select("interval_days")
            .eq("id", task_id)
            .single();
          if (tErr) return fail("task lookup failed", tErr);
          const nextDue = task.interval_days
            ? new Date(new Date(today).getTime() + task.interval_days * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : null;
          const { error: hErr } = await ctx.supabase.from("maintenance_history").insert({
            task_id,
            performed_at: today,
            cost_cents,
            vendor,
            notes,
          });
          if (hErr) return fail("history insert failed", hErr);
          const { error: uErr } = await ctx.supabase
            .from("maintenance_tasks")
            .update({ last_done_at: today, next_due_at: nextDue })
            .eq("id", task_id);
          if (uErr) return fail("task update failed", uErr);
          return ok(`Logged. Next due: ${nextDue ?? "(one-off, no next date)"}.`);
        }

        if (action === "add") {
          if (!new_task?.name) return fail("'new_task.name' required");
          const { data, error } = await ctx.supabase
            .from("maintenance_tasks")
            .insert(new_task)
            .select("id, name")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Created "${data.name}" (id ${data.id}).`);
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("maintenance_schedule failed", e);
      }
    },
  );
}
