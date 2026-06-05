/**
 * Ingest router — dispatches POST /ingest/<kind> requests to per-kind handlers.
 *
 * Auth uses a separate bearer token (`INGEST_BEARER_TOKEN`) so iPhone Shortcuts
 * or webhooks can be granted ingest-only access without giving them MCP tool
 * access. The MCP bearer should NEVER be used for ingest, and vice versa.
 */
import type { Env } from "../index";
import { createSupabase } from "../lib/supabase";
import { ingestHealth } from "./health";
import { ingestCapture } from "./capture";
import { ingestExpense } from "./expense";
import { ingestContent } from "./content";

type Handler = (body: unknown, env: Env) => Promise<{ status: number; body: unknown }>;

const HANDLERS: Record<string, Handler> = {
  health: ingestHealth,
  capture: ingestCapture,
  expense: ingestExpense,
  content: ingestContent,
};

export async function handleIngest(req: Request, env: Env, kind: string): Promise<Response> {
  // Separate ingest token (NOT the MCP bearer).
  if (!checkIngestAuth(req, env)) {
    return new Response("unauthorized", { status: 401 });
  }
  const handler = HANDLERS[kind];
  if (!handler) {
    return json({ error: `unknown ingest kind: ${kind}` }, 404);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  try {
    const result = await handler(body, env);
    return json(result.body, result.status);
  } catch (e) {
    return json({ error: "handler failed", detail: String(e) }, 500);
  }
}

function checkIngestAuth(req: Request, env: Env): boolean {
  const want = (env as any).INGEST_BEARER_TOKEN as string | undefined;
  if (!want) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got || got.length !== want.length) return false;
  let m = 0;
  for (let i = 0; i < got.length; i++) m |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return m === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Re-export for index.ts wiring
export { createSupabase };
