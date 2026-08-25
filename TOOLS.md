# Tool catalog — personal-brain-mcp v0.3

54 tools across 13 domains, plus 4 ingest endpoints. Every tool ships
`ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`); the source of truth is `src/protocol/annotations.ts`. See [MEMORY.md](./MEMORY.md) for the four-layer memory model and [shortcuts/README.md](./shortcuts/README.md) for iPhone Shortcut configs.

## Memory primitives (4)

The architectural foundation. See MEMORY.md.

| Tool | Layer | Purpose |
|---|---|---|
| `identity` | 1 — Identity | Who you are, voice rules, core values. Single row, always-loaded. |
| `facts` | 4 — Semantic | Durable facts (subject-predicate-object). Search, add, update, forget, promote from memory. |
| `search_memory` | 3 — Episodic | Semantic search over journal/decisions/gratitudes |
| `log_journal` | 3 — Episodic | Append a memory entry (auto-embedded) |

## Food (5)
`search_recipes` · `add_recipe` · `meal_plan` · `pantry` · `dietary_prefs`

## Home (6)
`house_projects` · `home_inventory` · `warranty_status` · `maintenance_schedule` · `log_household_expense` · `properties`

## Vehicles (1)
`vehicles` — fleet + service history with mileage-based due-detection

## Pets (1)
`pets` — pets + health events + due vaccinations

## People & relationships (5)
`family_member` · `gift_ideas` · `personal_contacts` · `log_interaction` · `professional_relationships`

## Travel (2)
`trip_history` · `packing_list`

## Health (4)
`workouts` · `medications` · `providers` · `health_metrics`

## Hobbies (2)
`reading_list` · `content_queue`

## Finance (3)
`subscriptions_audit` · `tax_documents` · `financial_accounts`

## Documents & records (5)
`documents` · `anniversaries` · `wishlist` · `emergency_info` · `routines`

## Projects & goals (2)
`personal_projects` · `bucket_list`

## Meta + composite (13)

The big-value tools that don't add schema:

| Tool | Purpose |
|---|---|
| `shopping_list` | Household shopping |
| `upcoming_dates` | Unified next-N-days across every dated table |
| `daily_personal_briefing` | Morning digest |
| `weekly_review` | Sunday-flavored look back + look forward |
| `personal_dashboard` | Monthly trend dashboard |
| `ask_brain` | Hybrid RAG (vector + keyword) across memory/facts/recipes/contacts/bucket/trips/docs |
| `get_current_state` | Layer-2 snapshot: what's true right now |
| `last_seen` | Who am I neglecting? |
| `gift_suggester` | Composite context for thoughtful gift suggestions |
| `meal_plan_from_pantry` | Pantry + diner restrictions + recipe candidates |
| `quick_capture` | Heuristic router for free-text input |
| `recall_conversation` | Search journal + interactions by person or topic |
| `query_external_data` | Pointer to which connector/source to query for non-brain data |
| `proactive_check` | Things needing attention right now — ranked. Cron-friendly. |

---

## HTTP ingest endpoints (INGEST_BEARER_TOKEN)

Write-only endpoints for iPhone Shortcuts and webhooks. See [shortcuts/README.md](./shortcuts/README.md).

| Endpoint | Body | Use case |
|---|---|---|
| `POST /ingest/health` | `{metric,value}` or `{samples:[...]}`  | Apple Health daily push |
| `POST /ingest/capture` | `{text, embed?}` | Free-text quick capture (auto-routes) |
| `POST /ingest/expense` | `{amount, category, vendor?}` | Voice-driven expense logging |
| `POST /ingest/content` | `{url, title?, kind?}` | Share-sheet save to reading/content queue |

## Inbound chat bots (per-source crypto verification + allowlist)

See [bots/README.md](./bots/README.md). All use the same `commitCapture` pipeline as `/ingest/capture`, so routing behavior is identical.

| Endpoint | Source | Status |
|---|---|---|
| `POST /inbound/telegram` | Telegram bot via setWebhook | ✅ Active |
| `POST /inbound/discord` | Discord `/capture` slash command | ✅ Active |
| `POST /inbound/whatsapp` | Meta Cloud API | ⚠ Stubbed |
| iMessage | — | 🚫 Not supported (Mac infra cost not worth it) |
| Signal | — | 🚫 Not supported (against ToS, account-ban risk) |

---

## Suggested session-start sequence for an assistant

```
1. identity(action="get")                  ← Layer 1, always
2. get_current_state()                      ← Layer 2, "what's true now"
3. upcoming_dates(days=14)                  ← what needs attention
   (then proceed with the user's request)
```

For deep work or memory-heavy queries, add:
```
4. ask_brain(query=<user's intent>)
5. facts(action="by_subject", subject=<relevant entity>)
```

## What's NOT here (intentional)

- **Family / business calendars** — query via Outlook connector
- **Email** — Outlook connector
- **Live stock prices, balances, weather, sports** — `query_external_data` points you to the right source
- **Photos** — Apple Photos covers it
- **Habit tracking** — TickTick covers it
- **Genealogy / family tree** — out of scope

## Ingestion endpoints (future, not yet built)

- `POST /ingest/health` — iPhone Shortcut payload
- `POST /ingest/expense` — receipt parser webhook
- `POST /ingest/reading` — Readwise/Pocket/Matter webhook
- Cron: nightly memory consolidation → `weekly_summaries`
