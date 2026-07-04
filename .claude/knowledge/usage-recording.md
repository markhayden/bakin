# Usage Recording — Deep Reference

All MCP tool calls, REST requests, and agent lifecycle events flow through **one** in-memory recorder in `src/core/usage.ts`. The previous fragmentation (`request-log.ts` + `toolStats` in registry.ts) caused the health dashboard to show zeros while real traffic was flowing — that incident is the reason this is a single source of truth.

**Never add a parallel stat-tracking system.** The health plugin's `/usage-feed` route and the tabbed Usage section on the health page are the only consumers you should add to.

## Writing

```ts
recordUsage({ kind, name, agent, durationMs, status, meta, tokensIn?, tokensOut?, tokensCacheRead?, tokensCacheWrite?, costUsdMicros? })
```

| Field | Values |
|---|---|
| `kind` | `'mcp' \| 'rest' \| 'agent'` |
| `name` | tool name / route path / event name |
| `agent` | optional agent id |
| `durationMs` | numeric |
| `status` | `'ok' \| 'error'` |
| `tokensIn` / `tokensOut` | per-turn token counts (completed agent turns; #464) |
| `tokensCacheRead` / `tokensCacheWrite` | provider-cache slices of the input when the runtime reported them (#357); absent = not reported, never zeroed |
| `costUsdMicros` | estimated turn cost in micro-dollars; omitted when unmetered |
| `meta` | free-form record for extra context |

The token/cost fields are the **live** half of cost metering (the durable half is the ledger `run_costs` table — see `.claude/knowledge/execution-ledger.md`). Dispatch's settle path emits a `kind:'agent', name:'turn'` entry carrying them. This stays the single live stat feed — **never** add a parallel cost tracker.

The ring buffer holds 10 000 entries, FIFO-evicted.

## Runtime session usage

Health's context and cost cards do **not** come from the in-memory usage recorder above. They are derived from runtime session JSONL entries via `src/core/agent-usage.ts`, then served by `plugins/health` at `/usage`.

- Token fields (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`) are summed from assistant messages in each agent's latest session.
- Cost fields are runtime-reported only. Bakin does not map model ids to pricing tables for Health.
- Missing runtime cost is represented as unavailable, not `$0.00`.
- The "Latest Session Context" card is **latest-session scoped** (context pressure). Multi-session history is the separate pipeline below.

## Usage history (multi-session, durable — #359)

Historical token usage lives in its own named SQLite store `~/.bakin/usage.db` (via `openNamedDb`, like the search outbox — **never** the coordination ledger) and is populated by scanning the same session JSONL source the latest-session card reads. One parser feeds both surfaces (`parseSessionUsageMessages` in `src/core/agent-usage.ts`) so they cannot drift.

Pipeline: health plugin interval timer (`usageHistoryScanMinutes` setting, default 5; armed in `activate`, first sweep one interval after boot, stopped in `onShutdown`) → `scanUsageHistory(runtime)` in `src/core/usage-history.ts` → `runtime.memory.statEntry` mtime+size skip → changed sessions recomputed into per-`(session_id, day, model)` rows → `replaceSessionUsage` in `packages/core/src/usage-history/store.ts`.

Invariants:
- **Absolute replace, never accumulate.** A rescan deletes the session's rows and inserts the fresh recompute in one transaction — retries, rescans, and rewritten/compacted transcripts structurally cannot double-count. There is no other write path.
- **Day attribution is per message** (local calendar day of the message's own timestamp; session start as fallback), so long-lived main sessions don't dump weeks of tokens on one day.
- **History outlives its source.** Deleting/rotating a session file just stops updates; ingested rows are permanent (no tombstones, no retention cap).
- **Cost is runtime-reported only and NULL-honest** — stored as micro-dollar sums with `costed_messages`/`message_count` coverage counts; a group with no reported cost sums to `null`, never `$0`. Bakin never prices these rows.
- Serving: `GET /api/plugins/health/usage-history?window=24h|7d|30d` — windows are **day-aligned** (every local calendar day the window touches). The Usage History section on the health page renders it (URL param `uw`).

## Reading

| API | Use |
|---|---|
| `getUsageFeed({ kind?, window, agent? })` | Top-N / by-agent / recent aggregation |
| `getStatsByMs({ kind?, windowMs, agent? })` | Total + error counts (used by watchdog) |
| `getErrorCount(windowMs)` | Errors tile on `/summary` |

Windows: `'5m' | '1h' | '24h'`.

## Auto-recording sites

- **MCP** — `src/core/mcp-server.ts:registerTools` records every tool call.
- **REST** — `trackResponse` middleware in `src/core/rest-tracking.ts` records every response.
- **Agent** — dispatch / heartbeat / lifecycle modules emit `kind: 'agent'` entries.

Manual `recordUsage` calls are only needed for new flows that aren't covered by the three auto-recorders above.

## Startup Diagnostics and Remote Metrics Boundary

Plugin startup diagnostics are not usage recording. They are opt-in local
structured logs emitted through `src/core/startup-diagnostics.ts` when
`diagnostics.startup.enabled` is set, `BAKIN_STARTUP_DIAGNOSTICS=1` is present,
or debug/verbose logging is explicitly requested. Browser diagnostics remain
explicitly enabled through dev mode, localStorage, or a query flag. Diagnostic
records should remain timing/status records only: span name, phase, duration,
status, counts, plugin id/source where needed, and sanitized error messages.

Remote or ecosystem metrics are not implemented. If added later, they must be a
separate explicit opt-in setting, disabled by default, and fed from sanitized
aggregate snapshots of this recorder or a dedicated metrics aggregator. Do not
send task content, prompts, model responses, file paths, plugin settings,
secrets, raw stack traces, raw plugin errors, agent identities, or arbitrary
plugin-returned data.

The local recorder in this file remains the single source of truth for Health's
usage view. Do not introduce a parallel hidden tracking path for remote metrics.
