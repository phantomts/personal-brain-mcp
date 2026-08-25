/**
 * identity — Layer 1: who the user is. Single-row table; always include
 * in agent context.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["get", "update"]).default("get"),
  patch: z
    .object({
      legal_name: z.string().optional(),
      preferred_name: z.string().optional(),
      pronouns: z.string().optional(),
      birthday: z.string().optional(),
      birthplace: z.string().optional(),
      primary_email: z.string().optional(),
      primary_phone: z.string().optional(),
      primary_address: z.string().optional(),
      timezone: z.string().optional(),
      languages: z.array(z.string()).optional(),
      blood_type: z.string().optional(),
      core_values: z.array(z.string()).optional(),
      beliefs: z.string().optional(),
      voice_rules: z.string().optional(),
      extras: z.record(z.unknown()).optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "identity",
    "User Layer-1 identity: who the user is, voice rules, contact info, core values. Use 'get' to load context at session start; 'update' to patch fields (any subset).",
    inputSchema,
    async ({ action, patch }) => {
      try {
        if (action === "get") {
          const { data, error } = await ctx.supabase.from("identity").select("*").eq("id", 1).single();
          if (error) return fail("query failed", error);
          return ok(formatIdentity(data));
        }
        if (action === "update") {
          if (!patch) return fail("'patch' required for update");
          const { data, error } = await ctx.supabase
            .from("identity")
            .update(patch as any)
            .eq("id", 1)
            .select("preferred_name")
            .single();
          if (error) return fail("update failed", error);
          return ok(`Identity updated for ${data.preferred_name ?? "User"}.`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("identity failed", e);
      }
    },
  );
}

function formatIdentity(i: any): string {
  const lines: string[] = [`# Identity — ${i.preferred_name ?? i.legal_name ?? "User"}`];
  if (i.legal_name && i.legal_name !== i.preferred_name) lines.push(`- Legal: ${i.legal_name}`);
  if (i.pronouns) lines.push(`- Pronouns: ${i.pronouns}`);
  if (i.birthday) lines.push(`- Born: ${i.birthday}${i.birthplace ? ` in ${i.birthplace}` : ""}`);
  if (i.primary_email) lines.push(`- Email: ${i.primary_email}`);
  if (i.primary_phone) lines.push(`- Phone: ${i.primary_phone}`);
  if (i.primary_address) lines.push(`- Address: ${i.primary_address}`);
  if (i.timezone) lines.push(`- Timezone: ${i.timezone}`);
  if (i.languages?.length) lines.push(`- Languages: ${i.languages.join(", ")}`);
  if (i.blood_type) lines.push(`- Blood type: ${i.blood_type}`);
  if (i.core_values?.length) lines.push(`\n**Core values:** ${i.core_values.join(" · ")}`);
  if (i.beliefs) lines.push(`\n${i.beliefs}`);
  if (i.voice_rules) lines.push(`\n**Voice rules:** ${i.voice_rules}`);
  if (i.extras && Object.keys(i.extras).length) {
    lines.push("\n**Extras:**");
    for (const [k, v] of Object.entries(i.extras)) lines.push(`- ${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n");
}
