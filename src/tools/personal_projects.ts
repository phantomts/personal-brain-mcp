/**
 * personal_projects — self-improvement, learning, creative side projects.
 * Distinct from house_projects (physical) and business projects.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "get", "add", "update_status", "set_next_step"]).default("list"),
  status: z.enum(["planned", "active", "paused", "done", "dropped", "all"]).default("active"),
  category: z.string().optional(),
  project: z.string().optional(),
  payload: z
    .object({
      name: z.string(),
      category: z.string().optional(),
      why: z.string().optional(),
      target_date: z.string().optional(),
      next_step: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  new_status: z.enum(["planned", "active", "paused", "done", "dropped"]).optional(),
  next_step: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "personal_projects",
    "Personal self-improvement / creative / learning projects (Spanish, book writing, garden expansion). Distinct from house_projects.",
    inputSchema,
    async ({ action, status, category, project, payload, new_status, next_step }) => {
      try {
        async function resolveProject(): Promise<string | null> {
          if (!project) return null;
          if (/^[0-9a-f-]{36}$/i.test(project)) return project;
          const { data } = await ctx.supabase.from("personal_projects").select("id").ilike("name", `%${project}%`).limit(1).maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          let q = ctx.supabase.from("personal_projects").select("*");
          if (status !== "all") q = q.eq("status", status);
          if (category) q = q.eq("category", category);
          const { data, error } = await q.order("status").order("updated_at", { ascending: false });
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No projects match.");
          return ok(data.map((p: any) => `- [${p.status}] **${p.name}**${p.category ? ` (${p.category})` : ""}${p.next_step ? ` → ${p.next_step}` : ""}`).join("\n"));
        }

        if (action === "get") {
          const id = await resolveProject();
          if (!id) return ok(`No project matched "${project}".`);
          const { data, error } = await ctx.supabase.from("personal_projects").select("*").eq("id", id).single();
          if (error) return fail("query failed", error);
          const lines = [`## ${data.name}`, `_${data.status}${data.category ? ` · ${data.category}` : ""}_`];
          if (data.why) lines.push(`\n**Why:** ${data.why}`);
          if (data.target_date) lines.push(`**Target:** ${data.target_date}`);
          if (data.next_step) lines.push(`**Next step:** ${data.next_step}`);
          if (data.notes) lines.push(`\n${data.notes}`);
          return ok(lines.join("\n"));
        }

        if (action === "add") {
          if (!payload?.name) return fail("'payload.name' required");
          const { data, error } = await ctx.supabase.from("personal_projects").insert(payload).select("id, name").single();
          if (error) return fail("insert failed", error);
          return ok(`Added "${data.name}".`);
        }

        if (action === "update_status") {
          const id = await resolveProject();
          if (!id || !new_status) return fail("'project' and 'new_status' required");
          const { error } = await ctx.supabase.from("personal_projects").update({ status: new_status }).eq("id", id);
          if (error) return fail("update failed", error);
          return ok(`Status: ${new_status}.`);
        }

        if (action === "set_next_step") {
          const id = await resolveProject();
          if (!id || !next_step) return fail("'project' and 'next_step' required");
          const { error } = await ctx.supabase.from("personal_projects").update({ next_step }).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Next step updated.");
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("personal_projects failed", e);
      }
    },
  );
}
