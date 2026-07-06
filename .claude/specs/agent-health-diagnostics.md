# SPEC — Agent Health Diagnostics (#385)

Status: DRAFT — awaiting approval
Date: 2026-07-05
Owner: roscoe (single-user instance; no backwards-compatibility requirements)
Issue: https://github.com/markhayden/bakin/issues/385

## 1. Objective

Give a single, possibly non-expert user confidence that the runtime is never
"running unsupervised under the hood." One glance at the Health dashboard
answers: **what is running right now, what did it cost, was the effort worth
it, and which agents need attention.** One click into an agent answers:
**has this agent's definition drifted from its sources, how much context does
a fresh session load, and what has it actually been doing.**

Everything is teachable: charts carry plain-language "what am I looking at /
when should I worry" explainers, and every automated flag is a doctor check
whose message names the agent, the numbers, and what to do next.

### Non-goals (this issue)

- Health dashboard grouping/reorganization (explicit follow-up issue — here we
  add/update cards without restructuring the page).
- Bypass-rate statistics and lesson-effectiveness scoring (surface as timeline
  events only; dedicated analytics deferred).
- **Full per-run reconciliation** of the token stores (matching transcript
  sessions to ledger runs). Out of scope — but the per-agent **coverage
  delta** between transcript-observed usage (usage.db) and Bakin-metered
  usage (run_costs) IS in scope as a supervision signal (D11). Each surface
  still sources consistently and labels estimates honestly (see §6).
- Turn-level (per-tool-call) timeline detail — the memory plugin's turn tier
  already serves that as a drill-down.

## 2. Decisions (locked during kickoff interview)

| # | Decision |
|---|----------|
| D1 | **Both surfaces, split by altitude.** Health dashboard = fleet-wide supervision; Team agent-detail = per-agent diagnostics. Each links to the other. |
| D2 | **Doctor checks + UI explainers** are the alert platform. No second insights engine. Detection logic lives in plugin-registered health checks; charts render the same signals with explainer copy. |
| D3 | **Burn heuristic = effort-vs-outcome + spike.** (a) tokens per completed task over a window — flag heavy burn (above a floor) with zero/near-zero completions; (b) today's burn vs the agent's own trailing 7-day average (>Nx). Settings-configurable, plain-language messages. |
| D4 | **Fleet dashboard additions (all four):** Live-now panel, per-agent stacked daily token chart, effort-vs-outcome card, attention rollup. |
| D5 | **Agent detail:** one new **Diagnostics** tab (drift + context budget + timeline) plus status chips on Overview (drift / context / burn) deep-linking into the tab. |
| D6 | **Timeline = run spine + audit interleave.** Primary rows are dispatch runs (task, model, duration, tokens, cost, outcome incl. plain-language session-death summary); notable audit events interleave; rows expand to that task's progress-log lines. |
| D7 | **Drift freshness:** live single-agent scan on Diagnostics-tab open (new endpoint over `scanAgentSync` filtered to one agent) with a Sync-now action; fleet badges/rollup read the cached `team.agent-sync` doctor result. Finally wires up the dead `'drifted'` package state. |
| D8 | **CLI:** `bakin agents doctor <id>` — thin aggregator over the same per-agent endpoints, Ink report, no new logic. |
| D9 | **Charts stay hand-rolled.** Small shared chart kit in `@makinbakin/sdk/components` (stacked columns + legend + tooltip, sparkline). No chart library dependency. |
| D10 | **Bypass + lessons = timeline events only** (`task.bypass_detected` ⚠, `agent_pkg.lessons_retrieved` ℹ). |
| D11 | **Token-store delta is a feature, not noise.** Per agent per window: "total observed" (usage.db — everything in transcripts) vs "Bakin-attributed" (run_costs — metered dispatches); the difference = activity outside Bakin-managed tasks. Effort card shows both columns + unattributed; a large unattributed share is a third burn-flag kind. This is the direct "is the runtime doing things unsupervised" signal. Full per-run reconciliation stays out of scope. |

## 3. Current-state facts the design builds on

- **Context budget engine is done, UI-less.** `src/core/context-report.ts`
  (per-agent static sections, dynamic caps, workspace file sizes incl.
  managed-block bytes, observed runs) + `GET /api/context-report[/{id}]` +
  `bakin agents context` + warn-only `context.startup-size` doctor check.
  Nothing in the web UI consumes it.
- **Drift scanner is done, barely surfaced.** `scanAgentSync()`
  (`src/core/agent-packages/sync-scanner.ts`) yields per-agent/per-file/
  per-input findings; receipts persist at `~/.bakin/packages/receipts/<id>.json`
  with `GET /api/agent-packages/{id}/receipt` that **no component consumes**;
  the `'drifted'` badge state exists in `plugins/team/types.ts` but is never
  assigned — agents show "managed" while stale.
- **Token data is rich, cross-tabs discarded.** `usage.db`
  (`session_usage_days`) stores per-(session, day, model, agent) rows but the
  `/usage-history` API collapses to byAgent OR byDay; the ledger `run_costs`
  has per-run tokens/cost/model with `recentRunsByAgent()` already built.
- **Timeline raw material exists, unjoined.** `runs` table (per-dispatch
  attempt: status, heartbeat, settleReason), `run_costs` (tokens/cost),
  `audit.jsonl` (agent is a first-class field; `queryAuditEvents` lacks an
  agent filter), task `log[]`, and `RuntimeTurnDiagnosis` JSON embedded in
  `task.runtime_session_died` audit data.
- **All existing charts are hand-rolled divs**; `HorizontalBars` and
  `DailyTotalsChart` are the primitives; per-section `usePolledJson` @10s.
- **Doctor is the alert platform**: plugin-registered checks, cron + cache,
  `/summary` feeds the dashboard + nav badge, repair/notify flows exist.

## 4. Deliverables

### 4.1 Data layer (queries only — no new storage, no new tracking system)

- `usageByAgentDaySince(sinceDay)` in `packages/core/src/usage-history/store.ts`
  → `{ agent, day, tokens{...}, costUsdMicros, ... }[]` (the existing
  `by_agent(agent, day)` index supports it).
- `listRunsByAgent(agent, { sinceMs, limit })` in
  `packages/core/src/execution/ledger.ts` — runs LEFT JOIN run_costs by
  `run_id` → run spine rows (status, startedAt, settledAt, settleReason,
  heartbeatAt, taskId, model, tokens, cost).
- `listActiveRuns()` (status='running' across agents, with heartbeat age) —
  reuse/extend whatever the watchdog already queries; verify in plan.
- `completionsByAgentSince(sinceMs)` — completions count per agent for the
  effort-vs-outcome join.
- `queryAuditEvents` gains an optional `agent` filter
  (`src/core/audit.ts`).

### 4.2 Burn evaluation (`src/core/agent-burn.ts`)

Pure, testable evaluator consumed by BOTH the doctor check and the effort
endpoint (same anti-drift pattern as `context-report.ts`/`budget.ts`):

- Inputs: window rollups from `run_costs` + completions + `usage.db` daily
  history (both attributed and total-observed). Outputs per agent:
  `{ agent, windowTokens, windowCostUsdMicros, runs, completions,
  tokensPerCompletion|null, totalObservedTokens|null, unattributedTokens|null,
  flags: BurnFlag[] }` where
  `BurnFlag = { kind: 'effort-no-outcome' | 'spike' | 'unattributed', message, numbers }`.
- **Delta join (D11):** day-aligned windows (usage.db is day-granular local
  days) joining `usageByAgentDaySince` totals against run_costs sums over the
  same days; `unattributedTokens = max(0, totalObserved - attributed)`,
  null-honest when the scanner hasn't covered the window yet (surface
  `scannedAt`, never fabricate). The `unattributed` flag fires above a
  configurable share + floor (e.g. >50% of observed AND >100k tokens).
- Settings (new block in `~/.bakin/settings.json`, editable via System &
  Alerts): `burn: { windowHours: 24, minTokensFloor: 500_000,
  spikeMultiplier: 3, baselineDays: 7, unattributedShare: 0.5,
  unattributedFloorTokens: 100_000 }` (exact placement/names finalized in
  plan; re-read each doctor cycle like watchdog settings).
- New doctor check `usage.agent-burn` in
  `plugins/health/lib/system-checks/agent-burn.ts` — **warn-only** (cost
  concern, not correctness), message pattern:
  `"'pixel' used 2.1M tokens across 14 runs in 24h but completed 1 task — check its timeline"`.

### 4.3 API

- Health plugin (`/api/plugins/health`):
  - `GET /live-now` → active runs: `{ agent, taskId, taskTitle, model?,
    startedAt, runningForMs, heartbeatAgeMs }[]`.
  - `GET /usage-history` response gains `byAgentDay` (drives the stacked
    chart; existing fields unchanged).
  - `GET /agent-effort?window=24h|7d|30d` → burn evaluator output per agent
    incl. total-observed / attributed / unattributed columns (drives the
    effort card AND the Overview burn chip).
- Team plugin (`/api/plugins/team`):
  - `GET /:agentId/timeline?window=24h|7d` → joined run-spine + interleaved
    audit events + expandable log lines (assembled server-side from ledger +
    `queryAuditEvents({agent})` + task store; session-death diagnoses
    summarized to plain language server-side).
- Host API (`packages/host/src/api/agent-packages/`):
  - `GET /api/agent-packages/{agentId}/scan` → live single-agent
    `SyncFinding[]` (scanner filtered to one agent; read-only, no fetch).
  - `GET /api/agent-packages` list derives `drifted` state for badges from
    the cached doctor result (no live fleet scan).
- Attention rollup consumes existing `/summary` doctor cache client-side
  (filter to `team.agent-sync`, `context.startup-size`, `usage.agent-burn`
  results); only add an endpoint if the cached results turn out not to carry
  per-agent granularity — verify in plan.

### 4.4 UI — Health dashboard (`plugins/health/`)

Section order stays; new cards slot in without restructuring (reorg is the
follow-up issue):

1. **LiveNowSection** (new, directly under SummaryCards): table of in-flight
   runs with running-for + heartbeat-age; stale heartbeat highlighted; honest
   empty state: "Nothing is running right now."
2. **AttentionSection** (new, beside/under Live-now): per-agent chips —
   drift / context-over-budget / burn — from cached doctor results, each
   deep-linking to that agent's Diagnostics tab. Empty state: "All agents
   look healthy."
3. **UsageHistorySection**: `DailyTotalsChart` upgraded to per-agent
   **stacked columns** with legend + hover breakdown (falls back to
   single-series when only one agent).
4. **EffortSection** (new): per-agent effort-vs-outcome table/bars — runs,
   completions, Bakin-attributed tokens, total observed tokens, unattributed
   tokens (⚠ when flagged), tokens-per-completion — with inline burn flags
   and window toggle. The two token columns make the store difference
   self-explanatory instead of contradictory.
5. Every new/updated card gets a one-line explainer footer ("High tokens with
   few completions can mean an agent is spinning — open its timeline.").

### 4.5 UI — Team agent detail (`plugins/team/`)

- **Diagnostics tab** (new), three stacked panels:
  - **Drift**: live scan findings grouped by file/target with per-input
    attribution (`staleInputs`), `.userEdited` locks with reclaim hint,
    last receipt summary (blocks recomposed, verification status), and a
    **Sync now** button reusing the existing sync POST + receipt toast.
  - **Context budget**: budget meter (estimatedMaxTaskBytes vs
    `dispatch.contextBudgetBytes`), top static sections, dynamic caps,
    workspace file table (with managed-block bytes), recent observed-run
    input tokens (sparkline). Pure render of `GET /api/context-report/{id}`.
  - **Activity timeline**: D6 shape, window toggle (URL-backed), live-run row
    pinned on top when the agent is currently running.
- **Overview tab**: three status chips (Drift / Context / Burn — ok or
  flagged from cached doctor + `/agent-effort`) linking into Diagnostics.
- Package state badge finally shows `drifted` (from doctor cache).

### 4.6 Shared chart kit (`packages/sdk` → `@makinbakin/sdk/components`)

Hand-written, minimal, theme-aware: `StackedColumnChart` (stacked columns,
legend, hover tooltip), `Sparkline`, and a small `ChartExplainer` footer
primitive. Health keeps `HorizontalBars` local until the cleanup issue.

### 4.7 CLI

`bakin agents doctor <id>` (`src/cli/commands/agents.ts` + Ink report in
`src/core/cli/ui/reports/`): fetches scan + context-report + timeline +
effort for the agent, renders one combined report; `--json` supported. Pure
API client — zero new server logic.

### 4.8 Docs

- New `.claude/knowledge/agent-health-diagnostics.md` (surfaces, endpoints,
  burn heuristic, data sources, extension points).
- Update: `.claude/knowledge/usage-recording.md` (new queries/endpoints),
  `doctor-and-health-checks.md` (new check), `layered-context.md` (drift
  surfacing), `startup-context.md` (web UI consumer). CLAUDE.md Key Patterns
  pointer. README/docs-site only if command surface docs mention agent
  commands (verify during build).

## 5. Project structure, commands, code style

- **Structure:** follows existing homes exactly — store queries in
  `packages/core/src/{usage-history,execution}/`, evaluator in `src/core/`,
  checks in `plugins/health/lib/system-checks/`, routes in plugin
  `index.ts`/`lib/routes/`, components in `plugins/{health,team}/components/`,
  shared charts in `packages/sdk/src/components/`, CLI in
  `src/cli/commands/agents.ts`.
- **Commands:** `bun run dev` / `bun run dev:mock`; full suite `bun run test`;
  single file `bun test <path> --isolate`; rig `bun run instance up|dev
  --mode isolated`; isolated boot smoke via the `/verify` skill.
- **Code style:** per CLAUDE.md — strict TS, zod at boundaries, functional,
  `createLogger`, kebab-case files, URL-backed view state via
  `useQueryState`/`useQueryArrayState`, shared UI only from
  `@makinbakin/sdk/components`, conventional commits with scope.

## 6. Boundaries

**Always:**
- All runtime access via `ctx.runtime` / `AppServices.runtime` — nothing
  OpenClaw-specific upstream of `packages/adapter-openclaw/` (architecture
  tests enforce; timeline reads Bakin-owned ledger + audit + task store, and
  session-death detail comes from audit blobs, NOT fresh transcript parsing).
- NULL-honest costs — never fabricate 0 for unknown cost; label estimates
  (`estimated: true` pattern) and partial coverage (`*` marker) like existing
  surfaces.
- Extend the existing recorders/stores — **never add a parallel
  stat-tracking system** (CLAUDE.md hard rule).
- Read-only diagnostics: scan/context/timeline endpoints must not write.
  Only explicit user actions (Sync now) mutate.
- Warn-only severity for burn and context checks; error severity reserved for
  the existing sync/system checks.
- Plain-language, numbers-included messages for every flag.

**Ask first:**
- Any new SQLite table or persisted store (spec expects none).
- Adding fields to `settings.json` beyond the `burn` block.
- Any restructuring of the health page layout (reserved for the follow-up).

**Never:**
- Backwards-compat shims or dual code paths (single-user machine).
- Chart library dependency (D9).
- Classify runtime failures by error-message text (kind only).
- Truncate task descriptions in any measurement path.

## 7. Testing strategy

- **Unit:** burn evaluator (flag boundaries, null-cost honesty, empty
  history, delta join: attributed > observed clamps to 0 unattributed,
  missing scan coverage yields nulls not zeros, day-alignment edges); new
  store queries (agent×day rollup, runs-by-agent join, active
  runs, completions-by-agent) against temp-dir ledgers/DBs with `closeDb()`
  teardown; audit agent filter; timeline assembly (run/audit merge ordering,
  death-diagnosis summarization); drifted-state derivation.
- **Plugin routes:** via `tests/plugins/test-helpers.ts` (`activatePlugin`,
  `callRoute`) — live-now, agent-effort, usage-history byAgentDay, timeline,
  agent-packages scan.
- **All tests** follow the CRITICAL mocking rules (both content-dir paths +
  OpenClaw home + logger + watcher; env vars before imports where needed).
- **Dispatch-prompt byte fixtures** must stay green (no prompt changes
  expected — verify).
- **E2E validation (required by kickoff):** dockerized rig in isolated mode —
  drive real dispatches through Imitation Crab/OpenClaw rig, then verify:
  live-now shows the in-flight run; timeline shows the settled run with
  tokens; induced drift (edit a managed block) flips the badge + scan
  findings + attention chip; context tab renders; burn check flags a
  synthetic heavy-burn/zero-completion history; a non-Bakin turn (direct
  runtime session, no dispatch) shows up as unattributed usage on the effort
  card after the next usage scan; `bakin agents doctor <id>` renders.
  Documented as a runbook section in the plan.

## 8. Acceptance criteria

1. Health dashboard answers "is anything running right now?" truthfully
   (live-now panel, honest empty state) within one poll cycle of dispatch.
2. Daily token chart shows per-agent stacked breakdown from durable history.
3. An agent that burns above the floor with zero completions in the window is
   flagged by `usage.agent-burn` (doctor + attention chip + effort card) with
   a message naming agent, tokens, runs, completions.
4. An agent with a stale managed block shows `drifted` on its badge, an
   attention chip, and per-file/per-input findings in Diagnostics; Sync now
   clears it end-to-end.
5. Diagnostics tab renders the full context budget (meter, sections, caps,
   workspace, observed sparkline) for any agent with zero writes.
6. Timeline shows each dispatch run with model/duration/tokens/cost/outcome,
   interleaved bypass/lesson/death events, expandable progress logs.
7. An agent with substantial transcript-observed usage not covered by
   Bakin-metered runs shows an unattributed column value on the effort card
   and, above threshold, an `unattributed` burn flag ("used Nk tokens outside
   Bakin-managed tasks") — the direct unsupervised-activity signal.
8. `bakin agents doctor <id>` renders all of the above in one report,
   `--json` machine-readable.
9. Full `bun run test` green; rig validation runbook executed and recorded.
10. Knowledge docs updated per §4.8.
