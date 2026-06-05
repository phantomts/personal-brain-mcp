/**
 * recall_conversation — search journal + interaction history for a topic
 * or a person. Joins memory entries mentioning a name with logged
 * touchpoints in contact_interactions.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  with_person: z.string().optional(),
  about_topic: z.string().optional(),
  since_days: z.number().int().default(180),
  limit: z.number().int().default(20),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "recall_conversation",
    "Search journal + interaction history for what was discussed. Filter by with_person, about_topic, or both. Returns memory entries and logged touchpoints in time order.",
    inputSchema,
    async ({ with_person, about_topic, since_days, limit }) => {
      try {
        if (!with_person && !about_topic) return fail("provide with_person or about_topic");
        const since = new Date(Date.now() - since_days * 86_400_000).toISOString();

        const memoryFilters: string[] = [];
        if (with_person) memoryFilters.push(`body.ilike.%${with_person}%`, `title.ilike.%${with_person}%`);
        if (about_topic) memoryFilters.push(`body.ilike.%${about_topic}%`, `title.ilike.%${about_topic}%`);
        const { data: memHits } = await ctx.supabase
          .from("memory")
          .select("type, title, body, occurred_at")
          .gte("occurred_at", since)
          .or(memoryFilters.join(","))
          .order("occurred_at", { ascending: false })
          .limit(limit);

        let interactions: any[] = [];
        if (with_person) {
          const { data: contact } = await ctx.supabase
            .from("personal_contacts")
            .select("id, name")
            .ilike("name", `%${with_person}%`)
            .limit(1)
            .maybeSingle();
          if (contact) {
            let q = ctx.supabase
              .from("contact_interactions")
              .select("*")
              .eq("contact_id", contact.id)
              .gte("occurred_at", since);
            if (about_topic) q = q.ilike("summary", `%${about_topic}%`);
            const { data } = await q.order("occurred_at", { ascending: false }).limit(limit);
            interactions = (data ?? []) as any[];
          }
        }

        if (!memHits?.length && !interactions.length) return ok("Nothing found.");

        const out: string[] = [`# Recall: ${[with_person, about_topic].filter(Boolean).join(" / ")}`];
        if (interactions.length) {
          out.push("\n## Logged interactions");
          for (const i of interactions) {
            out.push(`- ${i.occurred_at.slice(0, 10)} · ${i.channel ?? "?"} · ${i.summary ?? ""}`);
          }
        }
        if (memHits?.length) {
          out.push("\n## Journal / memory mentions");
          for (const m of memHits as any[]) {
            out.push(`- ${m.occurred_at.slice(0, 10)} [${m.type}] ${m.title ?? truncate(m.body, 100)}`);
          }
        }
        return ok(out.join("\n"));
      } catch (e) {
        return fail("recall_conversation failed", e);
      }
    },
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
