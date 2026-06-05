/**
 * personal_contacts — friends, neighbors, extended family. Not a CRM.
 * Includes last_contact via join to interactions.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["search", "get", "add", "update"]).default("search"),
  query: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  // add/update payload
  contact: z
    .object({
      name: z.string().optional(),
      relationship: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      birthday: z.string().optional(),
      spouse: z.string().optional(),
      kids: z.array(z.record(z.unknown())).optional(),
      pets: z.array(z.record(z.unknown())).optional(),
      context: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "personal_contacts",
    "Search/view/add/update personal contacts (friends, neighbors, extended family). Returns relationship notes and last interaction date.",
    inputSchema,
    async ({ action, query, contact_id, contact }) => {
      try {
        if (action === "search") {
          if (!query) return fail("'query' required");
          const { data, error } = await ctx.supabase
            .from("personal_contacts")
            .select("*")
            .or(`name.ilike.%${query}%,tags.cs.{${query}},context.ilike.%${query}%`)
            .limit(10);
          if (error) return fail("query failed", error);
          if (!data?.length) return ok(`No contacts matched "${query}".`);
          const withLast = await attachLastContact(ctx, data as any[]);
          return ok(withLast.map(formatContact).join("\n\n---\n\n"));
        }
        if (action === "get") {
          if (!contact_id) return fail("'contact_id' required");
          const { data, error } = await ctx.supabase
            .from("personal_contacts")
            .select("*")
            .eq("id", contact_id)
            .single();
          if (error) return fail("query failed", error);
          const withLast = await attachLastContact(ctx, [data]);
          return ok(formatContact(withLast[0]));
        }
        if (action === "add") {
          if (!contact?.name) return fail("'contact.name' required");
          const { data, error } = await ctx.supabase
            .from("personal_contacts")
            .insert(contact)
            .select("id, name")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.name} (id ${data.id}).`);
        }
        if (action === "update") {
          if (!contact_id || !contact) return fail("'contact_id' and 'contact' required");
          const { data, error } = await ctx.supabase
            .from("personal_contacts")
            .update(contact)
            .eq("id", contact_id)
            .select("name")
            .single();
          if (error) return fail("update failed", error);
          return ok(`Updated ${data.name}.`);
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("personal_contacts failed", e);
      }
    },
  );
}

async function attachLastContact(ctx: ToolCtx, contacts: any[]): Promise<any[]> {
  const ids = contacts.map((c) => c.id);
  if (!ids.length) return contacts;
  const { data } = await ctx.supabase
    .from("contact_interactions")
    .select("contact_id, occurred_at, channel, summary")
    .in("contact_id", ids)
    .order("occurred_at", { ascending: false });
  const lastByContact = new Map<string, any>();
  for (const i of (data ?? []) as any[]) {
    if (!lastByContact.has(i.contact_id)) lastByContact.set(i.contact_id, i);
  }
  return contacts.map((c) => ({ ...c, last_interaction: lastByContact.get(c.id) }));
}

function formatContact(c: any): string {
  const lines: string[] = [`## ${c.name}${c.relationship ? ` — ${c.relationship}` : ""}`];
  const loc = [c.city, c.state].filter(Boolean).join(", ");
  if (loc) lines.push(`📍 ${loc}`);
  if (c.spouse) lines.push(`- Spouse: ${c.spouse}`);
  if (c.kids?.length) lines.push(`- Kids: ${c.kids.map((k: any) => k.name ?? "").filter(Boolean).join(", ")}`);
  if (c.pets?.length) lines.push(`- Pets: ${c.pets.map((p: any) => `${p.name}${p.species ? ` (${p.species})` : ""}`).join(", ")}`);
  if (c.context) lines.push(`\n${c.context}`);
  if (c.last_interaction) {
    const d = c.last_interaction.occurred_at?.slice(0, 10);
    lines.push(`\n_Last contact: ${d} via ${c.last_interaction.channel ?? "?"} — ${c.last_interaction.summary ?? ""}_`);
  } else {
    lines.push(`\n_No interactions logged yet._`);
  }
  return lines.join("\n");
}
