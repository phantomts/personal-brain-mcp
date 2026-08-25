/**
 * pets — list/add pets, log health events, find due vaccinations.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "get", "add", "update", "log_event", "due_events"]).default("list"),
  pet: z.string().optional().describe("Name or UUID"),
  within_days: z.number().int().default(30),
  payload: z
    .object({
      name: z.string().optional(),
      species: z.string().optional(),
      breed: z.string().optional(),
      sex: z.string().optional(),
      birthday: z.string().optional(),
      microchip: z.string().optional(),
      color: z.string().optional(),
      weight_lb: z.number().optional(),
      food_brand: z.string().optional(),
      food_notes: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  event: z
    .object({
      occurred_at: z.string().optional(),
      kind: z.string(),
      description: z.string().optional(),
      cost_cents: z.number().int().optional(),
      vendor: z.string().optional(),
      next_due_at: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "pets",
    "Manage pets and their health events. Actions: list active pets, get one, add, update, log_event (vaccine/vet/meds/etc.), due_events (what's coming up).",
    inputSchema,
    async ({ action, pet, within_days, payload, event }) => {
      try {
        async function resolvePet(): Promise<string | null> {
          if (!pet) return null;
          if (/^[0-9a-f-]{36}$/i.test(pet)) return pet;
          const { data } = await ctx.supabase.from("pets").select("id").ilike("name", `%${pet}%`).limit(1).maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          const { data, error } = await ctx.supabase.from("pets").select("*").eq("active", true);
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No pets recorded.");
          return ok(data.map((p: any) => `- **${p.name}** (${p.species ?? "?"}${p.breed ? `, ${p.breed}` : ""})${p.birthday ? ` · b. ${p.birthday}` : ""}${p.weight_lb ? ` · ${p.weight_lb} lb` : ""}`).join("\n"));
        }

        if (action === "get") {
          const id = await resolvePet();
          if (!id) return ok(`No pet matched "${pet}".`);
          const { data, error } = await ctx.supabase.from("pets").select("*").eq("id", id).single();
          if (error) return fail("query failed", error);
          const { data: events } = await ctx.supabase
            .from("pet_health_events")
            .select("*")
            .eq("pet_id", id)
            .order("occurred_at", { ascending: false })
            .limit(10);
          return ok(formatPet(data, events ?? []));
        }

        if (action === "add") {
          if (!payload?.name) return fail("'payload.name' required");
          const { data, error } = await ctx.supabase.from("pets").insert(payload).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.name}.`);
        }

        if (action === "update") {
          const id = await resolvePet();
          if (!id) return fail(`No pet matched "${pet}"`);
          if (!payload) return fail("'payload' required");
          const { error } = await ctx.supabase.from("pets").update(payload).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }

        if (action === "log_event") {
          const id = await resolvePet();
          if (!id) return fail(`No pet matched "${pet}"`);
          if (!event?.kind) return fail("'event.kind' required");
          const row = { pet_id: id, occurred_at: event.occurred_at ?? new Date().toISOString().slice(0, 10), ...event };
          const { error } = await ctx.supabase.from("pet_health_events").insert(row);
          if (error) return fail("insert failed", error);
          return ok(`Logged ${event.kind}.${event.next_due_at ? ` Next due ${event.next_due_at}.` : ""}`);
        }

        if (action === "due_events") {
          const cutoff = new Date(Date.now() + within_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("pet_health_events")
            .select("*, pets:pet_id (name)")
            .not("next_due_at", "is", null)
            .lte("next_due_at", cutoff)
            .order("next_due_at");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`Nothing due in next ${within_days} days.`);
          return ok(data.map((e: any) => `- ${e.next_due_at} · ${e.pets?.name ?? "?"} · ${e.kind}`).join("\n"));
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("pets failed", e);
      }
    },
  );
}

function formatPet(p: any, events: any[]): string {
  const lines = [`## ${p.name}`];
  const meta = [p.species, p.breed, p.sex, p.color].filter(Boolean).join(" · ");
  if (meta) lines.push(`_${meta}_`);
  if (p.birthday) lines.push(`- Born: ${p.birthday}`);
  if (p.acquired_at) lines.push(`- Acquired: ${p.acquired_at}`);
  if (p.microchip) lines.push(`- Microchip: ${p.microchip}`);
  if (p.weight_lb) lines.push(`- Weight: ${p.weight_lb} lb`);
  if (p.food_brand) lines.push(`- Food: ${p.food_brand}${p.food_notes ? ` (${p.food_notes})` : ""}`);
  if (p.notes) lines.push(`\n${p.notes}`);
  if (events.length) {
    lines.push("\n**Recent events:**");
    for (const e of events) lines.push(`- ${e.occurred_at} · ${e.kind}${e.description ? `: ${e.description}` : ""}${e.next_due_at ? ` (next due ${e.next_due_at})` : ""}`);
  }
  return lines.join("\n");
}
