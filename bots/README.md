# Chat bots for personal-brain-mcp

Source-agnostic webhook router that turns Telegram and Discord into capture surfaces for the brain. Same `commitCapture` pipeline as `/ingest/capture`, so behavior is consistent across every input channel.

## Supported sources

| Source | Status | Setup time | Notes |
|---|---|---|---|
| **Telegram** | ✅ Active | ~10 min | Recommended primary. Works internationally. |
| **Discord** | ✅ Active | ~20 min | Slash command `/capture`. Nice if you live in Discord. |
| **WhatsApp** | ⚠ Stubbed | ~2-4 hrs | Meta Cloud API. Activate when you commit to it. |
| **iMessage** | 🚫 Not supported | — | Requires a Mac running 24/7 with BlueBubbles. Not worth the infra for capture-only. |
| **Signal** | 🚫 Not supported | — | `signal-cli` is unofficial and against Signal's ToS. Risks account ban. Use Signal for humans, Telegram for the brain. |

## Architecture

```
        ┌─────────────────────────────────────┐
        │  POST /inbound/<source>             │
        │  (Cloudflare Worker)                │
        └────────────┬────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │ Adapter:                │
        │   verify(req, env)      │  source-specific crypto check
        │   parse(req)            │  → NormalizedMessage
        │   reply(msg, text)      │  source-specific ack API
        └────────────┬────────────┘
                     │
        ┌────────────▼─────────────────────┐
        │ commitCapture(text, env)         │  shared with /ingest/capture
        │   → routes to brain.*            │
        │   → returns {ok, routed_to}      │
        └──────────────────────────────────┘
```

Adding a new source = write one adapter file (`verify`/`parse`/`reply`) + register in `router.ts`. The pipeline is unchanged.

## Required env vars (Worker secrets)

For all sources:

```
INBOUND_ALLOWED_USERS = "telegram:123456,discord:987654321"
```

This is the allowlist. Format: `<source>:<external_user_id>`, comma-separated. Without your ID on this list, the router accepts the webhook but silently ignores the message. **No allowlist = no inbound writes.**

For Telegram:

```
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
```

For Discord:

```
DISCORD_PUBLIC_KEY
DISCORD_APP_ID
DISCORD_BOT_TOKEN
```

For WhatsApp (if you activate it):

```
WHATSAPP_VERIFY_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
```

## Setup

- [Telegram setup](./telegram-setup.md)
- [Discord setup](./discord-setup.md)
- [WhatsApp setup](./whatsapp-setup.md) (when ready)

## How a capture flows

1. You message your bot: `buy more coffee filters`
2. Provider POSTs to `/inbound/telegram`
3. Adapter `verify()` checks the signature/secret
4. Adapter `parse()` returns `{source:"telegram", text:"buy more coffee filters", user_external_id:"123456"}`
5. Router checks `INBOUND_ALLOWED_USERS` allowlist
6. `commitCapture()` routes the text → "shopping" → inserts row
7. Adapter `reply()` sends back: `✓ shopping: more coffee filters`

End-to-end latency: ~400-800ms for Telegram, ~800-1500ms for Discord (because Discord's interactions protocol requires the deferred-response dance).

## Why no iMessage / Signal

**iMessage** has no official API. The only ways to wire it up are:
- BlueBubbles / sendblue: requires a Mac mini running 24/7. Infra cost ($300 hardware + electricity + maintenance) isn't worth it when Shortcuts already covers phone-side capture.
- Loopback: send iMessage → Shortcut → ingest. Already supported via the existing `Brain · Capture` shortcut.

**Signal** has no official API for personal accounts. `signal-cli` is community-maintained, uses an unofficial protocol, is explicitly against Signal's ToS for automated use, and has gotten accounts banned. Signal's value is end-to-end encryption with no third-party access — wiring a bot into it defeats the purpose.

Recommended: keep Signal for human-to-human encrypted comms. Use Telegram (or Discord, or Shortcuts) as your bot pipe.

## Routing heuristics

Same as `/ingest/capture` and `quick_capture`:

| Pattern | Routed to |
|---|---|
| URL containing youtube/youtu.be/spotify/podcast | `content_queue` (video/podcast) |
| Any other URL | `reading_list` (article) |
| Starts with `buy`/`get`/`grab`/`pick up`/`need`/`add to list` or contains `grocery`/`hardware`/`amazon` | `shopping` |
| Starts with `i want`/`want a`/`want the`/`would love`/`want to own` | `wishlist` |
| Contains `decided`/`decision`/`i'm going to`/`going with`/`chose` | `memory` type=decision |
| Contains `grateful`/`gratitude`/`thank`/`thankful` | `memory` type=gratitude |
| Anything else | `memory` type=journal |

To override the heuristic, prefix your message:
- `note: today was great` → forces journal
- (extending the prefix vocabulary is a one-line change in `capture_pipe.ts`)

## Future enhancements

Not built yet:
- **Slash commands beyond `/capture`** — Discord can host `/recall`, `/brief`, `/ask` mapped to MCP tools. Build when chat becomes a primary query surface.
- **Reaction-based actions** — Telegram lets bots react to messages. Could let you 👍 a journal entry to promote it to a fact.
- **Voice messages** — Telegram supports voice; we'd transcribe via Whisper/Groq and feed to `commitCapture`.
- **Daily briefing push** — outbound, not inbound. Wire a cron to fetch `daily_personal_briefing` + send to Telegram. Lives in `crons/`, not here.
