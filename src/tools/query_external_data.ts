/**
 * query_external_data — placeholder router. When the agent asks for data
 * that lives in a connected external service (calendar, email, weather,
 * sports schedules, live finance), this returns a pointer telling the
 * LLM where to look next, rather than failing silently.
 *
 * Update the EXTERNALS map as you wire up your own endpoints / connectors.
 */
import { z } from "zod";
import type { ToolRegistrar as McpServer } from "../protocol/registry";
import type { ToolCtx } from "../mcp";
import { ok, fail } from "../lib/errors";

const inputSchema = {
  data_type: z.enum([
    "calendar_personal",
    "calendar_work",
    "email",
    "weather",
    "sports_schedule",
    "flight_status",
    "frequent_flyer",
    "stocks",
    "news",
    "traffic",
  ]),
  context: z.string().optional().describe("Free text the LLM wants to act on"),
};

// Customize this map for YOUR external sources. Defaults are generic.
const EXTERNALS: Record<string, { connector: string; how: string }> = {
  calendar_personal: {
    connector: "(your calendar connector)",
    how: "Use your personal calendar connector (Google Calendar, Outlook, iCloud, etc.).",
  },
  calendar_work: {
    connector: "(your work calendar connector)",
    how: "Use your work/business calendar connector.",
  },
  email: {
    connector: "(your email connector)",
    how: "Use your email connector (Gmail, Outlook, etc.).",
  },
  weather: {
    connector: "(none — open web)",
    how: "Use a web search or a weather API directly.",
  },
  sports_schedule: {
    connector: "(none — open web)",
    how: "Query the league's official site or Google.",
  },
  flight_status: {
    connector: "(none — open web)",
    how: "Use FlightAware web or the airline's API.",
  },
  frequent_flyer: {
    connector: "(none — manual)",
    how: "Status lives in airline portals. Manually log key info into facts (e.g. 'user has_status United Premier 1K').",
  },
  stocks: {
    connector: "(your finance connector)",
    how: "Use your finance / brokerage connector.",
  },
  news: {
    connector: "(none — open web)",
    how: "Web search.",
  },
  traffic: {
    connector: "(none — open web)",
    how: "Web search or Google Maps.",
  },
};

export function register(server: McpServer, _ctx: ToolCtx) {
  server.tool(
    "query_external_data",
    "Pointer tool: tells the LLM where data lives when it's NOT in the personal brain (calendars, email, weather, sports, flight status). Returns the suggested connector or external source to query next. Customize the EXTERNALS map in this file for your own connectors.",
    inputSchema,
    async ({ data_type, context }) => {
      try {
        const route = EXTERNALS[data_type];
        if (!route) return fail(`no routing for ${data_type}`);
        return ok(
          `**${data_type}** is not stored in personal-brain.\n\n- Connector: \`${route.connector}\`\n- How: ${route.how}${context ? `\n\n_Context: ${context}_` : ""}`,
        );
      } catch (e) {
        return fail("query_external_data failed", e);
      }
    },
  );
}
