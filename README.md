# personal-brain-mcp

> A serious second brain for your personal life, exposed as a Model Context Protocol server. Drop it into Claude Desktop, Cursor, n8n, or any MCP client and ask your own life questions.

```
Claude Desktop / Cursor / n8n / your own agents
                │
                │  POST /mcp — Streamable HTTP (stateless) + Bearer or OAuth
                ▼
        Cloudflare Worker  ◄────  iPhone Shortcuts (capture, health)
        (this repo)        ◄────  Telegram / Discord bots (chat capture)
                │
                │  Postgres + pgvector (service role)
                ▼
              Supabase
        (schema: brain)
```

Implements MCP protocol revision **2026-07-28** (stateless Streamable HTTP),
with a compatibility path for 2025-11-25 / 2025-06-18 / 2025-03-26 clients.
Coming from an older build? See [MIGRATION-2026-07-28.md](./MIGRATION-2026-07-28.md).

## What it is

A personal-life database with **54 tools** + **4 HTTP ingest endpoints** + **inbound chat bots** across 13 domains, with semantic search, hybrid retrieval (vector + keyword), and a four-layer memory model.

You stand it up once, then use it from any MCP-aware AI client. It's your brain; you own the data; it runs on free tiers.

### Domains covered

| Domain | Tracks |
|---|---|
| **Memory** | Identity, durable facts, episodic journal, decisions, gratitudes |
| **Food** | Recipes, meal plan, pantry, dietary prefs |
| **Home** | Inventory, warranties, projects, maintenance, expenses, properties |
| **Vehicles** | Fleet, mileage, service history, insurance/registration |
| **Pets** | Health events, vet schedule, food brands |
| **People** | Family, gifts, personal contacts, interactions, professionals |
| **Health** | Workouts, medications, providers, wearable metrics |
| **Travel** | Trip history, packing templates |
| **Hobbies** | Reading list, content queue |
| **Finance** | Subscriptions, tax docs, account directory |
| **Records** | Documents, anniversaries, wishlist, emergency info, routines |
| **Projects** | Personal projects, bucket list |
| **Composite** | ask_brain, current_state, dashboard, briefings, capture, recall, proactive check |

Full catalog: [TOOLS.md](./TOOLS.md).

## Why this exists

- **Memory you control.** No vendor lock-in. The brain is just Postgres rows you can dump anytime.
- **One brain, many clients.** Same data accessible from every AI client that speaks MCP.
- **Cheap.** Cloudflare Workers free tier + Supabase free tier + ~$0.50/mo for OpenAI embeddings.
- **Opinionated.** Schema and tools designed for a real personal life, not a generic note-taking app.

## Quick start

If you know what you're doing:

```bash
git clone https://github.com/YOUR_GITHUB_USER/personal-brain-mcp.git
cd personal-brain-mcp
npm install
cp .dev.vars.example .dev.vars     # fill in real values
supabase link --project-ref <ref>
supabase db push
wrangler dev
```

If you want guidance, read [**SETUP.md**](./SETUP.md). It walks the whole flow with the why behind each step.

## Documentation

| File | What's in it |
|---|---|
| [SETUP.md](./SETUP.md) | Beginner-friendly end-to-end setup |
| [MEMORY.md](./MEMORY.md) | Four-layer memory architecture (identity, state, episodic, semantic) |
| [TOOLS.md](./TOOLS.md) | Full tool and endpoint catalog |
| [CRON.md](./CRON.md) | Scheduled jobs (daily proactive push to chat) |
| [system-prompt-template.md](./system-prompt-template.md) | Drop-in instructions for your LLM client |
| [shortcuts/README.md](./shortcuts/README.md) | iPhone Shortcuts for capture/health/expense |
| [bots/README.md](./bots/README.md) | Telegram + Discord chat capture bots |
| [bots/telegram-setup.md](./bots/telegram-setup.md) | ~10 minute Telegram bot setup |
| [bots/discord-setup.md](./bots/discord-setup.md) | ~20 minute Discord bot setup |
| [bots/whatsapp-setup.md](./bots/whatsapp-setup.md) | WhatsApp setup if you commit to it |

## Stack

- **Cloudflare Workers** — Worker + Cron Triggers (free tier handles personal use easily)
- **Supabase** — Postgres + pgvector + RLS (free tier works for one user; upgrade for backups)
- **OpenAI** — `text-embedding-3-small` for semantic search
- **TypeScript + MCP SDK + Zod** — server-side
- **`@supabase/supabase-js`** — typed DB client

## What this is NOT

- **Not a calendar.** Use your existing calendar (Google, Outlook, etc.). This brain has a `query_external_data` tool that points the LLM to your calendar connector when needed.
- **Not an email client.** Same as calendar.
- **Not a balance tracker.** It tracks *which accounts exist*, not balances. Use Plaid / your bank's portal for balances.
- **Not a habit tracker.** Use TickTick, Habitica, Streaks, etc. — they're better at habits than a Postgres row would be.
- **Not for business data.** Build a second MCP server for business context (the architecture supports this — just use a different Supabase schema like `org_a` and a separate Worker).

## Architecture decisions worth understanding before you fork

- **MCP as the access layer, not the storage.** The brain is just Postgres. MCP tools are the read/write API. You can always query the DB directly.
- **Service role from the Worker.** RLS is enabled but no policies; the Worker is the trust boundary. Single-user assumption baked in. If you want multi-tenant, write proper RLS policies before deploying.
- **Append-immutable facts.** Layer-4 facts use `superseded_by` chains. Old values are preserved.
- **Hybrid retrieval.** `ask_brain` combines vector similarity with `pg_trgm` keyword match. Both contribute.
- **Source-agnostic chat capture.** Adding a new platform = one adapter file. iMessage and Signal are explicitly NOT supported (see [bots/README.md](./bots/README.md) for reasoning).

## Origin and credit

Inspired in part by [Friday](https://missingus3r.github.io/friday-showcase/) (a 24/7 assistant built on Claude Code), particularly its proactive-messaging pattern, control-plane-as-prompt approach, and hybrid retrieval. Architecture diverges where MCP-as-server and pgvector-as-store are the better fit.

## License

MIT. See [LICENSE](./LICENSE).

## Contributing

PRs welcome for:
- Additional ingest sources (WhatsApp implementation, Slack, etc.)
- Additional MCP clients beyond Claude Desktop
- Schema or tool improvements that stay generic
- More iPhone / Android Shortcuts patterns

Not welcome:
- Personal-flavor changes (your spouse's name as the default test value, etc.)
- Locking the design to a single LLM vendor
- Bundling external dependencies that aren't justified

If your fork diverges significantly from "personal life brain," that's great — give it a different name and link back. This project will stay opinionated about scope.
