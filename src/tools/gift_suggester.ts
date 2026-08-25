/**
 * gift_suggester — given person + occasion + budget, return context the LLM
 * needs to suggest a gift: their interests, allergies, past gifts given to
 * them (to avoid repeating), and any wishlist matches if that person has
 * their own wishlist (only you does in this schema, but pattern-ready).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  person: z.string().describe("Family member or personal contact name"),
  occasion: z.string().optional(),
  max_budget_cents: z.number().int().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "gift_suggester",
    "Composite tool: gather everything known about a person + their gift history (to avoid repeating) + any past gift ideas tracked, so the LLM can suggest a thoughtful gift.",
    inputSchema,
    async ({ person, occasion, max_budget_cents }) => {
      try {
        // Try family (people) first, then personal_contacts.
        const [{ data: family }, { data: pc }] = await Promise.all([
          ctx.supabase.from("people").select("*").ilike("name", `%${person}%`).limit(1).maybeSingle(),
          ctx.supabase.from("personal_contacts").select("*").ilike("name", `%${person}%`).limit(1).maybeSingle(),
        ]);
        const target = family ?? pc;
        if (!target) return ok(`No person matched "${person}".`);

        const out: string[] = [`# Gift context for ${target.name}`];
        if (target.relationship) out.push(`_${target.relationship}_`);
        if (target.birthday) out.push(`- Birthday: ${target.birthday}`);
        if (target.allergies?.length) out.push(`- Allergies: ${target.allergies.join(", ")}`);
        if (target.interests?.length) out.push(`- Interests: ${target.interests.join(", ")}`);
        if (target.notes) out.push(`\n${target.notes}`);
        if (target.context) out.push(`\n${target.context}`);

        // Past gifts for this person (family only — gifts table is keyed to people)
        if (family) {
          let gq = ctx.supabase.from("gifts").select("*").eq("person_id", family.id).order("created_at", { ascending: false });
          if (occasion) gq = gq.eq("occasion", occasion);
          const { data: gifts } = await gq;
          if (gifts?.length) {
            out.push("\n## Past gift activity");
            for (const g of gifts as any[]) {
              out.push(`- [${g.status}] ${g.idea}${g.occasion ? ` · ${g.occasion}` : ""}${g.given_at ? ` · given ${g.given_at}` : ""}`);
            }
          }
        }

        // Dietary prefs (people only)
        if (family) {
          const { data: prefs } = await ctx.supabase.from("dietary_prefs").select("*").eq("person_id", family.id);
          if (prefs?.length) {
            out.push("\n## Dietary prefs (relevant if food-gift)");
            for (const p of prefs as any[]) out.push(`- ${p.kind}: ${p.item}${p.severity ? ` (${p.severity})` : ""}`);
          }
        }

        // Constraints recap
        out.push("");
        if (occasion) out.push(`**Occasion:** ${occasion}`);
        if (max_budget_cents) out.push(`**Budget cap:** $${(max_budget_cents / 100).toFixed(0)}`);
        out.push("\n_LLM: synthesize 3 thoughtful gift ideas avoiding anything in the past-gift activity above and respecting any allergies/dietary restrictions._");

        return ok(out.join("\n"));
      } catch (e) {
        return fail("gift_suggester failed", e);
      }
    },
  );
}
