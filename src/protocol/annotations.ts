/**
 * Tool annotations (2026-07-28 `ToolAnnotations`).
 *
 * All annotations are hints, but honest hints let a client decide what needs
 * a confirmation prompt. The read-only list below was derived by auditing
 * every tool for Supabase write calls (`insert`/`update`/`upsert`/`delete`);
 * keep it in sync when a tool gains a write action.
 */

/** Tools that only read. No Supabase writes anywhere in their handler. */
export const READ_ONLY_TOOLS = new Set<string>([
  "ask_brain",
  "daily_personal_briefing",
  "family_member",
  "get_current_state",
  "gift_ideas",
  "gift_suggester",
  "health_metrics",
  "house_projects",
  "last_seen",
  "meal_plan_from_pantry",
  "personal_dashboard",
  "proactive_check",
  "query_external_data",
  "recall_conversation",
  "search_memory",
  "search_recipes",
  "upcoming_dates",
  "warranty_status",
  "weekly_review",
]);

/**
 * Writing tools that can overwrite or remove existing rows, rather than only
 * appending. These are the calls a client should confirm with the user.
 */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  "anniversaries",
  "bucket_list",
  "content_queue",
  "dietary_prefs",
  "documents",
  "emergency_info",
  "facts",
  "financial_accounts",
  "home_inventory",
  "identity",
  "maintenance_schedule",
  "meal_plan",
  "medications",
  "packing_list",
  "pantry",
  "personal_contacts",
  "personal_projects",
  "pets",
  "professional_relationships",
  "properties",
  "providers",
  "reading_list",
  "routines",
  "shopping_list",
  "subscriptions_audit",
  "tax_documents",
  "trip_history",
  "vehicles",
  "wishlist",
  "workouts",
]);

/** Append-only writers: repeated identical calls add rows but destroy nothing. */
export const APPEND_ONLY_TOOLS = new Set<string>([
  "add_recipe",
  "log_household_expense",
  "log_interaction",
  "log_journal",
  "quick_capture",
]);

/**
 * Tools that reach outside this server's own data (network calls, other
 * services). Everything else operates on a closed world: your Supabase.
 */
export const OPEN_WORLD_TOOLS = new Set<string>(["query_external_data"]);

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export function annotationsFor(name: string, title?: string): ToolAnnotations {
  const readOnly = READ_ONLY_TOOLS.has(name);
  return {
    ...(title ? { title } : {}),
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: readOnly ? true : !APPEND_ONLY_TOOLS.has(name),
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}
