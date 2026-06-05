# Setup guide

This is the long version. If you've stood up Cloudflare Workers + Supabase before, the README's Quick Start is faster. If this is your first time with either, read this.

**Total time:** 2-3 hours the first time. Most of it is reading and account creation, not coding.

**Cost:** $0 on free tiers + ~$0.50/month for OpenAI embeddings once you're actively capturing.

---

## What you'll have at the end

- A Cloudflare Worker at `https://your-brain.workers.dev` (or your custom domain)
- A Supabase database with 36 tables in the `brain` schema, pgvector enabled
- An MCP server that any compatible AI client can connect to
- Optionally: iPhone Shortcuts for capture, Telegram or Discord bots, a daily proactive briefing pushed to chat

## What you need before starting

| Requirement | How to get it |
|---|---|
| **Node.js 20+** | https://nodejs.org/ (LTS) |
| **npm** | Comes with Node |
| **Git** | https://git-scm.com/ |
| **A Cloudflare account** | https://dash.cloudflare.com/sign-up (free) |
| **A Supabase account** | https://supabase.com/dashboard (free) |
| **An OpenAI API key** | https://platform.openai.com/api-keys (~$0.50/mo at personal scale) |
| **A terminal** | macOS Terminal, Windows Terminal, etc. |

You do NOT need:
- A custom domain (Cloudflare gives you a `*.workers.dev` URL free)
- A paid Cloudflare or Supabase plan
- An iPhone (Shortcuts are optional; everything works without them)

## Mental model first

Before touching code: this system has three moving parts.

```
┌─────────────────────────────────────────┐
│ 1. Supabase (your data)                 │  Postgres database with 36 tables.
│                                         │  Lives in their cloud. You own the rows.
└─────────────────────────────────────────┘
                  ▲
                  │  service-role auth
┌─────────────────────────────────────────┐
│ 2. Cloudflare Worker (your API)         │  Hosts MCP server + HTTP endpoints.
│                                         │  Runs on Cloudflare's edge. Stateless.
└─────────────────────────────────────────┘
        ▲           ▲           ▲
        │ MCP       │ HTTP      │ Webhooks
        │ bearer    │ bearer    │ (signed)
┌───────┴───┐ ┌─────┴─────┐ ┌──┴────────────┐
│ AI client │ │ iPhone    │ │ Telegram /    │
│ (Claude   │ │ Shortcut  │ │ Discord bots  │
│  Desktop) │ │           │ │               │
└───────────┘ └───────────┘ └───────────────┘
3. Clients (your devices and AIs)
```

You'll set them up in that order: Supabase → Cloudflare Worker → clients.

---

## Phase 1 — Local environment (15 min)

### Install the CLIs

```bash
# Cloudflare Workers
npm install -g wrangler

# Supabase
# macOS
brew install supabase/tap/supabase
# Windows (PowerShell as admin)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
# Linux
curl -fsSL https://supabase.com/install.sh | sh

# Verify
node --version    # should be v20.x or v22.x
npm --version
wrangler --version
supabase --version
```

### Clone the repo

```bash
git clone https://github.com/YOUR_GITHUB_USER/personal-brain-mcp.git
cd personal-brain-mcp
npm install
```

This installs the MCP SDK, Supabase JS client, OpenAI SDK, Zod, and dev tooling.

### Generate your tokens

You need two distinct bearer tokens. Don't reuse them.

```bash
# MCP token (for AI clients to call tools)
openssl rand -hex 32

# Ingest token (for iPhone Shortcuts and webhooks)
openssl rand -hex 32
```

Save both somewhere secure (1Password, Bitwarden, etc.). You'll paste them into Worker secrets later.

### Set up local secrets

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` in your editor. Don't fill it in yet — we need the Supabase values first.

---

## Phase 2 — Supabase (30 min)

### Create the project

1. Go to https://supabase.com/dashboard
2. **New project**
3. Pick a name (e.g. `personal-brain`), generate a strong DB password, pick the closest region
4. Wait ~2 minutes for provisioning

### Collect the values you need

In the Supabase dashboard, **Project Settings → API**:
- **Project URL** → save as `SUPABASE_URL` (e.g. `https://abcdefg.supabase.co`)
- **anon public key** → not actually used by this server (Worker uses service role) but save it
- **service_role secret key** → save as `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **treat like a password**

In **Project Settings → General**:
- **Reference ID** → save it. Used in the next step.

### Link the CLI to your project

```bash
supabase login              # opens browser
supabase link --project-ref YOUR_REF_ID
# Will ask for your DB password. Paste it.
```

### Apply the migrations

```bash
supabase db push
```

This applies the three migrations in `supabase/migrations/`:
- `0001_init.sql` — base schema (6 tables, pgvector, RPCs)
- `0002_full_scope.sql` — extended life domains (16 more tables)
- `0003_assistant_scope.sql` — assistant scope (14 more tables, identity + facts + RLS)

Expected output: `Applying migration 0001_init.sql...` repeated three times, then success.

### Verify the schema

In the Supabase dashboard:
1. **Table Editor** → top-left schema dropdown → switch to **brain**
2. You should see ~36 tables.
3. **brain.identity** has exactly one row (id=1) — that's intentional. You'll fill it in later.

### Confirm RLS is on (and intentionally blocked)

In **Database → Tables**, click any `brain.*` table. The "RLS enabled" badge should be green. No policies exist — that's correct. The Worker uses the service role key which bypasses RLS. RLS is there to prevent accidental exposure if you ever build a public-facing client.

---

## Phase 3 — Local Worker (15 min)

### Fill in `.dev.vars`

Open it in your editor and fill in:
```
SUPABASE_URL=https://abcdefg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
OPENAI_API_KEY=sk-...your-openai-key...
MCP_BEARER_TOKEN=...your-first-generated-token...
INGEST_BEARER_TOKEN=...your-second-generated-token...
```

Leave the bot-specific variables blank — we'll fill them later if you add bots.

`.dev.vars` is in `.gitignore`. It will not be committed.

### Start the Worker locally

```bash
wrangler dev
```

You should see something like:
```
⛅️ wrangler 3.x.x
⎔ Starting local server...
[wrangler:inf] Ready on http://localhost:8787
```

In a SECOND terminal, test the health endpoint:
```bash
curl http://localhost:8787/health
# → {"ok":true,"service":"personal-brain-mcp"}
```

Test MCP auth blocking:
```bash
curl -i http://localhost:8787/sse
# → 401 unauthorized
```

Test MCP auth working:
```bash
curl -H "Authorization: Bearer YOUR_MCP_TOKEN" http://localhost:8787/sse --no-buffer
# → opens an SSE stream. Ctrl-C to close.
```

Test ingest:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metric":"weight_lb","value":175.5}' \
  http://localhost:8787/ingest/health
# → {"ok":true,"inserted":1}
```

Open Supabase Studio → `brain.health_metrics` table → confirm the row appeared.

### Smoke-test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Browser opens. Configure:
- **Transport type:** SSE
- **URL:** `http://localhost:8787/sse`
- **Headers:** `Authorization: Bearer YOUR_MCP_TOKEN`

Click **Connect**. You should see ~47 tools listed in the left panel.

Try:
- `identity(action="get")` → returns the empty seeded row
- `identity(action="update", patch={preferred_name: "Your Name", timezone: "America/New_York"})` → success
- `identity(action="get")` again → shows your patch
- `log_journal(entry: "First entry — testing the brain")` → success
- `search_memory(query: "testing")` → finds your entry

If all five work, the brain is functional.

---

## Phase 4 — Deploy (15 min)

### Push secrets to Cloudflare

```bash
wrangler secret put SUPABASE_URL
# (paste value, press enter)

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put MCP_BEARER_TOKEN
wrangler secret put INGEST_BEARER_TOKEN
```

### Deploy

```bash
wrangler deploy
```

Expected output ends with something like:
```
Uploaded personal-brain-mcp (1.2 sec)
Published personal-brain-mcp (0.5 sec)
  https://personal-brain-mcp.your-subdomain.workers.dev
Current Deployment ID: ...
```

### Verify production

```bash
curl https://personal-brain-mcp.your-subdomain.workers.dev/health
# → {"ok":true,...}
```

Connect MCP Inspector to the production URL (same as local but swap the host). Confirm all tools list and identity round-trip works.

### Optional: custom domain

In `wrangler.toml`, uncomment the routes block and set your domain:
```toml
[[routes]]
pattern = "brain.yourdomain.com"
custom_domain = true
```

Then `wrangler deploy` again. Cloudflare manages the DNS automatically if your domain is on Cloudflare; otherwise, you'll need to point a CNAME to the worker.

---

## Phase 5 — Connect Claude Desktop (or your MCP client) (10 min)

### Claude Desktop

Edit your Claude Desktop config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add:
```json
{
  "mcpServers": {
    "personal-brain": {
      "url": "https://personal-brain-mcp.your-subdomain.workers.dev/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

If you already have other servers in `mcpServers`, add this one alongside them.

Restart Claude Desktop. The MCP indicator in the input bar should show "personal-brain" with a green dot. Click it to confirm all tools are listed.

### Other clients

- **Cursor:** Settings → MCP → Add Server (same URL + headers)
- **n8n:** MCP node → SSE transport → URL + bearer header
- **Custom Python/JS agent:** Use the official MCP SDK with the SSE transport pointed at your URL

### Drop in the system prompt

Open `system-prompt-template.md` from the repo. Copy its contents into your client's project instructions / custom prompt / system prompt. This tells the AI how to use the brain effectively — session start sequence, tool policies, confirmation defaults.

The template is generic; tweak the voice rules to match how you actually want it to respond to you.

---

## Phase 6 — Seed your identity (5 min)

The brain is empty. Before adding more clients, fill in `brain.identity` so every future session has context.

In Claude Desktop, ask:
> Update my identity with: name {{YOUR_NAME}}, timezone America/Whatever, languages English, voice rule "no em dashes".

The AI will call `identity(action="update", ...)` and confirm.

Then verify:
> Get my identity.

You'll see the row populated.

This is now Layer-1 context every assistant session has access to. Worth taking 5 more minutes to fill in: birthday, primary address, blood type if you want it on-hand, core values, languages.

---

## Phase 7 — Optional add-ons

You have a working brain. From here, pick what you actually want.

### iPhone Shortcuts (~30 min)

See [shortcuts/README.md](./shortcuts/README.md). Five Shortcuts cover:
- Daily vitals push from Apple Health
- "Hey Siri, capture" voice-to-brain
- "Hey Siri, log expense" expense voice logging
- Share-sheet save for articles/videos
- Voice journal

Worth it if you use an iPhone and want capture from anywhere.

### Telegram bot (~10 min)

See [bots/telegram-setup.md](./bots/telegram-setup.md). Set up a Telegram bot you DM to capture thoughts. Works on any device with Telegram. Lowest-friction option.

### Discord bot (~20 min)

See [bots/discord-setup.md](./bots/discord-setup.md). Adds a `/capture` slash command in any Discord server you're in. Nice if you live in Discord.

### Daily proactive push (~5 min)

See [CRON.md](./CRON.md). A Cloudflare cron fires daily, gathers "things needing attention" (overdue maintenance, refills due, expiring documents, neglected contacts, etc.), and posts them to your Telegram or Discord.

```bash
wrangler secret put CRON_PUSH_CHANNEL    # value: telegram
wrangler secret put CRON_PUSH_CHAT_ID    # value: your chat id
```

The cron is already scheduled in `wrangler.toml` (`0 13 * * *` UTC = 9 AM Eastern in summer / 8 AM in winter). Adjust if you're not in Eastern.

---

## Phase 8 — Populate (ongoing)

The brain becomes useful at ~30 rows of meaningful data, not before. Suggested order:

1. **Identity** — Phase 6 above
2. **Properties** — your home (and any second home, parents' place, etc.)
3. **Vehicles** — every vehicle with VIN, plate, registration renewal date
4. **Pets** — name, species, vet
5. **Personal contacts** — 10-20 closest people. Tag the ones you want stay-in-touch reminders for with `["stay_in_touch"]`.
6. **Documents** — passport, drivers license, insurance policies. Include `expires_at` dates.
7. **Emergency info** — at minimum: spare key locations, POA holder, will location

Don't try to populate everything. Skip what isn't useful for your life.

Then USE it for 30 days. Note what's missing. Extend the schema only when you've hit a real gap, not a theoretical one.

---

## Troubleshooting

### `wrangler dev` fails with port already in use

Some other process on 8787. Either kill it or:
```bash
wrangler dev --port 8788
```

### Supabase `supabase db push` fails

Most common cause: project not linked correctly. Re-run `supabase link --project-ref <ref>`.

Second most common: a previous failed migration left the DB in an inconsistent state. Drop the `brain` schema in Supabase Studio (SQL Editor → `drop schema brain cascade;`) and re-push.

### `wrangler deploy` fails with "compatibility flags"

The `wrangler.toml` requires `nodejs_compat`. If your Cloudflare account is older, you may need to enable it in the dashboard: Workers & Pages → your worker → Settings → Compatibility flags → add `nodejs_compat`.

### MCP Inspector connects but no tools show

Usually a verify/parse error on the SSE handshake. Check `wrangler tail` while connecting; you'll see the request and any errors.

### Embeddings fail with rate-limit errors

Hit OpenAI's free-tier rate limit. Either upgrade to pay-as-you-go (a few dollars at most for personal scale) or run the backfill script in batches: `npm run embed:backfill -- --table=memory --limit=50`.

### Telegram bot doesn't reply

1. Did you set the webhook? `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — `url` should be your worker URL.
2. Is your Telegram user ID in `INBOUND_ALLOWED_USERS`? Without it, you get a silent ignore.
3. `wrangler tail` shows incoming webhooks. If you see one and the response is `200 ignored`, it's the allowlist issue.

### Discord interactions endpoint won't save

The Ed25519 verification is strict. Most common cause: `DISCORD_PUBLIC_KEY` has a typo or extra whitespace. Copy-paste exactly from the Discord developer portal.

### "I asked the AI a question and it just answered from training data, not from my brain"

Two things:
1. Did you drop in `system-prompt-template.md`? Without that, the AI doesn't know to call `ask_brain` / `search_memory` / `facts` for personal queries.
2. Is your brain actually populated? Empty brain = empty results = AI falls back to general knowledge.

---

## Next steps after setup

- Read [MEMORY.md](./MEMORY.md) to understand the four-layer model.
- Read [TOOLS.md](./TOOLS.md) to see what's available.
- Spend a week populating. Don't extend the schema yet.
- After two weeks, you'll have an opinion about what's missing. Then extend.

## Getting help

- Re-read [TOOLS.md](./TOOLS.md) — most "I want to do X" questions have a tool already.
- Check `wrangler tail` for live logs when debugging webhooks or crons.
- Open an issue on the repo with the specific error message and `wrangler tail` snippet.
