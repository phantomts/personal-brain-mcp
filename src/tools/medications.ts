/**
 * medications — active meds per person + refill alerts.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "refills_due", "add", "discontinue"]).default("list"),
  person: z.string().optional(),
  within_days: z.number().int().default(14),
  med: z
    .object({
      person: z.string(),
      name: z.string(),
      dosage: z.string().optional(),
      frequency: z.string().optional(),
      prescriber: z.string().optional(),
      pharmacy: z.string().optional(),
      rx_number: z.string().optional(),
      started_at: z.string().optional(),
      refill_due_at: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  med_id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "medications",
    "Manage medications. list shows active meds (optionally by person), refills_due shows what needs refilling within N days, add creates a med, discontinue marks one inactive.",
    inputSchema,
    async ({ action, person, within_days, med, med_id }) => {
      try {
        async function resolvePerson(name?: string): Promise<string | null | undefined> {
          if (!name) return undefined;
          const { data } = await ctx.supabase
            .from("people")
            .select("id")
            .ilike("name", `%${name}%`)
            .limit(1)
            .maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          let q = ctx.supabase.from("medications").select("*, people:person_id (name)").eq("active", true);
          if (person) {
            const pid = await resolvePerson(person);
            if (!pid) return ok(`No person matched "${person}".`);
            q = q.eq("person_id", pid);
          }
          const { data, error } = await q.order("name");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No active medications.");
          return ok(
            data
              .map(
                (m: any) =>
                  `- **${m.people?.name ?? "?"}**: ${m.name}${m.dosage ? ` ${m.dosage}` : ""}${m.frequency ? ` · ${m.frequency}` : ""}${m.refill_due_at ? ` · refill ${m.refill_due_at}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "refills_due") {
          const cutoff = new Date(Date.now() + within_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("medications")
            .select("*, people:person_id (name)")
            .eq("active", true)
            .not("refill_due_at", "is", null)
            .lte("refill_due_at", cutoff)
            .order("refill_due_at");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No refills due in the next ${within_days} days.`);
          return ok(
            data
              .map((m: any) => `- ${m.refill_due_at} — ${m.people?.name ?? "?"} · ${m.name}${m.pharmacy ? ` @ ${m.pharmacy}` : ""}`)
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!med?.person || !med.name) return fail("'med.person' and 'med.name' required");
          const pid = await resolvePerson(med.person);
          if (!pid) return ok(`No person matched "${med.person}". Add them to people first.`);
          const { person: _, ...rest } = med;
          const { error } = await ctx.supabase.from("medications").insert({ person_id: pid, ...rest });
          if (error) return fail("insert failed", error);
          return ok(`Added ${med.name}.`);
        }
        if (action === "discontinue") {
          if (!med_id) return fail("'med_id' required");
          const { error } = await ctx.supabase
            .from("medications")
            .update({ active: false, ended_at: new Date().toISOString().slice(0, 10) })
            .eq("id", med_id);
          if (error) return fail("update failed", error);
          return ok("Discontinued.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("medications failed", e);
      }
    },
  );
}
