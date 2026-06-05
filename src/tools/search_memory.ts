/**
 * search_memory — semantic + tag search across the memory table.
 *
 * This is the reference tool. New tools should follow this shape:
 *   1. Zod schema for inputs
 *   2. server.tool(name, description, schema, handler)
 *   3. Handler returns ok(markdown) | fail(message)
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  query: z.string().min(1).describe("Natural-language search query"),
  scope: z.enum(["journal", "decision", "fact", "gratitude", "all"]).default("all")
    .describe("Filter by memory type"),
  limit: z.number().int().min(1).max(50).default(10),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "search_memory",
    "Search your personal memory (journal, decisions, facts, gratitudes) using semantic similarity. Returns the most relevant entries with type, date, and excerpt.",
    inputSchema,
    async ({ query, scope, limit }) => {
      try {
        const embedding = await ctx.embed.one(query);
        const { data, error } = await ctx.supabase.rpc("search_memory", {
          query_embedding: embedding as unknown as string,
          match_count: limit,
          filter_type: scope === "all" ? null : scope,
        });
        if (error) return fail("supabase rpc failed", error);
        const rows = (data ?? []) as Array<{
          id: string;
          type: string;
          title: string | null;
          body: string;
          tags: string[];
          occurred_at: string;
          similarity: number;
        }>;
        if (rows.length === 0) return ok("No matching memories.");
        return ok(format(rows));
      } catch (e) {
        return fail("search_memory failed", e);
      }
    },
  );
}

function format(
  rows: Array<{
    type: string;
    title: string | null;
    body: string;
    tags: string[];
    occurred_at: string;
    similarity: number;
  }>,
): string {
  return rows
    .map((r, i) => {
      const date = r.occurred_at.slice(0, 10);
      const tags = r.tags.length ? ` · ${r.tags.map((t) => `#${t}`).join(" ")}` : "";
      const score = (r.similarity * 100).toFixed(0);
      const head = `**${i + 1}. [${r.type}] ${r.title ?? "(no title)"}** — ${date}${tags} · score ${score}`;
      const body = r.body.length > 400 ? r.body.slice(0, 400) + "…" : r.body;
      return `${head}\n${body}`;
    })
    .join("\n\n");
}
