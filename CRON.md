# Scheduled jobs (Cloudflare Worker crons)

## What's wired up

| Cron | Default schedule | Action |
|---|---|---|
| `0 13 * * *` | Daily 13:00 UTC (≈ 8 AM Eastern in winter, 9 AM in summer) | Run `proactive_check` logic; if signals at urgency ≥ 4 exist, push a Markdown briefing to Telegram (or Discord, configurable). |

Source: `src/cron/proactive_push.ts`. Dispatched by the `scheduled` handler in `src/index.ts`. Schedule lives in `wrangler.toml` under `[triggers]`.

## How it works

1. Cloudflare fires the scheduled event at the configured UTC time.
2. Worker calls `runDailyProactivePush(env)`.
3. That function queries Supabase directly (does NOT go through MCP) to gather urgent signals across maintenance, refills, documents, vehicles, neglected contacts, pets, and blocked projects.
4. If `CRON_SUPPRESS_EMPTY=true` (default) and nothing is urgent, nothing is sent.
5. Otherwise, formats a Markdown briefing and POSTs to your configured channel.

## Required config

Set these as Worker secrets / vars (NOT in `.dev.vars` if you want them in prod):

```bash
wrangler secret put CRON_PUSH_CHANNEL    # "telegram" | "discord" | "none"
wrangler secret put CRON_PUSH_CHAT_ID    # Telegram chat id OR Discord channel id
```

For Telegram: the `chat_id` is your own user ID (same one in `INBOUND_ALLOWED_USERS`).
For Discord: a channel ID (right-click channel → Copy Channel ID, with Developer Mode enabled).

Optional tuning (defaults shown):

```bash
wrangler secret put CRON_MIN_URGENCY      # default "4"
wrangler secret put CRON_LIMIT            # default "10"
wrangler secret put CRON_SUPPRESS_EMPTY   # default "true"
```

If you set `CRON_PUSH_CHANNEL=none`, the cron still runs and logs results — useful for debugging without spamming yourself.

## Pick your UTC time

Cloudflare cron is UTC-only and does NOT adjust for DST. You'll want a single fixed UTC time that hits your morning year-round. Examples:

| Your local time | UTC cron | Notes |
|---|---|---|
| 7 AM Eastern (winter) | `0 12 * * *` | Becomes 8 AM Eastern in summer (EDT) |
| 8 AM Eastern (winter) | `0 13 * * *` | Becomes 9 AM Eastern in summer — DEFAULT |
| 8 AM Pacific (winter) | `0 16 * * *` | Becomes 9 AM Pacific in summer |
| 7 AM Central European | `0 6 * * *` | Becomes 8 AM CEST in summer |

Pick the one whose summer-shifted time you still want to receive at.

## Testing locally

`wrangler dev` does not fire cron triggers by default. To test the cron logic without waiting for 13:00 UTC:

```bash
# Option 1: trigger manually via wrangler dev with --test-scheduled flag
wrangler dev --test-scheduled

# Then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+13+*+*+*"
```

The Worker will execute the cron path. Check `wrangler dev` logs for the push attempt.

## Testing in production

After deploy:

```bash
# Trigger immediately via the Cloudflare dashboard:
# Workers & Pages → personal-brain-mcp → Triggers → Cron → "Trigger Now"
```

Or wait for the scheduled time. `wrangler tail` shows the cron firing.

## Adding more crons

Add another entry to `[triggers].crons` in `wrangler.toml`, then branch on `event.cron` in the `scheduled` handler.

Example: a Sunday weekly review push.

```toml
[triggers]
crons = [
  "0 13 * * *",      # daily morning
  "0 22 * * 0",      # Sunday 22:00 UTC = late afternoon Eastern weekly review
]
```

```ts
async scheduled(event, env, ctx) {
  if (event.cron === "0 13 * * *") {
    ctx.waitUntil(runDailyProactivePush(env));
  } else if (event.cron === "0 22 * * 0") {
    ctx.waitUntil(runWeeklyReviewPush(env));  // not implemented yet
  }
}
```

## What to do if you get tired of daily pushes

Options ranked from least to most disruptive:

1. Raise `CRON_MIN_URGENCY` to 6 or 7 — only really urgent stuff
2. Switch to `CRON_PUSH_CHANNEL=none` — keep the cron running for logs only
3. Comment out the cron entry in `wrangler.toml` and re-deploy

## Cost

Cloudflare Workers free tier: 100,000 cron invocations/month. Daily = 30/month. You're rounding error.
