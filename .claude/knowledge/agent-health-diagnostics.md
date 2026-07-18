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

Explainable signals per agent, evaluated over a day-aligned window (#691
split the retired single `unattributed` delta into provenance buckets —
session origin comes from the adapter labels in usage.db, see
`usage-recording.md`):

- **effort-no-outcome** — ≥ `minTokensFloor` Bakin-attributed tokens
  (run_costs) with zero task completions in the window.
- **spike** — today's transcript-observed tokens > `spikeMultiplier` × the
  agent's own trailing `baselineDays` daily average AND above the floor.
- **interactive** (advisory, calm copy) — observed tokens from
  external-origin sessions (operator TUI/direct chats — sessions Bakin never
  originated). Fires above `unattributedShare` of observed AND
  `unattributedFloorTokens`. "Normal if you were working with this agent
  directly" — never scary.
- **unexplained** (watch) — `max(0, observed(bakin ∪ unknown-origin) −
  interactive − attributed)`: tokens no ledger row or interactive session
  explains. Same thresholds; copy strengthens when a spike fires the same
  day. Unknown-origin tokens count here, NEVER toward interactive — the calm
  bucket must be provable.
- **runaway** (action_required page; D9/D11) — only with real indicators: an
  external-origin session accumulating ≥ `runawayAssistantTurns` (20)
  token-bearing assistant turns AND ≥ `runawayFloorTokens` (1M) tokens with
  ZERO user turns, OR unexplained ≥ the runaway floor coinciding with a
  spike. Unknown-origin sessions never page ("cannot tell" is not evidence).
  **Cron guard**: the health check and `/agent-effort` route pre-fetch the
  runtime's enabled native scheduled jobs identically (the engine stays
  pure — jobs arrive as input); jobs present downgrade the page to a watch
  review prompt naming the jobs. CronJob carries no agent attribution, so
  the guard is runtime-wide by design — under-paging beats a false page. No
  cron surface / failed read = NO downgrade (fail loud).

Data honesty: observed/interactive/unexplained are **null when the usage
scanner has no coverage of the window** (fleet-wide judgment: any cell in the
window = covered) — never fabricated zeros. Cost sums stay NULL-honest
(`runTokensByAgentSince`). Settings are re-read each doctor run; all eight
knobs render in System & Alerts. The check emits one observation per
(agent, bucket) with stable keys (`interactive:<agent>`, `unexplained:<agent>`,
`runaway:<agent>`, legacy `agent:<agent>` for effort/spike) and structured
evidence — flag copy is never parsed.

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

## Canonical agent attribution

Per-agent Health incidents attach structured resources such as
`{ kind: 'agent', id, label }`; supporting measurements live in bounded JSON
evidence. Consumers filter canonical incidents/resources and never parse an
agent name from summary text. `team.agent-sync`, `context.startup-size`, and
`usage.agent-burn` are the reference producers.

The Team Diagnostics tab reads canonical Health reports and selects incidents
for its agent by resource ID. The Health Overview presents the same incidents
in its action/verification/watch placement. The nav badge counts unique
non-advisory incidents. `/summary` is live process data only and is not a
second diagnostic response.

## Surfaces

**Health dashboard** (`plugins/health/components/overview-tab.tsx` +
`agents-tab.tsx`): Overview shows actionable agent incidents alongside other
canonical incidents and keeps fast live facts distinct from diagnostic
evidence. Agents owns the day-aligned window, per-agent stacked daily chart,
observed/attributed/unattributed comparison, outcomes, latest-session traffic,
and clearly separated cost scopes. Every chart ships an exact data table.

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

`StackedColumnChart`, `BarChart`, `LineChart`, `Sparkline`,
`ChartDataTable`, `ChartTooltip`, `ChartExplainer` +
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
- New per-agent doctor attribution → attach an `agent` resource to the
  canonical incident; downstream consumers pick it up without copy parsing.
