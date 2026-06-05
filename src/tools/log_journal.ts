/**
 * log_journal — append a dated entry to brain.memory.
 *
 * Embedding is generated synchronously so the row is immediately
 * searchable. If embedding fails, the row is still inserted (with a
 * null embedding) and you can backfill with scripts/backfill-embeddings.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  entry: z.string().min(1).describe("The journal entry body"),
  title: z.string().optional().describe("Optional short title"),
  type: z.enum(["journal", "decision", "fact", "gratitude"]).default("journal"),
  tags: z.array(z.string()).optional(),
  mood: z.string().optional().describe("Free-text mood label"),
  occurred_at: z.string().datetime().optional()
    .describe("ISO timestamp the entry refers to; defaults to now()"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "log_journal",
    "Append an entry to your personal memory (journal, decision, fact, or gratitude). Embedding is generated automatically so the entry is immediately searchable.",
    inputSchema,
    async ({ entry, title, type, tags, mood, occurred_at }) => {
      try {
        let embedding: number[] | null = null;
        try {
          embedding = await ctx.embed.one([title, entry].filter(Boolean).join("\n\n"));
        } catch {
          // Soft-fail: write the row without embedding; backfill later.
        }

        const { data, error } = await ctx.supabase
          .from("memory")
          .insert({
            type,
            title: title ?? null,
            body: entry,
            tags: tags ?? [],
            mood: mood ?? null,
            occurred_at: occurred_at ?? new Date().toISOString(),
            embedding: embedding as unknown as string | null,
          })
          .select("id, type, occurred_at")
          .single();

        if (error) return fail("insert failed", error);
        return ok(
          `Logged ${data.type} entry \`${data.id}\` at ${data.occurred_at}.` +
            (embedding ? "" : "\n(embedding skipped — run backfill later)"),
        );
      } catch (e) {
        return fail("log_journal failed", e);
      }
    },
  );
}
