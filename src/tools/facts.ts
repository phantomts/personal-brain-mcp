/**
 * facts — Layer 4: durable semantic facts (subject-predicate-object).
 *
 * Combined get/search/add/update/forget/promote in one tool to keep
 * the MCP tool surface tight.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["search", "by_subject", "add", "update", "forget", "promote_from_memory"]).default("search"),
  query: z.string().optional().describe("Semantic search query (for action=search)"),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  // add/update payload
  fact: z
    .object({
      id: z.string().uuid().optional(),
      subject: z.string().optional(),
      predicate: z.string().optional(),
      object: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      context: z.string().optional(),
    })
    .optional(),
  // promote_from_memory
  memory_id: z.string().uuid().optional(),
  // forget
  reason: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "facts",
    "User Layer-4 semantic facts (subject-predicate-object). Search by similarity, list by subject, add new facts, update or forget existing ones, or promote a memory entry into a fact.",
    inputSchema,
    async ({ action, query, subject, predicate, limit, fact, memory_id, reason }) => {
      try {
        if (action === "search") {
          if (!query) return fail("'query' required for search");
          const emb = await ctx.embed.one(query);
          const { data, error } = await ctx.supabase.rpc("search_facts", {
            query_embedding: emb as any,
            match_count: limit,
            filter_subject: subject ?? null,
          });
          if (error) return fail("rpc failed", error);
          if (!data?.length) return ok("No matching facts.");
          return ok(formatFacts(data));
        }

        if (action === "by_subject") {
          if (!subject) return fail("'subject' required");
          let q = ctx.supabase.from("facts").select("*").eq("active", true).ilike("subject", subject).limit(limit);
          if (predicate) q = q.eq("predicate", predicate);
          const { data, error } = await q.order("predicate");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No facts known about "${subject}".`);
          return ok(formatFacts(data));
        }

        if (action === "add") {
          if (!fact?.subject || !fact.predicate || !fact.object) {
            return fail("subject, predicate, object required");
          }
          let embedding: number[] | null = null;
          try {
            embedding = await ctx.embed.one(`${fact.subject} ${fact.predicate} ${fact.object}${fact.context ? " " + fact.context : ""}`);
          } catch {}
          const { data, error } = await ctx.supabase
            .from("facts")
            .insert({ ...fact, embedding: embedding as any, source: "self_reported" })
            .select("id, subject, predicate, object")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Recorded: ${data.subject} · ${data.predicate} · ${data.object}`);
        }

        if (action === "update") {
          if (!fact?.id) return fail("'fact.id' required");
          const { id, ...rest } = fact;
          // Insert superseding fact, mark old as superseded — preserves history.
          const { data: old } = await ctx.supabase.from("facts").select("*").eq("id", id).single();
          if (!old) return fail("fact not found");
          const merged = { ...old, ...rest, id: undefined, created_at: undefined };
          let embedding: number[] | null = null;
          try {
            embedding = await ctx.embed.one(`${merged.subject} ${merged.predicate} ${merged.object}`);
          } catch {}
          const { data: ins } = await ctx.supabase
            .from("facts")
            .insert({ ...merged, embedding: embedding as any })
            .select("id")
            .single();
          await ctx.supabase
            .from("facts")
            .update({ active: false, superseded_by: ins!.id })
            .eq("id", id);
          return ok("Fact updated (old version preserved with superseded_by link).");
        }

        if (action === "forget") {
          if (!fact?.id) return fail("'fact.id' required");
          const { error } = await ctx.supabase
            .from("facts")
            .update({ active: false, context: (reason ? `forgotten: ${reason}` : "forgotten") })
            .eq("id", fact.id);
          if (error) return fail("update failed", error);
          return ok("Fact archived.");
        }

        if (action === "promote_from_memory") {
          if (!memory_id) return fail("'memory_id' required");
          if (!fact?.subject || !fact.predicate || !fact.object) {
            return fail("fact.subject, predicate, object required for promotion");
          }
          let embedding: number[] | null = null;
          try {
            embedding = await ctx.embed.one(`${fact.subject} ${fact.predicate} ${fact.object}`);
          } catch {}
          const { data, error } = await ctx.supabase
            .from("facts")
            .insert({
              ...fact,
              source: `derived_from_memory:${memory_id}`,
              source_memory_id: memory_id,
              embedding: embedding as any,
            })
            .select("id, subject, predicate, object")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Promoted: ${data.subject} · ${data.predicate} · ${data.object}`);
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("facts failed", e);
      }
    },
  );
}

function formatFacts(rows: any[]): string {
  return rows
    .map((f) => {
      const conf = f.confidence != null && f.confidence < 1 ? ` (${Math.round(f.confidence * 100)}%)` : "";
      const sim = f.similarity != null ? ` · score ${(f.similarity * 100).toFixed(0)}` : "";
      const ctx = f.context ? `\n   _${f.context}_` : "";
      return `- **${f.subject}** · ${f.predicate} · ${f.object}${conf}${sim}${ctx}`;
    })
    .join("\n");
}
