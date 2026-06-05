# Discord bot setup

Time: ~20 minutes. Slash command `/capture <text>` in any channel where the bot has access.

## Steps

### 1. Create the Discord application

Open https://discord.com/developers/applications → **New Application**.
- Name: `your Brain` (or anything)
- Accept ToS → Create

On the **General Information** page:
- Copy **Application ID** → save as `DISCORD_APP_ID`
- Copy **Public Key** → save as `DISCORD_PUBLIC_KEY`

### 2. Create a bot user

Left sidebar → **Bot** tab → **Add Bot** → Yes, do it.

- Click **Reset Token** → Yes → copy the token → save as `DISCORD_BOT_TOKEN`
- Toggle **Public Bot** off (you're the only one who needs it)
- Under "Privileged Gateway Intents", leave everything off (we don't use gateway, we use interactions).

### 3. Get your Discord user ID

In Discord client:
- Settings → Advanced → enable Developer Mode
- Close settings → right-click your own name in any channel → **Copy User ID**
- Save it as the value for `DISCORD_USER_ID`

### 4. Push secrets to the Worker

```bash
wrangler secret put DISCORD_APP_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
```

Update the allowlist:
```bash
wrangler secret put INBOUND_ALLOWED_USERS
# value: telegram:<your-id>,discord:<your-discord-user-id>
```

### 5. Register the `/capture` slash command

This is a one-time registration with Discord. Two options.

**Option A — quick curl** (registers globally; takes up to an hour to propagate):

```bash
curl -X POST "https://discord.com/api/v10/applications/<DISCORD_APP_ID>/commands" \
  -H "Authorization: Bot <DISCORD_BOT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "capture",
    "description": "Send a thought to your brain",
    "options": [{
      "type": 3,
      "name": "text",
      "description": "What to capture",
      "required": true
    }]
  }'
```

Expected response: JSON with the command details and an `id`.

**Option B — guild-scoped** (registers instantly to one server, useful for testing):

Replace the URL with:
```
https://discord.com/api/v10/applications/<DISCORD_APP_ID>/guilds/<GUILD_ID>/commands
```

Get the guild ID by right-clicking your server name → Copy Server ID (Dev Mode required).

### 6. Add the bot to your server

In the Discord developer portal:
- **OAuth2** → **URL Generator**
- Scopes: `bot` and `applications.commands`
- Bot Permissions: `Send Messages`, `Read Messages/View Channels`
- Copy the generated URL at the bottom, paste into a browser
- Pick the server you want the bot in → Authorize

The bot now appears in that server. By default it can read/post in any channel its role can see.

**Recommended:** Create a dedicated `#brain` channel and restrict the bot to only that channel via channel permissions.

### 7. Configure the Interactions Endpoint URL

Back in the developer portal → your app → **General Information**.

In the **Interactions Endpoint URL** field, paste:
```
https://<your-worker>.workers.dev/inbound/discord
```

Click **Save Changes**. Discord will immediately send a PING request to verify the endpoint. If everything's wired correctly, Discord shows ✅ and saves.

If it fails:
- Worker logs (`wrangler tail`) should show the PING attempt and Ed25519 verification.
- Most common cause: `DISCORD_PUBLIC_KEY` typo. Copy-paste from the dev portal exactly.
- Second most common: Worker not deployed yet, or wrong URL.

### 8. Test

In your `#brain` channel (or any channel where the bot is), type:
```
/capture text:test
```

Discord shows a "Brain is thinking..." indicator immediately (the deferred response), then within ~1 second the bot replies in the channel:
```
✓ memory: journal
```

Try variants:
- `/capture text:buy coffee filters` → `✓ shopping: coffee filters`
- `/capture text:I want a Sony WH-1000XM6` → `✓ wishlist`
- `/capture text:https://youtube.com/watch?v=abc` → `✓ content_queue`

## If something fails

**Endpoint URL save fails in Discord:**
- `DISCORD_PUBLIC_KEY` mismatch. The Ed25519 verification is strict.
- Worker not deployed. `wrangler deploy` first.

**Slash command doesn't appear in Discord:**
- Global commands take up to an hour. Use guild-scoped for testing.
- Bot needs `applications.commands` scope in the OAuth URL.

**Bot says "interaction failed":**
- Worker timed out (>3s for initial response). Check `wrangler tail` for errors in the deferred path.
- `commitCapture` threw an unhandled error. Check the followup logic in `inbound/router.ts`.

**Bot replies but says `✗ ignored: unauthorized user`:**
- Your Discord user ID isn't in `INBOUND_ALLOWED_USERS`. Re-check step 3 and re-push.

## Why Discord uses a slash command instead of plain messages

Discord bots that read every message in a channel need the **Message Content Intent**, which Meta-style requires verification once your bot is in 100+ servers. For personal use it's fine, but plain-message bots also have to deal with rate limits, threading, edits, deletions — operationally noisier than slash commands.

Slash commands give you:
- Explicit invocation (no accidental captures)
- Free argument parsing
- Auto-complete UI
- Discord's native ratelimit handling

Trade-off: you type `/capture text:` instead of just typing. Acceptable for a personal capture surface.

## Rotating tokens

If the bot token leaks:
1. Developer portal → Bot → **Reset Token**
2. `wrangler secret put DISCORD_BOT_TOKEN`

The public key never needs rotation unless you replace the entire application.
