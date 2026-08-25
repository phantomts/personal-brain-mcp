/**
 * last_seen — who am I neglecting? Sorts personal_contacts by last interaction
 * ascending (oldest = most neglected).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  min_days_since: z.number().int().min(0).default(30),
  relationship_filter: z.string().optional(),
  tags_filter: z.array(z.string()).optional(),
  limit: z.number().int().default(15),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "last_seen",
    "Who am I neglecting? Returns personal contacts sorted by oldest last-interaction. Filter by minimum days since contact, relationship type, or tags.",
    inputSchema,
    async ({ min_days_since, relationship_filter, tags_filter, limit }) => {
      try {
        let q = ctx.supabase.from("personal_contacts").select("id, name, relationship, tags");
        if (relationship_filter) q = q.ilike("relationship", `%${relationship_filter}%`);
        if (tags_filter?.length) q = q.overlaps("tags", tags_filter);
        const { data: contacts, error } = await q;
        if (error) return fail("query failed", error);
        if (!contacts?.length) return ok("No contacts.");

        // Pull last interaction per contact
        const ids = contacts.map((c: any) => c.id);
        const { data: ix } = await ctx.supabase
          .from("contact_interactions")
          .select("contact_id, occurred_at")
          .in("contact_id", ids)
          .order("occurred_at", { ascending: false });

        const lastByContact = new Map<string, string>();
        for (const i of (ix ?? []) as any[]) {
          if (!lastByContact.has(i.contact_id)) lastByContact.set(i.contact_id, i.occurred_at);
        }

        const now = Date.now();
        const enriched = (contacts as any[]).map((c) => {
          const last = lastByContact.get(c.id);
          const daysSince = last
            ? Math.floor((now - new Date(last).getTime()) / 86_400_000)
            : 99999;
          return { ...c, last, daysSince };
        });

        const filtered = enriched.filter((c) => c.daysSince >= min_days_since);
        filtered.sort((a, b) => b.daysSince - a.daysSince);

        const top = filtered.slice(0, limit);
        if (!top.length) return ok(`No contacts gone more than ${min_days_since} days without contact.`);

        return ok(
          top
            .map((c) =>
              c.last
                ? `- **${c.name}**${c.relationship ? ` (${c.relationship})` : ""} — ${c.daysSince}d ago (${c.last.slice(0, 10)})`
                : `- **${c.name}**${c.relationship ? ` (${c.relationship})` : ""} — never logged`,
            )
            .join("\n"),
        );
      } catch (e) {
        return fail("last_seen failed", e);
      }
    },
  );
}
