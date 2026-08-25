/**
 * family_member — fuzzy lookup with full profile + upcoming birthday days.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  name: z.string().min(1).describe("Name or relationship label (e.g. 'wife', 'mom', 'Sam')"),
};

export function register(server: McpServer, ctx: ToolCtx) {
  server.tool(
    "family_member",
    "Look up a family member or close personal contact. Fuzzy-matches by name or relationship. Returns birthday (with days-until), sizes, allergies, interests, and notes.",
    inputSchema,
    async ({ name }) => {
      try {
        const { data, error } = await ctx.supabase
          .from("people")
          .select("*")
          .or(`name.ilike.%${name}%,relationship.ilike.%${name}%`)
          .limit(5);
        if (error) return fail("query failed", error);
        if (!data || data.length === 0) return ok(`No one matched "${name}".`);

        return ok(data.map(formatPerson).join("\n\n---\n\n"));
      } catch (e) {
        return fail("family_member failed", e);
      }
    },
  );
}

function formatPerson(p: any): string {
  const lines: string[] = [];
  lines.push(`## ${p.name}${p.relationship ? ` (${p.relationship})` : ""}`);
  if (p.birthday) lines.push(`- Birthday: ${p.birthday}${daysUntil(p.birthday)}`);
  if (p.allergies?.length) lines.push(`- Allergies: ${p.allergies.join(", ")}`);
  if (p.interests?.length) lines.push(`- Interests: ${p.interests.join(", ")}`);
  if (p.sizes && Object.keys(p.sizes).length) {
    const s = Object.entries(p.sizes)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`- Sizes: ${s}`);
  }
  if (p.notes) lines.push(`\n${p.notes}`);
  return lines.join("\n");
}

function daysUntil(isoDate: string): string {
  // isoDate is YYYY-MM-DD; compute days to next occurrence
  const [, m, d] = isoDate.split("-").map(Number);
  if (!m || !d) return "";
  const now = new Date();
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
  const days = Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
  return ` (in ${days} day${days === 1 ? "" : "s"})`;
}
