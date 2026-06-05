/**
 * log_interaction — record a touchpoint with a personal contact.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  contact: z.string().describe("Contact name (fuzzy) or UUID"),
  channel: z.enum(["text", "call", "in_person", "email", "social", "video", "other"]).optional(),
  direction: z.enum(["inbound", "outbound", "mutual"]).default("mutual"),
  summary: z.string().min(1),
  next_followup: z.string().optional().describe("YYYY-MM-DD to remember to reach back out"),
  occurred_at: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "log_interaction",
    "Log a touchpoint with a personal contact (text, call, in-person, etc.). Optionally set a follow-up date.",
    inputSchema,
    async ({ contact, channel, direction, summary, next_followup, occurred_at }) => {
      try {
        let contact_id = contact;
        if (!isUuid(contact)) {
          const { data } = await ctx.supabase
            .from("personal_contacts")
            .select("id, name")
            .ilike("name", `%${contact}%`)
            .limit(1)
            .maybeSingle();
          if (!data) return ok(`No contact matched "${contact}". Add them first with personal_contacts.`);
          contact_id = data.id;
        }
        const { error } = await ctx.supabase.from("contact_interactions").insert({
          contact_id,
          channel,
          direction,
          summary,
          next_followup,
          occurred_at: occurred_at ?? new Date().toISOString(),
        });
        if (error) return fail("insert failed", error);
        return ok(`Logged interaction.${next_followup ? ` Follow-up set for ${next_followup}.` : ""}`);
      } catch (e) {
        return fail("log_interaction failed", e);
      }
    },
  );
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
