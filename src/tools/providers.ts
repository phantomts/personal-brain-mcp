/**
 * providers — directory of medical/professional providers.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "update_visit"]).default("list"),
  specialty: z.string().optional(),
  for_person: z.string().optional(),
  query: z.string().optional(),
  provider: z
    .object({
      name: z.string(),
      specialty: z.string().optional(),
      for_person: z.string().optional(),
      practice: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      portal_url: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  provider_id: z.string().uuid().optional(),
  next_visit_at: z.string().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "providers",
    "Directory of medical and personal-service providers (PCP, dentist, vet, etc.). list filters by specialty or person, add creates a record, update_visit sets next appointment.",
    inputSchema,
    async ({ action, specialty, for_person, query, provider, provider_id, next_visit_at }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("providers").select("*");
          if (specialty) q = q.eq("specialty", specialty);
          if (for_person) q = q.eq("for_person", for_person);
          if (query) q = q.or(`name.ilike.%${query}%,practice.ilike.%${query}%`);
          const { data, error } = await q.order("specialty");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No providers match.");
          return ok(
            data
              .map(
                (p: any) =>
                  `- **${p.name}** (${p.specialty ?? "?"})${p.for_person ? ` · for ${p.for_person}` : ""}${p.practice ? `\n   ${p.practice}` : ""}${p.phone ? ` · ${p.phone}` : ""}${p.next_visit_at ? `\n   next visit: ${p.next_visit_at}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!provider?.name) return fail("'provider.name' required");
          const { data, error } = await ctx.supabase
            .from("providers")
            .insert(provider)
            .select("id, name")
            .single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.name}.`);
        }
        if (action === "update_visit") {
          if (!provider_id) return fail("'provider_id' required");
          const { error } = await ctx.supabase
            .from("providers")
            .update({ next_visit_at: next_visit_at ?? null })
            .eq("id", provider_id);
          if (error) return fail("update failed", error);
          return ok("Updated next visit.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("providers failed", e);
      }
    },
  );
}
