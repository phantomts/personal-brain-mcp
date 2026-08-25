/**
 * dietary_prefs — per-person allergies/dislikes/preferences. Critical
 * for hosting guests and meal-planning.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "add", "remove"]).default("get"),
  person: z.string().optional(),
  // for add:
  pref: z
    .object({
      kind: z.enum(["allergy", "dislike", "prefers", "restriction"]),
      item: z.string(),
      severity: z.enum(["mild", "severe", "life_threatening"]).optional(),
      notes: z.string().optional(),
    })
    .optional(),
  pref_id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "dietary_prefs",
    "Get or modify dietary preferences for a person (allergies, dislikes, restrictions). Use before menu-planning for guests.",
    inputSchema,
    async ({ action, person, pref, pref_id }) => {
      try {
        let person_id: string | undefined;
        if (person) {
          const { data: p } = await ctx.supabase
            .from("people")
            .select("id")
            .ilike("name", `%${person}%`)
            .limit(1)
            .maybeSingle();
          person_id = p?.id;
          if (!person_id) return ok(`No person matched "${person}".`);
        }

        if (action === "get") {
          let q = ctx.supabase
            .from("dietary_prefs")
            .select("*, people:person_id (name)")
            .order("kind", { ascending: true });
          if (person_id) q = q.eq("person_id", person_id);
          const { data, error } = await q;
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No dietary preferences recorded.");
          const lines = data.map((d: any) => {
            const name = d.people?.name ?? "(unknown)";
            const sev = d.severity ? ` (${d.severity})` : "";
            return `- **${name}** ${d.kind}: ${d.item}${sev}${d.notes ? ` — ${d.notes}` : ""}`;
          });
          return ok(lines.join("\n"));
        }
        if (action === "add") {
          if (!person_id) return fail("'person' required");
          if (!pref) return fail("'pref' required");
          const { error } = await ctx.supabase.from("dietary_prefs").insert({ person_id, ...pref });
          if (error) return fail("insert failed", error);
          return ok(`Recorded ${pref.kind}: ${pref.item}.`);
        }
        if (action === "remove") {
          if (!pref_id) return fail("'pref_id' required");
          const { error } = await ctx.supabase.from("dietary_prefs").delete().eq("id", pref_id);
          if (error) return fail("delete failed", error);
          return ok("Removed.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("dietary_prefs failed", e);
      }
    },
  );
}
