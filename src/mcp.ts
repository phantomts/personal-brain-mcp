/**
 * Tool registry factory. Builds the full tool catalog once per isolate.
 *
 * The transport is stateless (2026-07-28), so there is no per-connection
 * server object any more — the catalog is metadata plus handlers bound to env.
 *
 * Adding a new tool:
 *   1. Create src/tools/<your_tool>.ts exporting `register(server, ctx)`.
 *   2. Import and call it below.
 *   3. Add it to READ_ONLY_TOOLS / DESTRUCTIVE_TOOLS / APPEND_ONLY_TOOLS in
 *      src/protocol/annotations.ts so its hints are honest.
 */
import { ToolRegistry } from "./protocol/registry";
import type { Env } from "./index";
import { createSupabase } from "./lib/supabase";
import { createEmbedder } from "./lib/embeddings";

// === Layer 1 + Layer 4 memory primitives ===
import { register as registerIdentity } from "./tools/identity";
import { register as registerFacts } from "./tools/facts";

// === Layer 3 memory (episodic) ===
import { register as registerSearchMemory } from "./tools/search_memory";
import { register as registerLogJournal } from "./tools/log_journal";

// === Food ===
import { register as registerSearchRecipes } from "./tools/search_recipes";
import { register as registerAddRecipe } from "./tools/add_recipe";
import { register as registerMealPlan } from "./tools/meal_plan";
import { register as registerPantry } from "./tools/pantry";
import { register as registerDietaryPrefs } from "./tools/dietary_prefs";

// === Home ===
import { register as registerHouseProjects } from "./tools/house_projects";
import { register as registerHomeInventory } from "./tools/home_inventory";
import { register as registerWarrantyStatus } from "./tools/warranty_status";
import { register as registerMaintenanceSchedule } from "./tools/maintenance_schedule";
import { register as registerLogHouseholdExpense } from "./tools/log_household_expense";
import { register as registerProperties } from "./tools/properties";

// === Vehicles ===
import { register as registerVehicles } from "./tools/vehicles";

// === Pets ===
import { register as registerPets } from "./tools/pets";

// === People & relationships ===
import { register as registerFamilyMember } from "./tools/family_member";
import { register as registerGiftIdeas } from "./tools/gift_ideas";
import { register as registerPersonalContacts } from "./tools/personal_contacts";
import { register as registerLogInteraction } from "./tools/log_interaction";
import { register as registerProfessionalRelationships } from "./tools/professional_relationships";

// === Travel ===
import { register as registerTripHistory } from "./tools/trip_history";
import { register as registerPackingList } from "./tools/packing_list";

// === Health ===
import { register as registerWorkouts } from "./tools/workouts";
import { register as registerMedications } from "./tools/medications";
import { register as registerProviders } from "./tools/providers";
import { register as registerHealthMetrics } from "./tools/health_metrics";

// === Hobbies ===
import { register as registerReadingList } from "./tools/reading_list";
import { register as registerContentQueue } from "./tools/content_queue";

// === Finance ===
import { register as registerSubscriptionsAudit } from "./tools/subscriptions_audit";
import { register as registerTaxDocuments } from "./tools/tax_documents";
import { register as registerFinancialAccounts } from "./tools/financial_accounts";

// === Documents, records, life ===
import { register as registerDocuments } from "./tools/documents";
import { register as registerAnniversaries } from "./tools/anniversaries";
import { register as registerWishlist } from "./tools/wishlist";
import { register as registerEmergencyInfo } from "./tools/emergency_info";
import { register as registerRoutines } from "./tools/routines";
import { register as registerPersonalProjects } from "./tools/personal_projects";
import { register as registerBucketList } from "./tools/bucket_list";

// === Meta + composite ===
import { register as registerShoppingList } from "./tools/shopping_list";
import { register as registerUpcomingDates } from "./tools/upcoming_dates";
import { register as registerDailyBriefing } from "./tools/daily_personal_briefing";
import { register as registerWeeklyReview } from "./tools/weekly_review";
import { register as registerPersonalDashboard } from "./tools/personal_dashboard";
import { register as registerAskBrain } from "./tools/ask_brain";
import { register as registerGetCurrentState } from "./tools/get_current_state";
import { register as registerLastSeen } from "./tools/last_seen";
import { register as registerGiftSuggester } from "./tools/gift_suggester";
import { register as registerMealPlanFromPantry } from "./tools/meal_plan_from_pantry";
import { register as registerQuickCapture } from "./tools/quick_capture";
import { register as registerRecallConversation } from "./tools/recall_conversation";
import { register as registerQueryExternalData } from "./tools/query_external_data";
import { register as registerProactiveCheck } from "./tools/proactive_check";

export interface ToolCtx {
  env: Env;
  supabase: ReturnType<typeof createSupabase>;
  embed: ReturnType<typeof createEmbedder>;
}

export function buildRegistry(env: Env): ToolRegistry {
  const server = new ToolRegistry();

  const ctx: ToolCtx = {
    env,
    supabase: createSupabase(env),
    embed: createEmbedder(env),
  };

  // Identity + facts
  registerIdentity(server, ctx);
  registerFacts(server, ctx);

  // Episodic memory
  registerSearchMemory(server, ctx);
  registerLogJournal(server, ctx);

  // Food
  registerSearchRecipes(server, ctx);
  registerAddRecipe(server, ctx);
  registerMealPlan(server, ctx);
  registerPantry(server, ctx);
  registerDietaryPrefs(server, ctx);

  // Home
  registerHouseProjects(server, ctx);
  registerHomeInventory(server, ctx);
  registerWarrantyStatus(server, ctx);
  registerMaintenanceSchedule(server, ctx);
  registerLogHouseholdExpense(server, ctx);
  registerProperties(server, ctx);

  // Vehicles
  registerVehicles(server, ctx);

  // Pets
  registerPets(server, ctx);

  // People & relationships
  registerFamilyMember(server, ctx);
  registerGiftIdeas(server, ctx);
  registerPersonalContacts(server, ctx);
  registerLogInteraction(server, ctx);
  registerProfessionalRelationships(server, ctx);

  // Travel
  registerTripHistory(server, ctx);
  registerPackingList(server, ctx);

  // Health
  registerWorkouts(server, ctx);
  registerMedications(server, ctx);
  registerProviders(server, ctx);
  registerHealthMetrics(server, ctx);

  // Hobbies
  registerReadingList(server, ctx);
  registerContentQueue(server, ctx);

  // Finance
  registerSubscriptionsAudit(server, ctx);
  registerTaxDocuments(server, ctx);
  registerFinancialAccounts(server, ctx);

  // Documents, records, life
  registerDocuments(server, ctx);
  registerAnniversaries(server, ctx);
  registerWishlist(server, ctx);
  registerEmergencyInfo(server, ctx);
  registerRoutines(server, ctx);
  registerPersonalProjects(server, ctx);
  registerBucketList(server, ctx);

  // Meta + composite
  registerShoppingList(server, ctx);
  registerUpcomingDates(server, ctx);
  registerDailyBriefing(server, ctx);
  registerWeeklyReview(server, ctx);
  registerPersonalDashboard(server, ctx);
  registerAskBrain(server, ctx);
  registerGetCurrentState(server, ctx);
  registerLastSeen(server, ctx);
  registerGiftSuggester(server, ctx);
  registerMealPlanFromPantry(server, ctx);
  registerQuickCapture(server, ctx);
  registerRecallConversation(server, ctx);
  registerQueryExternalData(server, ctx);
  registerProactiveCheck(server, ctx);

  return server;
}
