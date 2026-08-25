/**
 * add_recipe — write companion to search_recipes. Embeds for semantic search.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  name: z.string(),
  cuisine: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ingredients: z.array(
    z.object({
      item: z.string(),
      qty: z.string().optional(),
      unit: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  steps: z.array(z.string()),
  source_url: z.string().url().optional(),
  servings: z.number().int().optional(),
  prep_minutes: z.number().int().optional(),
  cook_minutes: z.number().int().optional(),
  notes: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "add_recipe",
    "Save a new recipe to your cookbook. Includes ingredients (with quantities), steps, source URL, and timing.",
    inputSchema,
    async (input) => {
      try {
        const embedText = [
          input.name,
          input.cuisine ?? "",
          (input.tags ?? []).join(" "),
          input.ingredients.map((i) => i.item).join(" "),
        ].join("\n");
        let embedding: number[] | null = null;
        try {
          embedding = await ctx.embed.one(embedText);
        } catch {
          // soft fail
        }
        const { data, error } = await ctx.supabase
          .from("recipes")
          .insert({ ...input, embedding: embedding as any })
          .select("id, name")
          .single();
        if (error) return fail("insert failed", error);
        return ok(`Saved recipe "${data.name}" (id ${data.id}).`);
      } catch (e) {
        return fail("add_recipe failed", e);
      }
    },
  );
}
