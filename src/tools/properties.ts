/**
 * properties — homes, cabin, parents', regular stays.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "get", "add", "update"]).default("list"),
  property: z.string().optional().describe("Nickname or UUID"),
  property_type: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "properties",
    "Manage properties (primary home, cabin, family homes, regular stays). Tracks address, utility accounts, wifi info, smart-home hub, mortgage.",
    inputSchema,
    async ({ action, property, property_type, payload }) => {
      try {
        async function resolveProp(): Promise<string | null> {
          if (!property) return null;
          if (/^[0-9a-f-]{36}$/i.test(property)) return property;
          const { data } = await ctx.supabase.from("properties").select("id").ilike("nickname", `%${property}%`).limit(1).maybeSingle();
          return data?.id ?? null;
        }

        if (action === "list") {
          let q = ctx.supabase.from("properties").select("*").eq("active", true);
          if (property_type) q = q.eq("property_type", property_type);
          const { data, error } = await q.order("property_type");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No properties recorded.");
          return ok(data.map((p: any) => `- **${p.nickname}** (${p.property_type ?? "?"}) — ${[p.city, p.state].filter(Boolean).join(", ") || p.address}`).join("\n"));
        }

        if (action === "get") {
          const id = await resolveProp();
          if (!id) return ok(`No property matched "${property}".`);
          const { data, error } = await ctx.supabase.from("properties").select("*").eq("id", id).single();
          if (error) return fail("query failed", error);
          return ok(formatProperty(data));
        }

        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { data, error } = await ctx.supabase.from("properties").insert(payload as any).select("id, nickname").single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.nickname}.`);
        }

        if (action === "update") {
          const id = await resolveProp();
          if (!id) return fail(`No property matched "${property}"`);
          if (!payload) return fail("'payload' required");
          const { error } = await ctx.supabase.from("properties").update(payload as any).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }

        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("properties failed", e);
      }
    },
  );
}

function formatProperty(p: any): string {
  const lines = [`## ${p.nickname}${p.property_type ? ` (${p.property_type})` : ""}`];
  if (p.address) lines.push(`📍 ${p.address}, ${p.city ?? ""} ${p.state ?? ""} ${p.postal_code ?? ""}`);
  if (p.square_feet) lines.push(`- ${p.square_feet} sq ft${p.bedrooms ? ` · ${p.bedrooms} bd` : ""}${p.bathrooms ? ` · ${p.bathrooms} ba` : ""}`);
  if (p.mortgage_lender) lines.push(`- Mortgage: ${p.mortgage_lender}`);
  if (p.wifi_ssid) lines.push(`- WiFi SSID: ${p.wifi_ssid}${p.wifi_password_hint ? ` (hint: ${p.wifi_password_hint})` : ""}`);
  if (p.smart_home_hub) lines.push(`- Smart home hub: ${p.smart_home_hub}`);
  if (p.utility_accounts && Object.keys(p.utility_accounts).length) {
    lines.push("\n**Utilities:**");
    for (const [util, info] of Object.entries(p.utility_accounts as any)) {
      lines.push(`- ${util}: ${JSON.stringify(info)}`);
    }
  }
  if (p.notes) lines.push(`\n${p.notes}`);
  return lines.join("\n");
}
