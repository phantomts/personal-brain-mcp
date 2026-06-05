/**
 * warranty_status — what's still under warranty and what's expiring soon.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  query: z.string().optional().describe("Fuzzy match on item name"),
  expiring_within_days: z.number().int().min(0).max(3650).optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "warranty_status",
    "List items with active warranties — optionally filter by name or by 'expiring within N days'.",
    inputSchema,
    async ({ query, expiring_within_days }) => {
      try {
        let q = ctx.supabase
          .from("home_inventory")
          .select("name, brand, warranty_until, warranty_notes")
          .not("warranty_until", "is", null)
          .order("warranty_until", { ascending: true });
        if (query) q = q.ilike("name", `%${query}%`);
        if (expiring_within_days != null) {
          const cutoff = new Date(Date.now() + expiring_within_days * 86_400_000).toISOString().slice(0, 10);
          q = q.lte("warranty_until", cutoff);
        }
        const { data, error } = await q;
        if (error) return fail("query failed", error);
        if (!data?.length) return ok("No matching warranties.");
        const today = new Date().toISOString().slice(0, 10);
        const lines = data.map((w: any) => {
          const active = w.warranty_until >= today ? "active" : "EXPIRED";
          return `- **${w.name}**${w.brand ? ` (${w.brand})` : ""} — ${active} until ${w.warranty_until}${w.warranty_notes ? ` · ${w.warranty_notes}` : ""}`;
        });
        return ok(lines.join("\n"));
      } catch (e) {
        return fail("warranty_status failed", e);
      }
    },
  );
}
