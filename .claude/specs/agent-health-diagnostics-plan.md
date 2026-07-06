# PLAN — Agent Health Diagnostics (#385)

Status: APPROVED 2026-07-05 (spec + discovery pre-approved by owner)
Spec: `.claude/specs/agent-health-diagnostics.md`
Branch: `feat/385-agent-health-diagnostics`

## 0. Plan-time verification results (resolves the spec's open items)

| Open item | Finding | Resolution |
|---|---|---|
| Live-now data source | No cross-agent running-runs SELECT exists; watchdog uses per-task `getLiveRun` + the in-memory turn registry (advisory by design). Ledger `runs.status='running'` is durable truth; `markPriorBootRunsLost` cleans stale rows at boot. | New ledger query `listLiveRuns(): RunRow[]`. |
| Doctor cache granularity | `HealthCheckResult` = `{check, status, message, autoFixable}` — **no machine-readable agent id**. agent-sync + context checks collapse agents into message strings. | Add optional `data?: Record<string, unknown>` to `HealthCheckResult` (SDK `registration.ts`, canonical type). Per-agent checks attach `data.agents: string[]`. Attention rollup/chips/badge derive from `/summary` client-side. No new endpoint needed. |
| Completions per agent | No such query; `completions` has `agent NOT NULL` + `completed_at NOT NULL`, PK `task_id` only. Table is tiny (single-user) — no new index. | New `completionsByAgentSince(sinceMs)`. |
| Single-agent drift scan | `scanAgentSync()` is fleet-wide; `verifyAgent()` already does scan-then-filter by `f.agentId`/`packageId`. | Scan endpoint reuses that pattern (full scan, filter to agent). |
| Settings | No zod for settings.json — TS interface + `DEFAULT_SETTINGS` + `deepMerge`; System & Alerts is the hand-maintained `SYSTEM_SETTINGS_SCHEMA` fields list (`src/components/system-settings.ts`). No normalizer needed for a new block. | Add `burn` to `BakinSettings` + defaults + schema fields. |
| SDK chart kit build | Components physically live in root `src/components/`, re-exported by `packages/sdk/src/components/index.ts` barrel; new exports ride the existing `sdk-components` vendor bundle; `bun run dev` auto-rebuilds vendors on SDK-tree edits. | New components in `src/components/charts/` + barrel lines. |
| CLI wiring | `agents.ts run()` if/else on `args[1]`; `--json` before TTY; Ink reports in `src/core/cli/ui/reports/` via `renderInkReport` + readonly barrel; usage registry entry in `src/core/cli/registry.ts` (display only). | Copy the `context` subcommand pattern. |
| Team tabs | `TABS` array + `Tab` union + `activeTab === 'x' && <X/>` chain in `agent-detail.tsx`; routes via `defineRoute` push in `populateAgentRoutes` (params arrive as query params). | Add `diagnostics` tab following the pattern. |

Known cosmetic pre-existing issue (fix in passing, C10): `exitUnknownSubcommand('agents', …)` hint list at `src/cli/commands/agents.ts:447` lists `'update'` but omits real subcommands.

## 1. Dependency graph

```
C1 ledger queries ──────────┐
C2 usage×day + audit filter ─┼─→ C3 burn evaluator+settings ─→ C4 doctor checks+data field
                             │            │
                             ├─→ C5 health endpoints (live-now, effort, byAgentDay)
                             ├─→ C6 team timeline endpoint
                             └   C7 scan endpoint (independent of C1–C6)
C8 SDK chart kit (independent)
C5+C8 ─→ C9 dashboard sections (live-now, attention, stacked chart, effort)
C4+C6+C7 ─→ C10 team Diagnostics tab + chips + badge
C5+C6+C7 ─→ C11 CLI agents doctor
all ─→ C12 docs ─→ C13 rig validation runbook
```

## 2. Tasks & commit strategy

Every commit is a rollback checkpoint: full `bun run test` green before each,
conventional message, one vertical concern per commit. Sequence:

### Phase 1 — data layer

**C1 `feat(core): ledger queries for live runs, per-agent history, completions`**
- `packages/core/src/execution/ledger.ts`:
  - `listLiveRuns(): RunRow[]` — `status='running' ORDER BY started_at ASC`.
  - `listRunsByAgent(agent, {sinceMs?, limit?}): RunWithCostRow[]` — `runs` LEFT JOIN `run_costs` ON run_id, newest first, limit clamp [1,200] default 50.
  - `completionsByAgentSince(sinceMs): { agent, completions }[]`.
- Re-export via `src/core/execution-ledger.ts` facade.
- Tests `tests/core/execution-ledger-agent-queries.test.ts` (temp-dir DB, `closeDb()` teardown; running/settled mix, join with/without cost rows, since cutoffs).
- ✅ AC: queries return typed rows; suite green.

**C2 `feat(core): agent-day usage rollup and audit agent filter`**
- `packages/core/src/usage-history/store.ts`: `usageByAgentDaySince(sinceDay)` → `{agent, day, tokens{...}, costUsdMicros, costedMessages, messageCount}[]` (GROUP BY agent, day; NULL-honest cost like siblings).
- `src/core/audit.ts`: `queryAuditEvents` + tail path gain optional `agent` filter.
- Tests for both (store: multi-agent/multi-day fixtures; audit: filter + kinds + sinceMs combos).
- ✅ AC: cross-tab preserved per (agent, day); audit filter exact-match on top-level agent.

### Phase 2 — burn evaluator + doctor

**C3 `feat(core): agent burn evaluator + burn settings block`**
- `packages/core/src/settings.ts`: `burn` block on `BakinSettings` + `DEFAULT_SETTINGS`: `{ windowHours: 24, minTokensFloor: 500_000, spikeMultiplier: 3, baselineDays: 7, unattributedShare: 0.5, unattributedFloorTokens: 100_000 }`.
- `src/components/system-settings.ts`: schema fields for all six (System & Alerts).
- `src/core/agent-burn.ts`: pure `evaluateAgentBurn(inputs, config)` (spec §4.2 output incl. delta join, day-aligned, null-honest) + `gatherBurnInputs()` assembling from ledger (`spend`/`listRunsByAgent`/`completionsByAgentSince`) + usage-history store (`usageByAgentDaySince`).
- Tests: flag boundaries (floor edge, zero/near-zero completions, spike ×3 vs baseline, unattributed share+floor), attributed>observed clamps to 0, missing scan coverage → nulls never zeros, empty history.
- ✅ AC: evaluator pure and fully unit-tested; settings round-trip through flatten/unflatten.

**C4 `feat(health): usage.agent-burn check; per-agent data on health results`**
- `packages/sdk/src/types/registration.ts`: `HealthCheckResult.data?: Record<string, unknown>` (optional — no callers break).
- New `plugins/health/lib/system-checks/agent-burn.ts` (`usage.agent-burn`, warn-only, message names agent+numbers+`check its timeline`, `data.agents` attached); registered in `plugins/health/index.ts`.
- `plugins/team/lib/health-checks.ts` (agent-sync rows) + `plugins/health/lib/system-checks/context-report.ts` (over-budget row): attach `data.agents`.
- Tests: check emits ok/warn correctly from mocked evaluator inputs; data.agents populated on all three checks.
- ✅ AC: doctor run shows the new check; cached results now carry per-agent ids.

### Phase 3 — API

**C5 `feat(health): live-now, agent-effort, per-agent daily history endpoints`**
- `plugins/health/index.ts` + `types.ts`:
  - `GET /live-now` → `{ runs: [{agent, taskId, taskTitle, startedAt, runningForMs, heartbeatAgeMs}] }` (ledger `listLiveRuns` + task-store titles).
  - `GET /agent-effort?window=24h|7d|30d` → evaluator output per agent + `scannedAt`.
  - `/usage-history` response gains `byAgentDay`.
- Route tests via `tests/plugins/test-helpers.ts`.
- ✅ AC: all three respond with zod-validated queries; empty states honest.

**C6 `feat(team): per-agent activity timeline endpoint`**
- `plugins/team/lib/routes/agents.ts`: `GET /:agentId/timeline?window=24h|7d` assembling run spine (`listRunsByAgent`) + interleaved audit events (`queryAuditEvents({agent, kinds: NOTABLE})` — bypass_detected, runtime_session_died, corrective_redispatch, decomposition_dispatched, blocked, lessons_retrieved/failed) + per-run task log lines (capped) + plain-language death summaries (from audit payload fields: reason, lastToolCall, deaths, detail). Caps: 100 runs / 200 events.
- Assembly logic in `plugins/team/lib/timeline.ts` (testable pure merge given inputs).
- Tests: merge ordering, death summarization, caps, empty agent.
- ✅ AC: one call returns the full D6 shape, newest first.

**C7 `feat(api): read-only agent-packages drift scan endpoint`**
- `packages/host/src/api/agent-packages/dynamic.ts`: `GET /api/agent-packages/{agentId}/scan` → `{ ok, findings, scannedAt }` (scanAgentSync → filter by agentId, verifyAgent pattern; zero writes).
- Test: findings filtered; read-only (no lockfile/receipt mutation).
- ✅ AC: returns per-file/per-input findings for one agent.

### Phase 4 — shared chart kit

**C8 `feat(sdk): hand-rolled chart kit (stacked columns, sparkline, explainer)`**
- `src/components/charts/{stacked-column-chart,sparkline,chart-explainer}.tsx` + barrel exports in `packages/sdk/src/components/index.ts`. Theme-aware, no deps; stacked chart: legend (toggle), hover tooltip, single-series fallback.
- Component render tests (happy-dom) for scale math + empty data.
- ✅ AC: importable from `@makinbakin/sdk/components`; vendor build green.

### Phase 5 — UI

**C9 `feat(health): live-now + attention sections`**
- `LiveNowSection` (under SummaryCards; stale-heartbeat highlight; "Nothing is running right now.") + `AttentionSection` (chips from `/summary` doctor `data.agents` across agent-sync/context/burn; links to `/team?agent=<id>&tab=diagnostics`; "All agents look healthy."). Explainer footers.
- ✅ AC: dispatch on dev rig appears within one poll; chips deep-link.

**C10 `feat(health): per-agent stacked daily chart + effort section`**
- `UsageHistorySection`: `DailyTotalsChart` → `StackedColumnChart` per agent (fallback single series).
- New `EffortSection`: table per spec §4.4.4 (runs, done, Bakin tokens, total observed, unattributed ⚠, tokens/completion) + window toggle (URL-backed) + inline flags + explainer.
- Also fix the stale `exitUnknownSubcommand` hint list (drive-by, noted above).
- ✅ AC: columns self-explanatory; flagged rows match doctor.

**C11 `feat(team): Diagnostics tab, overview chips, drifted badge`**
- `Tab` union + `TABS` + content chain: `diagnostics` tab = `DiagnosticsTab` with three panels (drift: live `/scan` + receipt + Sync now via existing POST; context: render of `/api/context-report/{id}` with budget meter + sparkline; timeline: `/timeline` with expandable logs + pinned live run).
- `OverviewTab`: three status chips (drift/context/burn) from `/summary` + `/agent-effort`, linking to the tab.
- `package-state-badge` finally gets `drifted` (derived from doctor cache `data.agents`).
- ✅ AC: acceptance criteria 4–6 of the spec demonstrable on mock rig.

### Phase 6 — CLI

**C12 `feat(cli): bakin agents doctor <id>`**
- `agents.ts`: `doctor` branch + `cmdAgentsDoctor(id, {json})` fetching scan + context-report + timeline(24h) + agent-effort(24h); `--json` prints combined object; TTY renders new `AgentDoctorReport` (`src/core/cli/ui/reports/agent-doctor.tsx`, readonly barrel export); registry entry `agents doctor`.
- ✅ AC: spec criterion 8; degrades gracefully per-section when an endpoint errors.

### Phase 7 — docs + validation

**C13 `docs(knowledge): agent health diagnostics`**
- New `.claude/knowledge/agent-health-diagnostics.md`; updates: `usage-recording.md`, `doctor-and-health-checks.md`, `layered-context.md`, `startup-context.md`; CLAUDE.md Key Patterns pointer; README/docs-site only if they enumerate agent CLI commands (check).

**C14 `test(rig): #385 validation runbook` (+ any fix commits found)**
- Execute §3 runbook; record results in the plan's status section; fixes land as separate `fix(...)` commits.

## 3. Dockerized-rig validation runbook

Setup: `bun run instance up --mode isolated` (isolated mode — never native; port per rig config). Set `BAKIN_URL` for CLI runs. Tune for testability via System & Alerts or settings.json: `burn.minTokensFloor: 1000`, `burn.unattributedFloorTokens: 1000`, `plugin-settings/health usageHistoryScanMinutes: 1`.

1. **Live-now:** dispatch a task to a rig agent → while in flight, `GET /api/plugins/health/live-now` lists it and the dashboard panel shows agent/task/running-for; after settle, panel returns to honest empty state.
2. **Timeline:** open the agent's Diagnostics tab → the settled run shows model/duration/tokens/cost/outcome; progress-log lines expand.
3. **Drift:** edit a managed block line inside the agent's AGENTS.md → `GET /api/agent-packages/{id}/scan` shows `block-stale` with `in-place-edit` attribution; run doctor fresh → badge flips to drifted + attention chip appears; click Sync now → findings clear, badge returns to managed.
4. **Burn (effort-no-outcome):** with lowered floor, dispatch a token-consuming task that doesn't complete (or leave it in progress past the window) → `usage.agent-burn` warns; effort card row shows the flag; Overview chip lights.
5. **Unattributed:** drive a direct runtime turn (openclaw session inside the container, no Bakin dispatch) → after the next usage scan (≤1 min), effort card shows the unattributed column > 0; above threshold the unattributed flag fires.
6. **Context:** Diagnostics context panel renders meter/sections/caps/workspace/observed sparkline; matches `bakin agents context <id>`.
7. **CLI:** `bakin agents doctor <id>` renders all sections; `--json` parses.
8. **Regression:** full `bun run test`; `bun test tests/dev/` explicitly (crab/rig tests are CI-only locally).

## 3.1 Validation record (2026-07-05/06)

**Isolated boot smoke** (temp BAKIN_HOME, seeded ledgers, server from source):
every #385 endpoint validated — live-now (incl. boot-sweep eviction of
pre-boot runs), agent-effort (all three flag kinds with correct numbers,
null-honest cost/observed), timeline (run spine, expandable logs, plain-language
death summaries), usage-history byAgentDay, read-only scan, doctor rows with
data.agents+kinds, CLI --json. Found+fixed: bypass events are watchdog-actor
(top-level agent 'watchdog', real agent in data.agent) — timeline now queries
them by attribution; bypass/lesson events get plain-language messages.

**Dockerized rig, isolated mode, real OpenClaw 2026.5.28** (real Codex turns):
1. ✅ Real dispatch appeared in live-now within seconds (agent/title/running-for/
   heartbeat) and vanished on settle (~35s turn).
2. ✅ Timeline showed the settled run with real model (openai/gpt-5.5), real
   tokens (165 in / 20 out / 43.6k total incl. cache), null cost (no catalog
   pricing — never $0), 2 progress-log lines.
3. ✅ Drift loop: in-place edit inside the container's managed block →
   live scan `block-stale [in-place-edit]` → doctor row with
   data.agents ['main','enrich'] → Sync now recomposed exactly AGENTS.md
   (verification ok) → rescan clean.
4. ✅ Burn: effort-no-outcome fired (lowered floor) with honest message.
5. ✅ Unattributed (D11): direct `openclaw agent` turns (no Bakin dispatch) →
   after the 5-min usage scan, observed 169.7k vs attributed 43.6k →
   126.1k unattributed → flag fired: "'enrich' used 126k tokens outside
   Bakin-managed tasks in 24h". At 48% share the flag correctly held.
6. ✅ `bakin agents doctor enrich` against the rig: all four sections
   (TTY render validated in smoke/unit tests; non-TTY prints JSON).

**Observations for the follow-up UX issue:**
- Completions attribute to the REPORTER: the rig task's completion was
  recorded by 'main' while 'enrich' did the work — the effort card's "Done"
  column counts completions reported by that agent. Fine for production
  (agents complete their own tasks) but worth a column tooltip.
- The rig image floats `:latest` and was 5 weeks stale (2026.5.28 vs
  upstream 2026.6.11) — pin `OPENCLAW_IMAGE_TAG` and bump alongside prod.
- The onboarding `llm` check warned "no provider configured" even though
  container-side Codex auth works — pre-existing check blind spot, not #385.

## 4. Risks / notes

- **Burn false positives** accepted per spec (long-running legit work) — defaults tuned, settings exposed, message says "check its timeline" not "broken".
- **Day-aligned delta**: 24h window compares day-aligned usage.db rows to run_costs sums over the same local days; label `scannedAt`, nulls when scanner hasn't covered the window.
- **`HealthCheckResult.data`** is additive and optional; two-tier SDK/core type contract respected (change lands in SDK canonical type).
- **Timeline reads Bakin-owned stores only** (ledger, audit, task store) — no adapter surface change; session-death detail comes from audit payloads.
- **Attention chips** need doctor to have run — show "waiting for first doctor run" rather than empty-green when cache is absent.
- Null-agent usage rows render as `unknown`, excluded from flags.
