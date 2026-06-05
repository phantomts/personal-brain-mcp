/**
 * One-shot importer: Notion → Supabase brain.* tables.
 *
 * Runs locally with tsx, not in the Worker. Reads NOTION_TOKEN and DB IDs
 * from .env, talks to Supabase via service-role key, and is idempotent
 * by tracking the source Notion page id in a `notion_id` column you can
 * add temporarily and drop after cutover.
 *
 * Usage:
 *   tsx scripts/migrate-from-notion.ts --db=recipes [--dry-run]
 *
 * Add per-DB mappings in the SOURCES table below. The script auto-paginates.
 *
 * NOTE: This is a scaffold. Each DB-specific mapper has TODOs to fill in
 * once you have the actual Notion property names from your workspace.
 */
import { Client as NotionClient } from "@notionhq/client";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";

const argv = parseArgs(process.argv.slice(2));
const dryRun = argv["dry-run"] === true;
const onlyDb = argv["db"] as string | undefined;

const NOTION_TOKEN = mustEnv("NOTION_TOKEN");
const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_KEY = mustEnv("OPENAI_API_KEY");

const notion = new NotionClient({ auth: NOTION_TOKEN });
const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "brain" as any } });
const oai = new OpenAI({ apiKey: OPENAI_KEY });

type Source = {
  key: string;
  notionDbEnv: string;            // env var holding the Notion DB id
  target: string;                 // brain.<target>
  mapper: (page: any) => Promise<Record<string, unknown> | null>;
  embedField?: (row: Record<string, unknown>) => string | null;
};

const SOURCES: Source[] = [
  {
    key: "memory",
    notionDbEnv: "NOTION_DB_MEMORY",
    target: "memory",
    mapper: async (page) => {
      // TODO map Notion props to row shape
      const props = page.properties ?? {};
      const title = plainText(props["Name"] ?? props["Title"]);
      const body = plainText(props["Body"] ?? props["Content"]) ?? title ?? "";
      if (!body) return null;
      return {
        type: (selectName(props["Type"]) ?? "fact").toLowerCase(),
        title,
        body,
        tags: multiSelect(props["Tags"]),
        occurred_at: dateValue(props["Date"]) ?? page.created_time,
        notion_id: page.id,
      };
    },
    embedField: (r) => [r.title, r.body].filter(Boolean).join("\n\n"),
  },
  {
    key: "recipes",
    notionDbEnv: "NOTION_DB_RECIPES",
    target: "recipes",
    mapper: async (page) => {
      const props = page.properties ?? {};
      const name = plainText(props["Name"]);
      if (!name) return null;
      return {
        name,
        cuisine: selectName(props["Cuisine"]),
        tags: multiSelect(props["Tags"]),
        ingredients: parseIngredients(plainText(props["Ingredients"]) ?? ""),
        steps: parseSteps(plainText(props["Steps"]) ?? ""),
        source_url: urlValue(props["Source"]),
        notes: plainText(props["Notes"]),
        notion_id: page.id,
      };
    },
    embedField: (r) => `${r.name}\n${(r.tags as string[] | undefined)?.join(" ") ?? ""}`,
  },
  {
    key: "people",
    notionDbEnv: "NOTION_DB_FAMILY",
    target: "people",
    mapper: async (page) => {
      const props = page.properties ?? {};
      const name = plainText(props["Name"]);
      if (!name) return null;
      return {
        name,
        relationship: selectName(props["Relationship"]),
        birthday: dateValue(props["Birthday"])?.slice(0, 10) ?? null,
        allergies: multiSelect(props["Allergies"]),
        interests: multiSelect(props["Interests"]),
        notes: plainText(props["Notes"]),
        notion_id: page.id,
      };
    },
  },
  {
    key: "house_projects",
    notionDbEnv: "NOTION_DB_HOUSE_PROJECTS",
    target: "house_projects",
    mapper: async (page) => {
      const props = page.properties ?? {};
      const name = plainText(props["Name"]);
      if (!name) return null;
      return {
        name,
        area: selectName(props["Area"]),
        status: (selectName(props["Status"]) ?? "idea").toLowerCase().replace(" ", "_"),
        priority: (selectName(props["Priority"]) ?? null)?.toLowerCase() ?? null,
        budget_cents: numberValue(props["Budget"]) != null ? Math.round(numberValue(props["Budget"])! * 100) : null,
        spent_cents: numberValue(props["Spent"]) != null ? Math.round(numberValue(props["Spent"])! * 100) : 0,
        contractor: plainText(props["Contractor"]),
        next_step: plainText(props["Next Step"]),
        notes: plainText(props["Notes"]),
        notion_id: page.id,
      };
    },
  },
  {
    key: "shopping",
    notionDbEnv: "NOTION_DB_SHOPPING",
    target: "shopping",
    mapper: async (page) => {
      const props = page.properties ?? {};
      const item = plainText(props["Item"] ?? props["Name"]);
      if (!item) return null;
      return {
        item,
        category: selectName(props["Category"]),
        quantity: plainText(props["Quantity"]),
        status: (selectName(props["Status"]) ?? "open").toLowerCase(),
        notion_id: page.id,
      };
    },
  },
];

async function main() {
  const log = openLog();
  for (const src of SOURCES) {
    if (onlyDb && onlyDb !== src.key) continue;
    const dbId = process.env[src.notionDbEnv];
    if (!dbId) {
      console.log(`[skip] ${src.key}: ${src.notionDbEnv} not set`);
      continue;
    }
    console.log(`\n=== Migrating ${src.key} (Notion DB ${dbId}) → brain.${src.target} ===`);
    let cursor: string | undefined;
    let count = 0;
    do {
      const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100 });
      for (const page of res.results as any[]) {
        const row = await src.mapper(page);
        if (!row) continue;

        // skip if already imported (requires temporary `notion_id` column)
        const { data: existing } = await supa
          .from(src.target)
          .select("id")
          .eq("notion_id" as any, page.id)
          .maybeSingle();
        if (existing) {
          log.write(JSON.stringify({ db: src.key, notion_id: page.id, action: "skip" }) + "\n");
          continue;
        }

        if (src.embedField) {
          const text = src.embedField(row);
          if (text) {
            try {
              const e = await oai.embeddings.create({ model: "text-embedding-3-small", input: text });
              (row as any).embedding = e.data[0]!.embedding;
            } catch (err) {
              log.write(JSON.stringify({ db: src.key, notion_id: page.id, embed_error: String(err) }) + "\n");
            }
          }
        }

        if (dryRun) {
          console.log("[dry]", src.target, row);
        } else {
          const { error } = await supa.from(src.target).insert(row as any);
          if (error) {
            log.write(JSON.stringify({ db: src.key, notion_id: page.id, insert_error: error.message }) + "\n");
            console.error("  insert failed", page.id, error.message);
          } else {
            count++;
          }
        }
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    console.log(`  imported ${count} rows`);
  }
  log.end();
}

// ---------- helpers ----------
function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]!] = m[2] ?? true;
  }
  return out;
}
function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env var ${k}`);
  return v;
}
function plainText(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === "title") return prop.title?.map((t: any) => t.plain_text).join("") || null;
  if (prop.type === "rich_text") return prop.rich_text?.map((t: any) => t.plain_text).join("") || null;
  if (prop.type === "url") return prop.url || null;
  return null;
}
function urlValue(prop: any): string | null {
  return prop?.url ?? null;
}
function selectName(prop: any): string | null {
  return prop?.select?.name ?? prop?.status?.name ?? null;
}
function multiSelect(prop: any): string[] {
  return prop?.multi_select?.map((x: any) => x.name) ?? [];
}
function dateValue(prop: any): string | null {
  return prop?.date?.start ?? null;
}
function numberValue(prop: any): number | null {
  return prop?.number ?? null;
}
function parseIngredients(raw: string): Array<{ item: string }> {
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => ({ item }));
}
function parseSteps(raw: string): string[] {
  return raw.split(/\n+/).map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
}
function openLog() {
  const p = path.join(process.cwd(), "migration-log.jsonl");
  return fs.createWriteStream(p, { flags: "a" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
