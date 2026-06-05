# Memory architecture

personal-brain-mcp uses a four-layer model. Each layer has different update
frequency, query patterns, and cost.

```
LAYER 1 — IDENTITY
  brain.identity (single row)
  Who I am. Voice rules. Core values. Rarely changes.
  Always include in context.

LAYER 2 — STATE
  No dedicated table — composite tool get_current_state().
  What's true right now. Computed from many tables.
  Cheap to call repeatedly.

LAYER 3 — EPISODIC
  brain.memory (append-only, vector-searchable)
  What happened and when. Journal, decisions, gratitudes.
  The big table. Grows ~daily.

LAYER 4 — SEMANTIC
  brain.facts (subject-predicate-object, vector-searchable)
  What I know that's true generally.
  Smaller. Curated. Used for personalization.
```

## Why split memory and facts?

Episodic memory ("on 2025-03-14 I journaled that Mike said he's lactose intolerant")
is fundamentally different from semantic fact ("Mike is lactose intolerant").

Episodic is time-ordered, append-only, may be wrong in hindsight, can be
overwhelming when retrieved unfiltered.

Semantic is subject-indexed, curated, replaceable, queryable by *concept*.
When you ask "what should I cook for dinner if Mike is coming?", you want
semantic — not 17 journal entries that happen to mention Mike.

## How facts are added

Three ways:

1. **Direct add** — `facts(action="add", fact={...})`. For things you state explicitly.
2. **Promote from memory** — `facts(action="promote_from_memory", memory_id, fact={...})`. When you realize a journal entry contains a durable fact, link them.
3. **Backfill (one-time at v0.3 deploy)** — migration 0003 auto-promoted all `memory` rows with `type='fact'` into the facts table and archived the originals.

## How facts are updated and forgotten

Facts are **append-immutable with supersession**:

- `facts(action="update")` inserts a new fact row and marks the old one `active=false` with `superseded_by` pointing to the new id. You keep history.
- `facts(action="forget", reason="...")` marks a fact `active=false` with the reason in `context`. Not deleted.

This matters because facts evolve (Mike got over the lactose thing, but you want to know that's what changed and when).

## Recommended agent access pattern

```
On every interaction:
  1. identity(action="get")          # Always. Tiny.
  2. (if open-ended) get_current_state()
  3. (if topical) facts(action="search", query=...)
                  OR ask_brain(query=...)
  4. (if "do you remember...") search_memory(query=...)
                                OR recall_conversation(...)

On any factual claim about you → check facts first.
```

## Memory consolidation (future)

`brain.weekly_summaries` table exists for this. A future cron tool should:

1. Once a week, summarize the last 7 days of `brain.memory` into a single
   compressed row in `weekly_summaries` with its own embedding.
2. Optionally archive (not delete) the source rows after ~90 days, leaving
   the summary as the searchable replacement.

This keeps vector-search relevance high as memory grows past ~50k rows.

Not implemented in v0.3 — the schema is ready, the cron is your call.

## What goes where — quick reference

| You want to know... | Tool | Layer |
|---|---|---|
| Is you allergic to amoxicillin? | `facts` | 4 |
| What's your blood type? | `identity` | 1 |
| What did you decide about the kitchen reno? | `search_memory` | 3 |
| What's on your plate right now? | `get_current_state` | 2 |
| What did you and Tim talk about last? | `recall_conversation` | 3 |
| Has you been to Lisbon before? | `trip_history` or `ask_brain` | — |
