# iPhone Shortcuts for personal-brain-mcp

Five Shortcuts that turn your phone into a write-side input device for the brain.
None of these read data — they only write. They use the `INGEST_BEARER_TOKEN` (NOT the MCP bearer).

| Shortcut | Trigger | Endpoint | Use case |
|---|---|---|---|
| **Brain · Daily Vitals** | Automation, daily 8am | `POST /ingest/health` | Push weight, sleep hours, steps, resting HR, HRV from HealthKit |
| **Brain · Capture** | Home Screen / "Hey Siri, capture …" | `POST /ingest/capture` | One-line free-text dump → routes to shopping / journal / wishlist / reading |
| **Brain · Log Expense** | "Hey Siri, log expense" | `POST /ingest/expense` | Voice prompt → amount + category + vendor |
| **Brain · Save to Queue** | Share Sheet (Safari, YouTube, Podcasts) | `POST /ingest/content` | Save URL to reading_list or content_queue |
| **Brain · Voice Journal** | "Hey Siri, journal" | `POST /ingest/capture` | Dictation → journal entry |

Endpoint: `https://<your-worker>.workers.dev`. Auth: `Authorization: Bearer <INGEST_BEARER_TOKEN>`.

---

## 1. Brain · Daily Vitals

**Trigger:** Personal Automation → Time of Day → 8:00 AM daily.

**Actions:**

1. **Find Health Samples** → Weight (last 1 day, most recent) → set var `wt`
2. **Find Health Samples** → Sleep (last 1 day, total hours) → set var `slp`
3. **Find Health Samples** → Resting Heart Rate (last 1 day, average) → set var `rhr`
4. **Find Health Samples** → Steps (last 1 day, total) → set var `steps`
5. **Find Health Samples** → HRV SDNN (last 1 day, average) → set var `hrv`
6. **Text** action with this body (use Magic Variables for values):
   ```json
   {
     "source": "apple_health",
     "samples": [
       {"metric":"weight_lb","value": [wt]},
       {"metric":"sleep_hours","value": [slp]},
       {"metric":"resting_hr","value": [rhr]},
       {"metric":"steps","value": [steps]},
       {"metric":"hrv_ms","value": [hrv]}
     ]
   }
   ```
7. **Get Contents of URL**
   - URL: `https://<your-worker>.workers.dev/ingest/health`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <INGEST_BEARER_TOKEN>`
     - `Content-Type: application/json`
   - Request Body: **File** → use the Text from step 6

Omit any sample whose Health Sample lookup returned empty — Shortcuts skips empty Magic Variables and you'll get a JSON parse error if you don't guard. The cleanest way: wrap each Find Health Samples in an `If` (count > 0) and only append matching entries to a final Dictionary action.

**Test from iOS:** Shortcuts → run it manually. Response should be `{"ok":true,"inserted":N}`.

---

## 2. Brain · Capture

**Trigger:** Home Screen icon AND "Hey Siri, capture" (rename shortcut to "capture").

**Actions:**

1. **Ask for Input** → Text → "What to capture?"
2. **Get Contents of URL**
   - URL: `https://<your-worker>.workers.dev/ingest/capture`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <INGEST_BEARER_TOKEN>`
     - `Content-Type: application/json`
   - JSON body:
     ```json
     { "text": "[Provided Input]" }
     ```
3. **Get Dictionary Value** → key `routed_to` from response
4. **Show Notification** → "Captured → [routed_to]"

That's it. "Buy more coffee filters" goes to shopping. "I want the Sony WH-1000XM6" goes to wishlist. URLs go to reading/content. Everything else becomes a journal entry.

---

## 3. Brain · Log Expense

**Trigger:** "Hey Siri, log expense"

**Actions:**

1. **Ask for Input** → Number → "Amount in dollars"
2. **Choose from List** → categories: grocery / utility / house_project / maintenance / auto / subscription / other → set var `cat`
3. **Ask for Input** → Text → "Vendor?" → set var `vendor`
4. **Get Contents of URL**
   - URL: `.../ingest/expense`
   - Method: `POST`
   - Headers: bearer + JSON
   - JSON body:
     ```json
     { "amount": [Provided Input], "category": "[cat]", "vendor": "[vendor]" }
     ```
5. **Show Result** → response

---

## 4. Brain · Save to Queue

**Trigger:** Share Sheet (set "Accept: URLs" in Shortcut settings).

**Actions:**

1. **Get Item from Shortcut Input** → URL → var `url`
2. **Get Name** → from `[url]` (Safari page title via "Get Name" or use URL host as fallback)
3. **Get Contents of URL**
   - URL: `.../ingest/content`
   - Method: `POST`
   - Headers: bearer + JSON
   - JSON body:
     ```json
     { "url": "[url]", "title": "[title]" }
     ```
4. **Show Notification** → "Saved → [kind]"

Use it from Safari, YouTube, Podcasts, anywhere with a share sheet.

---

## 5. Brain · Voice Journal

**Trigger:** "Hey Siri, journal"

**Actions:**

1. **Dictate Text** → Stop on Tap → var `dict`
2. **Get Contents of URL**
   - URL: `.../ingest/capture`
   - Method: `POST`
   - Headers: bearer + JSON
   - JSON body:
     ```json
     { "text": "[dict]", "embed": true }
     ```

`embed: true` here costs ~300ms but makes the entry immediately searchable. Worth it for journal entries because you'll search them later.

---

## Storing the bearer token securely

Don't paste the token into the shortcut as plain text where you can see it — anyone glancing at your screen can read it.

**Best practice:**

1. Create a "Setup" shortcut that runs once. It contains the token literal.
2. Save the token to your **Keychain** via the `Set Variable` → `Add to Keychain` action (iOS 17+ via Data Jar app, or use Notes with Lock).
3. Each ingest shortcut retrieves the token via Keychain lookup, not literal.

Alternative for simpler setup: paste into each shortcut. Acceptable for personal use — the shortcut data lives encrypted in iCloud.

## Rotating the token

When you rotate `INGEST_BEARER_TOKEN`:
1. `wrangler secret put INGEST_BEARER_TOKEN`
2. Update each shortcut's bearer string.
3. The MCP bearer is independent — don't need to rotate it at the same time.
