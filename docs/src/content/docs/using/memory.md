---
title: Memory
description: "One search across every conversation, decision, and durable thing your agents remember. Read-only window into the agent's past."
---

Your window into everything an agent knows or should know. Sessions, daily notes, soul / rules / skills, dreams, checkpoints. All indexed, hybrid scored, ranked. You and your agents both reach for it when you need to know what was decided, where a rule came from, or why an agent is acting weird today.

The runtime owns the data, this just shows you what's there.

<figure class="screenshot-frame">
  <figcaption>The memory dashboard: tier overview cards on top, search and filters in the middle, a recent feed (or your search hits) below.</figcaption>
</figure>

## Search

Type a query, get ranked hits across every tier in one list. Hybrid scoring (keyword + semantic) so "launch plan" finds the document titled exactly that AND the session where you talked about going to market. Click any row for the full content in a side drawer.

<figure class="screenshot-frame">
  <figcaption>Search across every tier in one ranked list, with the agent strip and tier chips above the results.</figcaption>
</figure>

Three filters narrow the result set:

- **Agent**: avatar strip on the left. Click an avatar to scope to one agent.
- **Tier**: multi-select chips. Pick `sessions` + `daily_note` to focus on conversational history, `durable` for the canonical layer, etc.
- **Kind** (under `durable` only): slice the durable layer further into `soul`, `rules`, `skills`, `tools`, `identity`, `memory-log`, `dreams`, `user`, `bootstrap`.

What it's good at:

- *"What did we decide about the brand voice?"* → durable + sessions + daily notes, scoped to the agent that owns it.
- *"Why is Roscoe acting weird today?"* → clear the search, agent filter set to `Roscoe`, scan the recent feed.
- *"Where did this rule come from?"* → tier `durable`, kind `rules`, search the keyword.

When the search bar is empty, the page shows a recent feed across the same filters so you can browse without a query. Overview cards up top give live row counts per tier.

## What's in there

<div class="table-light-full table-label">

| Tier | What it holds |
| --- | --- |
| **Sessions** | Chat threads, by agent. Token counts, model, status, and the back-link to the conversation itself. |
| **Daily Notes** | End-of-day summaries an agent writes for itself. Quick way to scan what's been on their mind without scrolling through every session. |
| **Durable** | Long-term knowledge. Soul, identity, rules, tools, skills, MEMORY-LOG, the stuff that defines who the agent is. Filter by `Kind` to zoom in on just the soul, just the skills, just the rules. |
| **Dreams** | Background reflection an agent does between active work. Phase docs, signals, the agent's own theories about what's going on. |
| **Checkpoints** | Compaction snapshots. When a session gets too big, the agent compresses it into a checkpoint and starts fresh. The checkpoint is what carries forward. |
| **Turns** *(System Logs)* | Every individual message inside a session. |
| **Audit** *(System Logs)* | Every Bakin event in the system. |

</div>

Turns and Audit are noisy by default. Flip the `System Logs` toggle in the page header to bring them into the dashboard.

## Settings

<!-- docs:settings memory -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Backfill window (days) | `number` | `30` | On first activation, index this many days of history across all tiers. |
| Skip sessions over (bytes) | `number` | `10 * 1024 * 1024` | Transcripts larger than this are skipped to keep the indexer responsive. |
| Skip .reset backup transcripts | `boolean` | `true` | Historical reset backups are not live state; skip by default. |
| Compare against runtime recall | `boolean` | `true` | Show runtime daily-note recall alongside Bakin search results. |
| Turn retention (days) | `number` | `7` | Turns older than this are dropped at write time and pruned daily. The runtime still owns the source transcript. |
| Audit retention (days) | `number` | `30` | Audit rows older than this are dropped at write time and pruned daily. |

</div>
<!-- /docs:settings -->

Defaults are sensible. Most folks will never touch this.

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#plugin-memory).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents query memory through MCP exec tools.

<!-- docs:exec-tools memory -->
- `bakin_exec_memory_get_session`: Fetch a session by key plus its most recent turns.
- `bakin_exec_memory_get_turn`: Fetch a single turn by id (the `turn:<hex>` form).
- `bakin_exec_memory_list_agents`: Agents with memory rows, each with total count and per-tier breakdown.
- `bakin_exec_memory_search`: Hybrid search across every memory tier (sessions, turns, checkpoints, daily notes, dreams, durable, audit). Optional tier/agent filters.
- `bakin_exec_memory_status`: Indexer health: per-tier row counts, offset tracking, snapshot timestamp.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Essentials](/docs/using/essentials/#search): cross-table search includes memory automatically
- [Team](/docs/using/team/): the agents whose memory tiers Memory indexes
- [Activity Feed](/docs/using/essentials/#activity-feed): live event stream that audit memory replays after the fact
