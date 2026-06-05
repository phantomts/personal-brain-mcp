/**
 * OpenAI embedding helper. text-embedding-3-small returns 1536-dim vectors
 * which matches the vector column width in the schema.
 *
 * Costs ~$0.02 per 1M tokens. At personal-brain scale this is rounding error.
 */
import OpenAI from "openai";
import type { Env } from "../index";

const MODEL = "text-embedding-3-small";

export function createEmbedder(env: Env) {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  return {
    async one(text: string): Promise<number[]> {
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (!cleaned) throw new Error("cannot embed empty string");
      const res = await client.embeddings.create({ model: MODEL, input: cleaned });
      return res.data[0]!.embedding;
    },
    async many(texts: string[]): Promise<number[][]> {
      const cleaned = texts.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (cleaned.length === 0) return [];
      const res = await client.embeddings.create({ model: MODEL, input: cleaned });
      return res.data.map((d) => d.embedding);
    },
  };
}
