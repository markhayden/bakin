---
title: Memory
description: "Read-only dashboard over every memory tier in OpenClaw plus Bakin's audit log. One unified search across all of it."
---

Memory is where you go when you need to know what agents knew, what happened, and where context came from. It indexes seven tiers of OpenClaw's memory plus Bakin's audit log into a single searchable surface. Read-only — Memory never writes to OpenClaw or anywhere else. It just shows you what's there.

## The memory dashboard

<figure class="screenshot-frame">
  <figcaption>Memory dashboard with tier overview cards on top, search and facets in the middle, results below.</figcaption>
</figure>

Top: tier-overview cards with live row counts so you can see how much of each kind exists. Middle: a unified search bar plus tier and agent facets. Bottom: results — a recent feed when no query, unified search hits when there is one. Click any row to open the detail drawer with the full content.

## The seven tiers

| Tier | What it holds |
| --- | --- |
| **Sessions** | Long-form chat sessions between agents and you |
| **Checkpoints** | Snapshots agents take to preserve context across sessions |
| **Daily notes** | Per-day summaries written by agents |
| **Durable** | Long-term knowledge agents have decided to keep |
| **Dreams** | Background reflection agents do between active work |
| **Turns** | Individual agent turns (debug-only) |
| **Audit** | Bakin's own audit log of every system event (debug-only) |

Turns and audit are noisy — they're hidden by default and surface when you flip on `?debug=1`.

## Common actions

### Search across everything

Type a query, get hits from every tier in one ranked list. Semantic + BM25, just like the rest of Bakin's search. Filter the result set with tier and agent facets.

### Browse by tier

Click a tier card to scope results to just that tier. Useful when you remember the *kind* of memory but not the agent.

### Inspect a row

Open the detail drawer for any result to see the full content, source path, agent, and timestamp.

## Concepts

- **Bakin reads, OpenClaw owns.** Memory is a read-only adapter. Sessions, checkpoints, and dreams all live under `~/.openclaw/`. Daily notes and durable memory live in OpenClaw's workspace. Memory indexes them and gets out of the way.
- **One table, one search, seven tiers.** Everything goes into `bakin_memory` with a `tier` facet. A single query reaches across all seven plus audit. There's no separate audit search.
- **Incremental indexing.** Memory tracks per-tier byte offsets at `~/.bakin/plugin-settings/memory/offsets.json` and only indexes what changed since last sync. Stable SHA256 row IDs keep upserts idempotent.

## Where state lives

```
~/.openclaw/                                    # everything Memory indexes (read-only)
  agents/<id>/sessions/*.jsonl
  workspace/*.md
  ...
~/.bakin/audit.jsonl                            # Bakin's audit log (also indexed)
~/.bakin/plugin-settings/memory/offsets.json    # what Memory owns (sync state only)
```

Memory writes nothing else.

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents query memory through MCP exec tools.

<!-- docs:exec-tools memory -->
- `bakin_exec_memory_get_session`: Fetch a session by key plus its most recent turns.
- `bakin_exec_memory_get_turn`: Fetch a single turn by id (the
- `bakin_exec_memory_list_agents`: Agents with memory rows, each with total count and per-tier breakdown.
- `bakin_exec_memory_search`: Hybrid search across every memory tier (sessions, turns, checkpoints, daily notes, dreams, durable, audit). Optional tier/agent filters.
- `bakin_exec_memory_status`: Indexer health: per-tier row counts, offset tracking, snapshot timestamp.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Essentials](/docs/using/essentials/#search): cross-table search includes memory automatically
- [Team](/docs/using/team/): agents whose memory tiers Memory indexes
- [Activity Feed](/docs/using/essentials/#activity-feed): live event stream that audit memory replays after the fact
