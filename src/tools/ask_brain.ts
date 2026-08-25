/**
 * ask_brain — search-only RAG across every searchable table.
 *
 * Per design: this tool returns the top-N relevant rows from every relevant
 * source. The LLM client does the synthesis. We do NOT call out to OpenAI
 * for generation here.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  query: z.string().min(1),
  sources: z
    .array(z.enum(["memory", "facts", "recipes", "personal_contacts", "bucket_list", "trips", "documents"]))
    .optional()
    .describe("Limit search to specific sources; defaults to all"),
  per_source_limit: z.number().int().min(1).max(20).default(5),
};

const DEFAULT_SOURCES = ["memory", "facts", "recipes", "personal_contacts", "bucket_list", "trips", "documents"] as const;

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "ask_brain",
    "Unified search across the brain: memory, facts, recipes, personal contacts, bucket list, trips, and documents. Returns top-N relevant rows per source — the LLM synthesizes the final answer. Use this for 'what do I know about X' or 'have I dealt with X before' questions.",
    inputSchema,
    async ({ query, sources, per_source_limit }) => {
      try {
        const active = sources && sources.length ? sources : DEFAULT_SOURCES;
        const emb = await ctx.embed.one(query);
        const out: string[] = [`# Brain query: "${query}"`];

        if (active.includes("memory")) {
          // Hybrid: vector + keyword (pg_trgm). Merge and dedupe by id.
          const [vecRes, kwRes] = await Promise.all([
            ctx.supabase.rpc("search_memory", {
              query_embedding: emb as any,
              match_count: per_source_limit,
              filter_type: null,
            }),
            ctx.supabase
              .from("memory")
              .select("id, type, title, body, occurred_at")
              .eq("archived", false)
              .or(`body.ilike.%${query}%,title.ilike.%${query}%`)
              .limit(per_source_limit),
          ]);
          const seen = new Set<string>();
          const rows: any[] = [];
          for (const r of (vecRes.data ?? []) as any[]) {
            if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
          }
          for (const r of (kwRes.data ?? []) as any[]) {
            if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
          }
          if (rows.length) {
            out.push("\n## Memory");
            for (const r of rows.slice(0, per_source_limit)) {
              out.push(`- [${r.type}] _${r.occurred_at?.slice(0, 10) ?? ""}_ ${r.title ?? truncate(r.body, 80)}`);
            }
          }
        }

        if (active.includes("facts")) {
          const { data } = await ctx.supabase.rpc("search_facts", {
            query_embedding: emb as any,
            match_count: per_source_limit,
            filter_subject: null,
          });
          if (data?.length) {
            out.push("\n## Facts");
            for (const f of data as any[]) {
              out.push(`- **${f.subject}** · ${f.predicate} · ${f.object}${f.context ? ` (${f.context})` : ""}`);
            }
          }
        }

        if (active.includes("recipes")) {
          const { data } = await ctx.supabase.rpc("search_recipes", {
            query_embedding: emb as any,
            match_count: per_source_limit,
            must_have: null,
            exclude_ingredients: null,
          });
          if (data?.length) {
            out.push("\n## Recipes");
            for (const r of data as any[]) out.push(`- ${r.name}${r.cuisine ? ` (${r.cuisine})` : ""}`);
          }
        }

        if (active.includes("personal_contacts")) {
          const { data } = await ctx.supabase
            .from("personal_contacts")
            .select("name, relationship, context")
            .or(`name.ilike.%${query}%,context.ilike.%${query}%`)
            .limit(per_source_limit);
          if (data?.length) {
            out.push("\n## Personal contacts");
            for (const c of data as any[]) {
              out.push(`- **${c.name}**${c.relationship ? ` (${c.relationship})` : ""}${c.context ? ` — ${truncate(c.context, 100)}` : ""}`);
            }
          }
        }

        if (active.includes("bucket_list")) {
          const { data } = await ctx.supabase
            .from("bucket_list")
            .select("goal, category, status, target_year")
            .or(`goal.ilike.%${query}%,why.ilike.%${query}%`)
            .limit(per_source_limit);
          if (data?.length) {
            out.push("\n## Bucket list");
            for (const b of data as any[]) out.push(`- [${b.status}] ${b.goal}${b.target_year ? ` (${b.target_year})` : ""}`);
          }
        }

        if (active.includes("trips")) {
          const { data } = await ctx.supabase
            .from("trips")
            .select("name, destination, start_date, highlights")
            .or(`name.ilike.%${query}%,destination.ilike.%${query}%,country.ilike.%${query}%,highlights.ilike.%${query}%`)
            .limit(per_source_limit);
          if (data?.length) {
            out.push("\n## Trips");
            for (const t of data as any[]) out.push(`- ${t.name}${t.destination ? ` — ${t.destination}` : ""}${t.start_date ? ` (${t.start_date})` : ""}`);
          }
        }

        if (active.includes("documents")) {
          const { data } = await ctx.supabase
            .from("documents")
            .select("name, category, location")
            .or(`name.ilike.%${query}%,issuer.ilike.%${query}%,doc_number.ilike.%${query}%`)
            .limit(per_source_limit);
          if (data?.length) {
            out.push("\n## Documents");
            for (const d of data as any[]) out.push(`- ${d.name} (${d.category}) — 📁 ${d.location}`);
          }
        }

        if (out.length === 1) return ok("Nothing found across the brain.");
        return ok(out.join("\n"));
      } catch (e) {
        return fail("ask_brain failed", e);
      }
    },
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
