/**
 * meal_plan_from_pantry — gather pantry contents + diners' dietary prefs +
 * recipe candidates. LLM synthesizes a meal proposal.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  diners: z.array(z.string()).optional().describe("Names of people eating; pulls their dietary prefs"),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]).default("dinner"),
  max_recipe_candidates: z.number().int().default(8),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "meal_plan_from_pantry",
    "Composite tool: returns current pantry contents + dietary restrictions for named diners + a set of candidate recipes scored by 'how much of the pantry it uses'. LLM picks/proposes a meal.",
    inputSchema,
    async ({ diners, slot, max_recipe_candidates }) => {
      try {
        const [{ data: pantry }, recipes] = await Promise.all([
          ctx.supabase.from("pantry").select("item, quantity, location, expires_at").order("expires_at"),
          ctx.supabase.from("recipes").select("name, cuisine, ingredients, tags").limit(50),
        ]);

        // Diner prefs
        let prefLines: string[] = [];
        const exclusions: string[] = [];
        if (diners?.length) {
          for (const name of diners) {
            const { data: person } = await ctx.supabase.from("people").select("id, name").ilike("name", `%${name}%`).limit(1).maybeSingle();
            if (!person) continue;
            const { data: prefs } = await ctx.supabase.from("dietary_prefs").select("*").eq("person_id", person.id);
            for (const p of (prefs ?? []) as any[]) {
              prefLines.push(`- ${person.name}: ${p.kind} — ${p.item}${p.severity ? ` (${p.severity})` : ""}`);
              if (p.kind === "allergy" || p.kind === "restriction" || p.kind === "dislike") exclusions.push(p.item.toLowerCase());
            }
          }
        }

        const pantryItems = ((pantry ?? []) as any[]).map((p) => p.item.toLowerCase());

        // Score recipes by ingredient overlap with pantry, exclude allergens
        const scored = ((recipes.data ?? []) as any[])
          .map((r) => {
            const ings = (r.ingredients ?? []).map((i: any) => (i.item ?? "").toLowerCase());
            const hits = ings.filter((i: string) => pantryItems.some((p) => i.includes(p) || p.includes(i)));
            const blocked = ings.some((i: string) => exclusions.some((x) => i.includes(x)));
            return { recipe: r, score: hits.length, hits, blocked };
          })
          .filter((s) => !s.blocked)
          .sort((a, b) => b.score - a.score)
          .slice(0, max_recipe_candidates);

        const out: string[] = [`# Meal plan suggestions for ${slot}\n`];
        out.push(`## Pantry (${(pantry ?? []).length} items)`);
        out.push(((pantry ?? []) as any[]).slice(0, 30).map((p) => `- ${p.item}${p.quantity ? ` × ${p.quantity}` : ""}${p.expires_at ? ` (exp ${p.expires_at})` : ""}`).join("\n"));

        if (prefLines.length) {
          out.push("\n## Diner restrictions");
          out.push(prefLines.join("\n"));
        }

        out.push("\n## Candidate recipes (ranked by pantry overlap)");
        for (const s of scored) {
          out.push(`- **${s.recipe.name}** — uses ${s.score} pantry items: ${s.hits.slice(0, 4).join(", ")}`);
        }

        out.push("\n_LLM: pick 2-3 best options and explain pantry-fit + restriction-fit._");
        return ok(out.join("\n"));
      } catch (e) {
        return fail("meal_plan_from_pantry failed", e);
      }
    },
  );
}
