/**
 * house_projects — filtered list of household / property projects.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  status: z.enum(["idea", "planned", "in_progress", "blocked", "done"]).optional(),
  area: z.string().optional(),
  priority: z.enum(["low", "med", "high"]).optional(),
  limit: z.number().int().min(1).max(100).default(25),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "house_projects",
    "List your house and property projects. Filter by status, area, or priority. Returns name, status, priority, next step, and budget vs spent.",
    inputSchema,
    async ({ status, area, priority, limit }) => {
      try {
        let q = ctx.supabase.from("house_projects").select("*").limit(limit);
        if (status) q = q.eq("status", status);
        if (area) q = q.ilike("area", `%${area}%`);
        if (priority) q = q.eq("priority", priority);
        q = q.order("priority", { ascending: false }).order("updated_at", { ascending: false });

        const { data, error } = await q;
        if (error) return fail("query failed", error);
        if (!data || data.length === 0) return ok("No projects match those filters.");

        const lines = data.map((p: any) => {
          const money =
            p.budget_cents != null
              ? ` · $${(p.spent_cents ?? 0) / 100} of $${p.budget_cents / 100}`
              : "";
          const next = p.next_step ? `\n   next: ${p.next_step}` : "";
          return `- **${p.name}** [${p.status}${p.priority ? `/${p.priority}` : ""}]${
            p.area ? ` · ${p.area}` : ""
          }${money}${next}`;
        });
        return ok(lines.join("\n"));
      } catch (e) {
        return fail("house_projects failed", e);
      }
    },
  );
}
