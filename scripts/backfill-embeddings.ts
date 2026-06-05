/**
 * Backfill embeddings for any row in brain.memory or brain.recipes
 * with a null embedding column. Run after schema changes, soft-failed
 * writes, or migration imports.
 *
 * Usage:  tsx scripts/backfill-embeddings.ts [--table=memory|recipes] [--limit=500]
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const argv = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.match(/^--([^=]+)=?(.*)$/))
    .filter(Boolean)
    .map((m) => [m![1], m![2] || true]),
);
const table = (argv.table as string) ?? "memory";
const limit = parseInt((argv.limit as string) ?? "500", 10);

const supa = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "brain" as any } },
);
const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function main() {
  const textCol = table === "memory" ? "body" : "name";
  const { data, error } = await supa
    .from(table)
    .select(`id, ${textCol}`)
    .is("embedding", null)
    .limit(limit);
  if (error) throw error;
  console.log(`backfilling ${data?.length ?? 0} rows in brain.${table}`);
  for (const row of (data ?? []) as any[]) {
    const text = (row as any)[textCol];
    if (!text) continue;
    const e = await oai.embeddings.create({ model: "text-embedding-3-small", input: text });
    await supa.from(table).update({ embedding: e.data[0]!.embedding as any }).eq("id", row.id);
    process.stdout.write(".");
  }
  console.log("\ndone");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
