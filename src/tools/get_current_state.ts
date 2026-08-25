/**
 * get_current_state — Layer 2: what's true right now. Composite tool that
 * joins live data from many tables to give an agent the "what's going on
 * with the user" snapshot.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  include: z
    .array(
      z.enum([
        "active_projects",
        "active_personal_projects",
        "active_meds",
        "active_subscriptions",
        "active_pets",
        "active_vehicles",
        "active_properties",
        "open_shopping",
        "upcoming_trip",
      ]),
    )
    .optional()
    .describe("Limit to specific aspects; defaults to all"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "get_current_state",
    "Snapshot of the user.s current life state: active projects, current meds, active subscriptions, pets, vehicles, properties, next trip. The 'what's true right now' tool. Use at session start for context.",
    inputSchema,
    async ({ include }) => {
      try {
        const want = (k: string) => !include || include.length === 0 || (include as string[]).includes(k);
        const out: string[] = ["# Current state\n"];

        // Supabase query builders are thenable but not Promise-typed; PromiseLike keeps
        // Promise.all happy without casting every call site.
        const queries: Array<PromiseLike<any>> = [];
        if (want("active_projects"))
          queries.push(ctx.supabase.from("house_projects").select("name, status").in("status", ["in_progress", "blocked"]));
        if (want("active_personal_projects"))
          queries.push(ctx.supabase.from("personal_projects").select("name, next_step").eq("status", "active"));
        if (want("active_meds"))
          queries.push(ctx.supabase.from("medications").select("name, dosage, people:person_id(name)").eq("active", true));
        if (want("active_subscriptions"))
          queries.push(ctx.supabase.from("subscriptions").select("name, amount_cents, cadence").eq("active", true));
        if (want("active_pets")) queries.push(ctx.supabase.from("pets").select("name, species").eq("active", true));
        if (want("active_vehicles")) queries.push(ctx.supabase.from("vehicles").select("nickname, make, model").eq("active", true));
        if (want("active_properties")) queries.push(ctx.supabase.from("properties").select("nickname, property_type, city, state").eq("active", true));
        if (want("open_shopping")) queries.push(ctx.supabase.from("shopping").select("item", { count: "exact" }).eq("status", "open"));
        if (want("upcoming_trip"))
          queries.push(
            ctx.supabase
              .from("trips")
              .select("name, destination, start_date")
              .gte("start_date", new Date().toISOString().slice(0, 10))
              .order("start_date")
              .limit(1),
          );

        const results = await Promise.all(queries);
        let idx = 0;

        const consume = (label: string, fmt: (rows: any[]) => string) => {
          if (!want(camel(label))) return;
          const r = results[idx++];
          const rows = r?.data ?? [];
          if (rows.length) {
            out.push(`## ${label}`);
            out.push(fmt(rows));
            out.push("");
          }
        };

        consume("active_projects", (rows) => rows.map((p) => `- ${p.name} [${p.status}]`).join("\n"));
        consume("active_personal_projects", (rows) => rows.map((p) => `- ${p.name}${p.next_step ? ` → ${p.next_step}` : ""}`).join("\n"));
        consume("active_meds", (rows) => rows.map((m) => `- ${m.people?.name ?? "?"}: ${m.name}${m.dosage ? ` ${m.dosage}` : ""}`).join("\n"));
        consume("active_subscriptions", (rows) => {
          const factor: any = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };
          const total = rows.reduce((acc, s: any) => acc + s.amount_cents * (factor[s.cadence] ?? 1), 0);
          return `${rows.length} active · $${(total / 100).toFixed(2)} / month equivalent`;
        });
        consume("active_pets", (rows) => rows.map((p) => `- ${p.name} (${p.species ?? "?"})`).join("\n"));
        consume("active_vehicles", (rows) => rows.map((v) => `- ${v.nickname ?? `${v.make} ${v.model}`}`).join("\n"));
        consume("active_properties", (rows) => rows.map((p) => `- ${p.nickname} (${p.property_type ?? "?"}) — ${[p.city, p.state].filter(Boolean).join(", ")}`).join("\n"));
        if (want("open_shopping")) {
          const r = results[idx++];
          const count = (r as any)?.count ?? r?.data?.length ?? 0;
          if (count > 0) {
            out.push(`## open_shopping\n${count} open items\n`);
          }
        }
        if (want("upcoming_trip")) {
          const r = results[idx++];
          const rows = r?.data ?? [];
          if (rows.length) {
            const t = rows[0];
            out.push(`## upcoming_trip\n${t.start_date} · ${t.name}${t.destination ? ` — ${t.destination}` : ""}\n`);
          }
        }

        return ok(out.join("\n"));
      } catch (e) {
        return fail("get_current_state failed", e);
      }
    },
  );
}

function camel(s: string): string {
  return s; // already snake; kept for clarity
}
