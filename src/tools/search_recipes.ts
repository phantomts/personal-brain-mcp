/**
 * search_recipes — semantic search with optional ingredient filters.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  query: z.string().min(1),
  must_have_ingredients: z.array(z.string()).optional(),
  exclude_ingredients: z.array(z.string()).optional()
    .describe("Useful for guest allergies"),
  max_results: z.number().int().min(1).max(20).default(5),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "search_recipes",
    "Search your recipe collection by name, cuisine, or ingredient — with optional must-have / exclude ingredient filters. Returns the full recipe.",
    inputSchema,
    async ({ query, must_have_ingredients, exclude_ingredients, max_results }) => {
      try {
        const embedding = await ctx.embed.one(query);
        const { data, error } = await ctx.supabase.rpc("search_recipes", {
          query_embedding: embedding as unknown as string,
          match_count: max_results,
          must_have: must_have_ingredients ?? null,
          exclude_ingredients: exclude_ingredients ?? null,
        });
        if (error) return fail("rpc failed", error);
        const rows = (data ?? []) as Array<{
          name: string;
          cuisine: string | null;
          tags: string[];
          ingredients: Array<{ item: string; qty?: string; unit?: string; notes?: string }>;
          steps: string[];
          rating: number | null;
          similarity: number;
        }>;
        if (rows.length === 0) return ok("No matching recipes.");
        return ok(rows.map(formatRecipe).join("\n\n---\n\n"));
      } catch (e) {
        return fail("search_recipes failed", e);
      }
    },
  );
}

function formatRecipe(r: {
  name: string;
  cuisine: string | null;
  tags: string[];
  ingredients: Array<{ item: string; qty?: string; unit?: string; notes?: string }>;
  steps: string[];
  rating: number | null;
}): string {
  const ing = r.ingredients
    .map((i) => `- ${[i.qty, i.unit, i.item].filter(Boolean).join(" ")}${i.notes ? ` (${i.notes})` : ""}`)
    .join("\n");
  const steps = r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const meta = [r.cuisine, r.rating ? `${r.rating}/5` : null, ...r.tags].filter(Boolean).join(" · ");
  return `## ${r.name}\n${meta ? `_${meta}_\n` : ""}\n**Ingredients**\n${ing}\n\n**Steps**\n${steps}`;
}
