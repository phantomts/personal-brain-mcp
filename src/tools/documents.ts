/**
 * documents — general document directory: warranties, manuals, contracts,
 * IDs, titles, policies, school records, legal docs. NOT tax docs (separate
 * annual-cycle tool).
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["search", "list", "add", "update", "expiring"]).default("search"),
  query: z.string().optional(),
  category: z.string().optional(),
  subject: z.string().optional(),
  within_days: z.number().int().default(60),
  doc: z.record(z.unknown()).optional(),
  doc_id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "documents",
    "General document directory (warranties, manuals, contracts, IDs, titles, insurance policies, legal docs). Search by name/category/subject, list expiring soon, add or update.",
    inputSchema,
    async ({ action, query, category, subject, within_days, doc, doc_id }) => {
      try {
        if (action === "search" || action === "list") {
          let q = ctx.supabase.from("documents").select("*").limit(100);
          if (query) q = q.or(`name.ilike.%${query}%,doc_number.ilike.%${query}%,issuer.ilike.%${query}%`);
          if (category) q = q.eq("category", category);
          if (subject) q = q.ilike("subject", `%${subject}%`);
          const { data, error } = await q.order("category").order("name");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No documents match.");
          return ok(data.map(formatDoc).join("\n"));
        }

        if (action === "expiring") {
          const cutoff = new Date(Date.now() + within_days * 86_400_000).toISOString().slice(0, 10);
          const { data, error } = await ctx.supabase
            .from("documents")
            .select("*")
            .not("expires_at", "is", null)
            .lte("expires_at", cutoff)
            .order("expires_at");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No documents expiring in ${within_days} days.`);
          return ok(data.map((d: any) => `- **${d.expires_at}** · ${d.name} (${d.category})${d.issuer ? ` · ${d.issuer}` : ""}`).join("\n"));
        }

        if (action === "add") {
          if (!doc) return fail("'doc' required");
          const { data, error } = await ctx.supabase.from("documents").insert(doc as any).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added document "${data.name}".`);
        }

        if (action === "update") {
          if (!doc_id) return fail("'doc_id' required");
          if (!doc) return fail("'doc' required");
          const { error } = await ctx.supabase.from("documents").update(doc as any).eq("id", doc_id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("documents failed", e);
      }
    },
  );
}

function formatDoc(d: any): string {
  const meta = [d.category, d.subject, d.issuer, d.doc_number].filter(Boolean).join(" · ");
  const dates = [d.issued_at && `issued ${d.issued_at}`, d.expires_at && `expires ${d.expires_at}`].filter(Boolean).join(" · ");
  return `- **${d.name}** — ${meta}${dates ? `\n   ${dates}` : ""}\n   📁 ${d.location}${d.digital_copy_url ? ` · ${d.digital_copy_url}` : ""}`;
}
