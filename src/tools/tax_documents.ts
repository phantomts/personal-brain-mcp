/**
 * tax_documents — where things are stored, by year.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add"]).default("list"),
  tax_year: z.number().int().optional(),
  doc_type: z.string().optional(),
  doc: z
    .object({
      tax_year: z.number().int(),
      doc_type: z.string(),
      source: z.string().optional(),
      location: z.string(),
      amount_cents: z.number().int().optional(),
      received_at: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "tax_documents",
    "Find or log tax document locations by year and type. Tracks where each document lives (OneDrive path, file cabinet, etc.).",
    inputSchema,
    async ({ action, tax_year, doc_type, doc }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("tax_documents").select("*").limit(200);
          if (tax_year) q = q.eq("tax_year", tax_year);
          if (doc_type) q = q.ilike("doc_type", `%${doc_type}%`);
          const { data, error } = await q.order("tax_year", { ascending: false }).order("doc_type");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No tax documents found.");
          return ok(
            data
              .map(
                (d: any) =>
                  `- **${d.tax_year} ${d.doc_type}**${d.source ? ` (${d.source})` : ""}${d.amount_cents ? ` · $${(d.amount_cents / 100).toFixed(2)}` : ""}\n   📁 ${d.location}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!doc) return fail("'doc' required");
          const { error } = await ctx.supabase.from("tax_documents").insert(doc);
          if (error) return fail("insert failed", error);
          return ok("Logged tax document.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("tax_documents failed", e);
      }
    },
  );
}
