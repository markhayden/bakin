# Agent Health Diagnostics (#385)

The supervision layer: one glance at the Health dashboard answers *what is
running, what did it cost, was it worth it, and who needs attention*; one
click into an agent answers *has its definition drifted, how much context
does a fresh session load, and what has it been doing*. Built for a user who
is not an AI expert — every chart carries a plain-language explainer and every
automated flag is a doctor check whose message names the agent, the numbers,
and what to do next.

Spec/plan: `.claude/specs/agent-health-diagnostics{,-plan}.md`.

## The one-engine rule

Detection arithmetic lives in exactly one place per concern, and every surface
(doctor check, REST endpoint, dashboard card, CLI report) is a thin client of
it — same pattern as `context-report.ts`/`budget.ts`:

| Concern | Engine | Surfaces |
|---|---|---|
| Token burn | `src/core/agent-burn.ts` (`evaluateAgentBurn` pure + `buildAgentBurnReports` assembly) | `usage.agent-burn` check, `GET /api/plugins/health/agent-effort`, Effort card, Overview burn chip, `bakin agents doctor` |
| Drift | `src/core/agent-packages/sync-scanner.ts` (`scanAgentSync`) | `team.agent-sync` check (cached, fleet), `GET /api/agent-packages/{id}/scan` (live, one agent), Diagnostics drift panel, drifted badge |
| Context size | `src/core/context-report.ts` (#357, pre-existing) | `context.startup-size` check, `GET /api/context-report/{id}`, Diagnostics context panel, `bakin agents context` |
| Timeline | `plugins/team/lib/timeline.ts` (`assembleTimeline` pure merge) | `GET /api/plugins/team/{id}/timeline`, Diagnostics timeline panel, `bakin agents doctor` |

## Burn heuristics (`settings.burn`, warn-only)

Burn signals stay warn-only, but since cost-control v2 the same
observed-minus-attributed delta they surface ALSO counts toward budget caps
(the spend engine adds it per agent/day/lane — see
`.claude/knowledge/usage-recording.md` § Budget gating consumes usage.db).
Burn = the explainable "why", budget = the enforced ceiling.

Three explainable signals per agent, evaluated over a day-aligned window:

- **effort-no-outcome** — ≥ `minTokensFloor` Bakin-attributed tokens
  (run_costs) with zero task completions in the window.
- **spike** — today's transcript-observed tokens > `spikeMultiplier` × the
  agent's own trailing `baselineDays` daily average AND above the floor.
- **unattributed (D11)** — `max(0, observed − attributed)` where observed
  comes from usage.db transcript scans and attributed from run_costs. This is
  the direct "the runtime did things outside Bakin-managed tasks" signal.
  Fires above `unattributedShare` of observed AND `unattributedFloorTokens`.

Data honesty: observed/unattributed are **null when the usage scanner has no
coverage of the window** (fleet-wide judgment: any cell in the window =
covered) — never fabricated zeros. Cost sums stay NULL-honest
(`runTokensByAgentSince`). Settings are re-read each doctor run; all six knobs
render in System & Alerts.

Known false positive (accepted by design): a legitimately long-running task
looks like effort-no-outcome until it completes. Messages say "check its
timeline", not "broken".

## Data-layer additions (queries only — no new stores)

- Ledger (`packages/core/src/execution/ledger.ts`): `listLiveRuns()`
  (status='running' across agents — trustworthy because the boot sweep marks
  prior-boot rows lost), `listRunsByAgent()` (runs LEFT JOIN run_costs — the
  timeline run spine), `completionsByAgentSince()`, `runTokensByAgentSince()`.
- Usage history (`packages/core/src/usage-history/store.ts`):
  `usageByAgentDaySince()` — the (agent × day) cross-tab that was previously
  discarded at the API layer; drives the stacked chart and the delta join.
- Audit (`src/core/audit.ts`): `queryAuditEvents` gained an `agent` filter
  (both full-read and windowed tail paths).

## HealthCheckResult.data convention

`HealthCheckResult` (SDK `registration.ts`) has an optional
`data?: Record<string, unknown>`. Per-agent checks attach
`data: { agents: string[] }` so UIs attribute findings **without parsing
message text**. Attached by: `team.agent-sync`, `context.startup-size`,
`usage.agent-burn`. Consumed by: the dashboard AttentionSection, the Overview
chips (`useAgentAttention`), and the finally-wired `drifted` package badge —
all reading the CACHED doctor results from `/api/plugins/health/summary`
(cron freshness; the Diagnostics tab's live scan is the fresh path).

## Surfaces

**Health dashboard** (`plugins/health/components/supervision-sections.tsx` +
`usage-history-section.tsx`): LiveNowSection (`GET /live-now`, honest empty
state, amber stale-heartbeat > 2 min), AttentionSection (chips →
`/team/{id}?tab=diagnostics`), EffortSection (`GET /agent-effort?window=`,
Bakin/observed/unattributed columns), per-agent stacked daily chart
(`/usage-history` `byAgentDay`).

**Team Diagnostics tab** (`plugins/team/components/diagnostics-tab.tsx`):
drift panel (live `GET /api/agent-packages/{id}/scan` + receipt + Sync now via
the existing sync POST), context panel (render of `/api/context-report/{id}` +
budget from `/api/settings` `dispatch.contextBudgetBytes` + observed-input
sparkline), timeline panel (24h/7d, expandable per-run progress logs; a live
row at the top chips the agent's in-flight turn from the ephemeral
`turn-activity` SSE event — UI layer only, the durable ledger+audit spine
`assembleTimeline` merges is untouched; see `dispatch.md`).
Overview tab renders drift/context/burn chips and overrides the package badge
to `drifted` from the same attention hook.

**CLI**: `bakin agents doctor <id> [--json]`
(`src/cli/commands/agents.ts` → `src/core/cli/ui/reports/agent-doctor.tsx`) —
thin aggregator over the same four endpoints; each section degrades to
"unavailable" independently. NB: Ink `StatusTable` statuses are TuiStatus
(`fail`, not `error`), and spreading rows that carry their own `status` field
must not clobber the TuiStatus column.

## Timeline assembly

`assembleTimeline` merges the run spine (newest-first `listRunsByAgent`) with
notable audit kinds (`TIMELINE_AUDIT_KINDS`: bypass_detected, session deaths,
runtime_failed_blocked, corrective_redispatch, decomposition_dispatched,
blocked, lessons retrieved/failed) filtered by the audit agent field, attaches
per-run progress-log lines (task `log[]` entries inside the run's lifetime,
capped 20/run), and summarizes `RuntimeTurnDiagnosis` audit payloads into
plain language server-side. Caps: 100 runs / 200 events. Reads Bakin-owned
stores only — no adapter surface, no transcript parsing.

## Chart kit (`@makinbakin/sdk/components`)

`StackedColumnChart`, `Sparkline`, `ChartExplainer` +
`CHART_SERIES_COLORS`/`assignSeriesColors` in `src/components/charts/`
(re-exported via the SDK barrel; rides the existing `sdk-components` vendor
bundle). Hand-rolled, no chart library (spec D9). The palette is the
dataviz-validated dark-surface categorical set — the slot ORDER is the
colorblind-safety mechanism (never reorder/cycle); a 9th series folds into a
gray "Other", never a new hue; color follows the entity, not its rank.

## Extending

- New burn signal → add a `BurnFlag` kind in `agent-burn.ts` + tests; every
  surface picks it up automatically.
- New timeline event kind → add to `TIMELINE_AUDIT_KINDS` (+ severity set).
- New per-agent doctor attribution → attach `data.agents` in the check;
  chips/badges pick it up with no UI change.
