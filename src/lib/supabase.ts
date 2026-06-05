/**
 * Supabase client configured with the service role key.
 * Bypasses RLS — the Worker is the trust boundary.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../index";

export type DB = SupabaseClient;

export function createSupabase(env: Env): DB {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "brain" as any },
    global: { headers: { "x-application": "personal-brain-mcp" } },
  });
}
