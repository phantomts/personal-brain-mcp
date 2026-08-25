/**
 * vehicles — fleet + service history, mileage-aware "what's due" logic.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "get", "add", "update", "log_service", "due_services", "update_mileage"]).default("list"),
  vehicle: z.string().optional().describe("Nickname or UUID"),
  within_days: z.number().int().default(60),
  payload: z.record(z.unknown()).optional(),
  service: z
    .object({
      performed_at: z.string().optional(),
      service_type: z.string(),
      mileage_at_service: z.number().int().optional(),
      cost_cents: z.number().int().optional(),
      vendor: z.string().optional(),
      next_due_mileage: z.number().int().optional(),
      next_due_at: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  new_mileage: z.number().int().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "vehicles",
    "Manage vehicles (cars, trucks, mowers, ATVs) + service history. Tracks mileage, insurance, registration, inspections. due_services lists upcoming maintenance by date or mileage.",
    inputSchema,
    async ({ action, vehicle, within_days, payload, service, new_mileage }) => {
      try {
        async function resolveVehicle(): Promise<string | null> {
          if (!vehicle) return null;
          if (/^[0-9a-f-]{36}$/i.test(vehicle)) return vehicle;
          const { data } = await ctx.supabase
            .from("vehicles")
            .select("id")
            .or(`nickname.ilike.%${vehicle}%,model.ilike.%${vehicle}%`)
            .limit(1)
            .maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          const { data, error } = await ctx.supabase.from("vehicles").select("*").eq("active", true).order("nickname");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No vehicles recorded.");
          return ok(
            data
              .map(
                (v: any) =>
                  `- **${v.nickname ?? `${v.year} ${v.make} ${v.model}`}** — ${v.year ?? "?"} ${v.make ?? ""} ${v.model ?? ""}${v.current_mileage ? ` · ${v.current_mileage.toLocaleString()} mi` : ""}${v.license_plate ? ` · ${v.license_plate}` : ""}`,
              )
              .join("\n"),
          );
        }

        if (action === "get") {
          const id = await resolveVehicle();
          if (!id) return ok(`No vehicle matched "${vehicle}".`);
          const [v, history] = await Promise.all([
            ctx.supabase.from("vehicles").select("*").eq("id", id).single(),
            ctx.supabase
              .from("vehicle_service_history")
              .select("*")
              .eq("vehicle_id", id)
              .order("performed_at", { ascending: false })
              .limit(10),
          ]);
          if (v.error) return fail("query failed", v.error);
          return ok(formatVehicle(v.data, history.data ?? []));
        }

        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { data, error } = await ctx.supabase
            .from("vehicles")
            .insert(payload as any)
            .select("id, nickname, make, model")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.nickname ?? `${data.make} ${data.model}`}.`);
        }

        if (action === "update") {
          const id = await resolveVehicle();
          if (!id) return fail(`No vehicle matched "${vehicle}"`);
          if (!payload) return fail("'payload' required");
          const { error } = await ctx.supabase.from("vehicles").update(payload as any).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }

        if (action === "update_mileage") {
          const id = await resolveVehicle();
          if (!id) return fail(`No vehicle matched "${vehicle}"`);
          if (new_mileage == null) return fail("'new_mileage' required");
          const { error } = await ctx.supabase.from("vehicles").update({ current_mileage: new_mileage }).eq("id", id);
          if (error) return fail("update failed", error);
          return ok(`Mileage updated to ${new_mileage.toLocaleString()}.`);
        }

        if (action === "log_service") {
          const id = await resolveVehicle();
          if (!id) return fail(`No vehicle matched "${vehicle}"`);
          if (!service?.service_type) return fail("'service.service_type' required");
          const row = {
            vehicle_id: id,
            performed_at: service.performed_at ?? new Date().toISOString().slice(0, 10),
            ...service,
          };
          const { error } = await ctx.supabase.from("vehicle_service_history").insert(row);
          if (error) return fail("insert failed", error);
          // If service included mileage, update current_mileage if it's newer
          if (service.mileage_at_service) {
            await ctx.supabase
              .from("vehicles")
              .update({ current_mileage: service.mileage_at_service })
              .eq("id", id)
              .lt("current_mileage", service.mileage_at_service);
          }
          return ok(`Logged ${service.service_type}.${service.next_due_at ? ` Next due ${service.next_due_at}.` : ""}${service.next_due_mileage ? ` Next due at ${service.next_due_mileage} mi.` : ""}`);
        }

        if (action === "due_services") {
          const cutoffDate = new Date(Date.now() + within_days * 86_400_000).toISOString().slice(0, 10);
          // Date-based due
          const { data: dueByDate } = await ctx.supabase
            .from("vehicle_service_history")
            .select("*, vehicles:vehicle_id (nickname, current_mileage)")
            .not("next_due_at", "is", null)
            .lte("next_due_at", cutoffDate);
          // Mileage-based due
          const { data: vehicles } = await ctx.supabase.from("vehicles").select("id, nickname, current_mileage").eq("active", true);
          const dueByMileage: any[] = [];
          for (const v of vehicles ?? []) {
            if (v.current_mileage == null) continue;
            const { data: rec } = await ctx.supabase
              .from("vehicle_service_history")
              .select("*")
              .eq("vehicle_id", v.id)
              .not("next_due_mileage", "is", null)
              .lte("next_due_mileage", v.current_mileage + 500); // 500-mile lookahead
            for (const r of rec ?? []) dueByMileage.push({ ...r, vehicles: v });
          }
          const all = [...(dueByDate ?? []), ...dueByMileage];
          if (!all.length) return ok(`Nothing due in next ${within_days} days or 500 miles.`);
          return ok(
            all
              .map(
                (s: any) =>
                  `- ${s.vehicles?.nickname ?? "?"} · ${s.service_type}${s.next_due_at ? ` · by ${s.next_due_at}` : ""}${s.next_due_mileage ? ` · at ${s.next_due_mileage} mi (now ${s.vehicles?.current_mileage ?? "?"})` : ""}`,
              )
              .join("\n"),
          );
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("vehicles failed", e);
      }
    },
  );
}

function formatVehicle(v: any, history: any[]): string {
  const lines = [`## ${v.nickname ?? `${v.year} ${v.make} ${v.model}`}`];
  lines.push(`_${v.year ?? "?"} ${v.make ?? ""} ${v.model ?? ""}${v.trim ? ` ${v.trim}` : ""}${v.color ? ` · ${v.color}` : ""}_`);
  if (v.vin) lines.push(`- VIN: ${v.vin}`);
  if (v.license_plate) lines.push(`- Plate: ${v.license_plate}${v.state_registered ? ` (${v.state_registered})` : ""}`);
  if (v.current_mileage != null) lines.push(`- Mileage: ${v.current_mileage.toLocaleString()}`);
  if (v.insurance_carrier) lines.push(`- Insurance: ${v.insurance_carrier}${v.insurance_renews_at ? ` · renews ${v.insurance_renews_at}` : ""}`);
  if (v.registration_renews_at) lines.push(`- Registration renews: ${v.registration_renews_at}`);
  if (v.inspection_due_at) lines.push(`- Inspection due: ${v.inspection_due_at}`);
  if (v.notes) lines.push(`\n${v.notes}`);
  if (history.length) {
    lines.push("\n**Service history:**");
    for (const h of history) lines.push(`- ${h.performed_at} · ${h.service_type}${h.mileage_at_service ? ` @ ${h.mileage_at_service} mi` : ""}${h.vendor ? ` · ${h.vendor}` : ""}${h.cost_cents ? ` · $${(h.cost_cents / 100).toFixed(2)}` : ""}`);
  }
  return lines.join("\n");
}
