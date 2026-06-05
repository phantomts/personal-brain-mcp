/**
 * professional_relationships — accountant, attorney, advisor, agent, banker.
 * Distinct from medical providers and personal contacts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "update", "log_meeting"]).default("list"),
  role: z.string().optional(),
  for_entity: z.string().optional(),
  query: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  id: z.string().uuid().optional(),
  meeting_date: z.string().optional(),
  next_review_at: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "professional_relationships",
    "Transactional professional relationships (accountant, attorney, financial advisor, insurance agent, realtor, banker). Distinct from medical providers and personal contacts. Tracks last meeting + next review.",
    inputSchema,
    async ({ action, role, for_entity, query, payload, id, meeting_date, next_review_at }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("professional_relationships").select("*").eq("active", true);
          if (role) q = q.eq("role", role);
          if (for_entity) q = q.eq("for_entity", for_entity);
          if (query) q = q.or(`name.ilike.%${query}%,firm.ilike.%${query}%`);
          const { data, error } = await q.order("role");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No professional relationships.");
          return ok(
            data
              .map(
                (p: any) =>
                  `- **${p.name}** — ${p.role}${p.firm ? ` @ ${p.firm}` : ""}${p.for_entity ? ` · for ${p.for_entity}` : ""}${p.phone ? ` · ${p.phone}` : ""}${p.last_meeting_at ? `\n   last met: ${p.last_meeting_at}` : ""}${p.next_review_at ? ` · next review: ${p.next_review_at}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { data, error } = await ctx.supabase.from("professional_relationships").insert(payload as any).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.name}.`);
        }
        if (action === "update") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("professional_relationships").update(payload as any).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }
        if (action === "log_meeting") {
          if (!id) return fail("'id' required");
          const updates: any = { last_meeting_at: meeting_date ?? new Date().toISOString().slice(0, 10) };
          if (next_review_at) updates.next_review_at = next_review_at;
          const { error } = await ctx.supabase.from("professional_relationships").update(updates).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Meeting logged.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("professional_relationships failed", e);
      }
    },
  );
}
