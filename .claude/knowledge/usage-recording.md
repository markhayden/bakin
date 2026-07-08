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

## Per-agent supervision queries (#385)

The agent-health surfaces added read-only rollups over the EXISTING stores —
no fourth tracking system:

- Ledger (`run_costs`/`runs`/`completions`): `runTokensByAgentSince`
  (NULL-honest token/cost sums), `listRunsByAgent` (runs LEFT JOIN run_costs —
  the timeline run spine), `listLiveRuns` (status='running' snapshot behind
  `GET /api/plugins/health/live-now`), `completionsByAgentSince`.
- usage.db: `usageByAgentDaySince` — the (agent × day) cross-tab, exposed as
  `byAgentDay` on `GET /usage-history` (stacked chart) and joined day-aligned
  against run_costs by `src/core/agent-burn.ts` to compute UNATTRIBUTED usage
  (transcript-observed minus Bakin-metered — the "activity outside
  Bakin-managed tasks" signal on `GET /agent-effort` and the
  `usage.agent-burn` doctor check).

The two token stores intentionally differ in coverage (run_costs = Bakin
dispatches only; usage.db = everything in transcripts); the delta is a
feature, not a reconciliation bug. Deep dive:
`.claude/knowledge/agent-health-diagnostics.md`.

## Budget gating consumes usage.db (cost-control v2)

The delta stopped being observability-only: the spend engine
(`src/core/budget-spend.ts` — `assembleBudgetSpend`, the ONE engine behind
the dispatch gate, the billed-media gate, the budget health check,
`/spend`, `/budget/status`, and the CLI) adds the observed-minus-attributed
delta per (agent, local day, billing lane) to the caps — total-observed
basis: a runaway agent loop OUTSIDE Bakin-managed tasks still trips the
budget. `usageByAgentModelDaySince` (the agent×day×model cross-tab) is its
read verb; the model column resolves to a provider/lane via
`models.resolveBilling`. Honesty rules: dollars only where the runtime
reported cost (NULL contributes tokens, never $); usage.db lags its scan
interval (~5 min); subscription-lane deltas count tokens, never dollars
(unit-per-lane). Clamped ≥ 0 per agent/day/lane — never netted across
agents.
