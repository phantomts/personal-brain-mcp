/**
 * gift_ideas — list gift ideas for a person, with status.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  person: z.string().min(1).describe("Name of the person"),
  occasion: z.enum(["birthday", "christmas", "anniversary", "any"]).default("any"),
  include_given: z.boolean().default(false),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "gift_ideas",
    "Get gift ideas tracked for a specific person, including which are still ideas vs. already bought or given.",
    inputSchema,
    async ({ person, occasion, include_given }) => {
      try {
        const { data: people, error: pErr } = await ctx.supabase
          .from("people")
          .select("id, name")
          .ilike("name", `%${person}%`)
          .limit(1);
        if (pErr) return fail("person lookup failed", pErr);
        if (!people || people.length === 0) return ok(`No one matched "${person}".`);
        const target = people[0]!;

        let q = ctx.supabase.from("gifts").select("*").eq("person_id", target.id);
        if (occasion !== "any") q = q.eq("occasion", occasion);
        if (!include_given) q = q.in("status", ["idea", "bought"]);
        q = q.order("created_at", { ascending: false });

        const { data, error } = await q;
        if (error) return fail("query failed", error);
        if (!data || data.length === 0) return ok(`No gift ideas tracked for ${target.name}.`);

        const lines = data.map((g: any) => {
          const cost = g.cost_cents != null ? ` · $${g.cost_cents / 100}` : "";
          const occ = g.occasion ? ` · ${g.occasion}` : "";
          return `- [${g.status}] ${g.idea}${occ}${cost}${g.notes ? `\n   ${g.notes}` : ""}`;
        });
        return ok(`### Gifts for ${target.name}\n${lines.join("\n")}`);
      } catch (e) {
        return fail("gift_ideas failed", e);
      }
    },
  );
}
