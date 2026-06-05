/**
 * financial_accounts — directory of accounts (existence, not balances).
 * Balances come from Plaid / connectors / live API calls elsewhere.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  action: z.enum(["list", "add", "update", "deactivate"]).default("list"),
  account_type: z.string().optional(),
  owner: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  id: z.string().uuid().optional(),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "financial_accounts",
    "Directory of financial accounts (existence, ownership, beneficiary, last4). Does NOT track balances — those come from live integrations.",
    inputSchema,
    async ({ action, account_type, owner, payload, id }) => {
      try {
        if (action === "list") {
          let q = ctx.supabase.from("financial_accounts").select("*").eq("active", true);
          if (account_type) q = q.eq("account_type", account_type);
          if (owner) q = q.eq("owner", owner);
          const { data, error } = await q.order("institution");
          if (error) return fail("query failed", error);
          if (!data?.length) return ok("No accounts recorded.");
          return ok(
            data
              .map(
                (a: any) =>
                  `- **${a.nickname}** (${a.account_type ?? "?"}) — ${a.institution}${a.account_number_last4 ? ` · …${a.account_number_last4}` : ""}${a.owner ? ` · ${a.owner}` : ""}${a.beneficiary ? ` · beneficiary: ${a.beneficiary}` : ""}`,
              )
              .join("\n"),
          );
        }
        if (action === "add") {
          if (!payload) return fail("'payload' required");
          const { data, error } = await ctx.supabase.from("financial_accounts").insert(payload as any).select("id, nickname").single();
          if (error) return fail("insert failed", error);
          return ok(`Added ${data.nickname}.`);
        }
        if (action === "update") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("financial_accounts").update(payload as any).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Updated.");
        }
        if (action === "deactivate") {
          if (!id) return fail("'id' required");
          const { error } = await ctx.supabase.from("financial_accounts").update({ active: false }).eq("id", id);
          if (error) return fail("update failed", error);
          return ok("Deactivated.");
        }
        return fail(`unknown action ${action}`);
      } catch (e) {
        return fail("financial_accounts failed", e);
      }
    },
  );
}
