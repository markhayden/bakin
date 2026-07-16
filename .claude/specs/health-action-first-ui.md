# Spec: Trustworthy, Action-First Health Experience

**Status:** Completed 2026-07-13
**Approved:** 2026-07-12
**Date:** 2026-07-12  
**Primary surface:** `/health`  
**Primary user:** The single operator of this Bakin installation

## 1. Objective

Rebuild Health around the operator's actual questions:

1. **Does anything need me?**
2. **Is Search working?**
3. **What is running right now?**
4. **Which agent, tool, endpoint, or subsystem should I inspect?**
5. **What can I do to restore a healthy state?**

The current plugin contains useful information but presents it as a long, flat feed of
partially overlapping cards. The replacement must make unhealthy, actionable, and
unverifiable conditions obvious; group related evidence into one operator-facing incident;
provide one clear next action; and keep healthy technical detail available without letting it
dominate the page.

Success is not a synthetic score or a prettier collection of the same cards. Success is a
trustworthy health model shared by the dashboard, CLI, notification, escalation, and repair
paths, presented through an information architecture that matches the operator's mindset.

## 2. Assumptions and constraints

1. This machine is the only user. A clean, single-version contract migration is preferred over
   compatibility shims.
2. All 39 first-party health-check registrations will migrate in this project. Old or malformed
   installed-plugin output fails closed as Unknown; it is never inferred or silently accepted.
3. Existing delegated repair-request records are archived intact before the new schema is used.
   They are not deleted and their old messages are not parsed into the new model.
4. Health becomes responsive to its **available container width**. Redesigning the fixed global
   sidebar/activity-panel shell is reserved for the later style-guide pass.
5. Active findings cannot be dismissed, acknowledged, or snoozed in this project. They remain
   visible until fresh evidence changes their state.
6. No durable incident-history feature is added. Audit logs and repair requests remain the
   durable operational record.
7. No new third-party dependency is expected. Existing React, TanStack Router, Tailwind,
   shadcn/Base UI, Lucide, Zod, SDK components, chart utilities, Bun tests, and Playwright are
   sufficient.
8. Models -> Spend remains the canonical detailed source for cost and budget management.
9. The current unrelated generated change in
   `packages/host/src/api/_embedded-assets-static.ts` belongs to the user and must be preserved.

## 3. Verified current state

The audit found up to 15 primary cards plus Search sub-cards. The major trust and usability
problems are:

- `Latest Session Context` and `Context Usage` render the same newest-session data.
- `Active Sessions` counts agent rows rather than the sum of runtime sessions.
- `Errors (1h)` means process-local recorded call/event failures, not doctor errors.
- `Agents Needing Attention` counts finding chips rather than unique agents.
- The header timestamp is the last `/summary` fetch, not the last doctor run.
- Refresh refetches cached summary data and does not run fresh diagnostics.
- Loading and request failures often render as empty/healthy or make whole sections disappear.
- Search can say `Connected` while real queries are dark, indexes are missing, or doctor evidence
  is stale.
- Search repeats live adapter state, activity telemetry, and six doctor checks without a single
  readiness conclusion.
- Plugin inventory can omit activation failures while being titled `Active Plugins`.
- The page polls roughly 11 health reads every 10 seconds and then reports its own traffic as
  endpoint activity.
- Successful heartbeat and housekeeping activity obscure operator-initiated work and failures.
- `refreshInterval` and `showDetailedMetrics` are declared settings but unused. Only
  `usageHistoryScanMinutes` is real.
- The Health manifest declares only seven routes while the plugin registers substantially more,
  and the manifest version (`1.3.0`) disagrees with the server definition (`1.0.0`).
- Health uses hand-built card, badge, segmented-control, color, loading, and empty-state patterns
  despite shared SDK patterns already existing.
- At narrower content widths, viewport-based grids and wide tables compress into unreadable
  layouts. At phone width the global shell itself obscures the page; that shell defect is out of
  this project's implementation scope.

## 4. Information architecture

Health uses URL-backed tabs with `?tab=overview|agents|activity|system`. `overview` is the
default. Only the active tab mounts its data consumers.

### 4.1 Overview — “Does anything need me?”

In priority order:

1. Overall discrete status and evidence freshness.
2. Search readiness, always visible even when healthy.
3. **Needs action** incidents.
4. **Unable to verify** checks or stale/missing sources.
5. **Watching** degraded or potentially self-resolving incidents.
6. Right now: running dispatches, connected runtime sessions, and recent failures.
7. A calm, explicit healthy state when everything required is freshly verified.

Every `action_required` or Unknown incident appears on Overview even when its detailed subsystem
belongs to another tab.

### 4.2 Agents — “What are agents doing, consuming, and accomplishing?”

- One URL-backed `24h / 7d / 30d` window shared by the tab.
- Historical token trend by agent.
- Observed tokens, Bakin-attributed work, unattributed activity, completions/outcomes, and flags
  in one comparison surface.
- One merged `Latest session token usage` surface. It is explicitly cumulative token traffic in
  each newest transcript, not context-window occupancy.
- A compact spend/budget-health summary linking to `/models?tab=spend`; detailed cost tables do
  not compete with Models.
- Runtime-reported cost remains visibly distinguished from Bakin-attributed estimated spend.

### 4.3 Activity — “What is noisy, slow, or failing?”

- Failure-first summary across tool, endpoint, and agent activity.
- URL-backed `5m / 1h / 24h` window and activity-kind filter.
- Successful routine housekeeping hidden by default behind `Include routine activity`.
- Routine failures always remain visible.
- Human-readable names and impact first; raw names, IDs, timings, metadata, and error payloads
  behind row expansion or a drawer.
- Healthy volume is secondary context, not the leading story.

### 4.4 System — “Are services and installed pieces working?”

- Subsystem summaries before inventory.
- Detailed Search indexes, migrations, journal/enrichment state, and repair/reindex controls.
- Plugin activation/update exceptions before the full installed-plugin inventory.
- Runtime/MCP state, correct connection totals, uptime, memory, port, PID, and Node version.
- Complete doctor-check inventory including passed and not-applicable checks, grouped by
  subsystem and collapsed when healthy.
- Healthy technical detail remains reachable but does not reappear as competing Overview cards.

## 5. Existing-card disposition

| Current surface | New home and treatment |
|---|---|
| Uptime | System -> Runtime details |
| Active Sessions | Overview `Connected runtime sessions` using the summed session count; row detail in System |
| Memory | System always; Overview only when degraded/actionable |
| Errors (1h) | Overview `Recent failed events`; full breakdown in Activity |
| Running Right Now | Overview, with task/agent navigation and stale-heartbeat treatment |
| Agents Needing Attention | Removed as a separate health model; replaced by structured incidents filtered to agent resources |
| Latest Session Context | Merged into Agents as `Latest session token usage` |
| Estimated Cost | Compact Agents spend/budget summary linking to Models -> Spend |
| Usage History | Merged into Agents `Usage & efficiency` |
| Effort vs Outcome | Merged into Agents `Usage & efficiency` |
| Tool / Endpoint / Agent Usage | Activity, failure-first |
| Context Usage | Removed as an exact duplicate |
| Search | Overview readiness + System detail; activity telemetry participates in Activity |
| Active Plugins | System, exceptions first; rename full list to `Installed plugins` |
| Diagnostics | Overview incidents + System complete check inventory |
| Port / PID / Node footer | System -> Runtime details |

## 6. Canonical health contract

### 6.1 Contract goals

- One SDK-owned contract for plugin, adapter, core, UI, CLI, repair, delegation, notification,
  and tests.
- Stable identity and grouping without parsing `message` strings.
- Explicit operator impact, disposition, affected resources, resolution, and freshness.
- Core-stamped ownership and timestamps; producers cannot impersonate another owner.
- Runtime validation at the runner boundary.
- No ambiguous empty arrays, untyped `data` bags, `autoFixable` booleans, legacy `autoFix`, or
  `fixed` diagnostic status.

### 6.2 Proposed shape

The exact exported names may be adjusted during planning, but the semantics are required:

```ts
type HealthObservationStatus = 'healthy' | 'warning' | 'error' | 'unknown'
type HealthDisposition = 'advisory' | 'watch' | 'action_required'
type HealthReportStatus = 'healthy' | 'needs_attention' | 'degraded' | 'unknown_stale'
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

type HealthResourceKind =
  | 'system'
  | 'runtime'
  | 'service'
  | 'plugin'
  | 'agent'
  | 'team'
  | 'session'
  | 'search_table'
  | 'task'
  | 'workflow'
  | 'asset'
  | 'schedule'
  | 'budget_rule'
  | 'model'
  | 'channel'
  | 'capability'
  | 'setting'
  | 'directory'
  | 'file'
  | 'other'

interface HealthResource {
  kind: HealthResourceKind
  id: string
  label?: string
}

type HealthResolution =
  | { key: string; type: 'repair'; label: string; actionId: string }
  | { key: string; type: 'navigate'; label: string; href: string }
  | { key: string; type: 'instructions'; label: string; steps: [string, ...string[]]; command?: string }
  | { key: string; type: 'rerun'; label: string }

interface HealthIncidentBaseInput {
  /** Stable within the subsystem group. Never derived from copy or array order. */
  key: string
  title: string
  impact: string
  resources?: HealthResource[]
  resolution: HealthResolution
}

type AdvisoryIncidentInput = HealthIncidentBaseInput & { disposition: 'advisory' }
type WatchIncidentInput = HealthIncidentBaseInput & { disposition: 'watch' }
type ActionIncidentInput = HealthIncidentBaseInput & { disposition: 'action_required' }
type HealthIncidentInput = AdvisoryIncidentInput | WatchIncidentInput | ActionIncidentInput

interface HealthObservationBaseInput {
  /** Stable within this registered check. */
  key: string
  summary: string
  detail?: string
  sourceObservedAt?: string
  evidence?: JsonObject
}

type HealthObservationInput =
  | (HealthObservationBaseInput & { status: 'healthy'; incident?: never })
  | (HealthObservationBaseInput & { status: 'warning'; incident: HealthIncidentInput })
  | (HealthObservationBaseInput & { status: 'error'; incident: ActionIncidentInput })
  | (HealthObservationBaseInput & { status: 'unknown'; incident: WatchIncidentInput })

type HealthCheckRunInput =
  | { outcome: 'observed'; observations: [HealthObservationInput, ...HealthObservationInput[]] }
  | { outcome: 'not_applicable'; reason: string }

interface HealthCheckRegistrationInput {
  id: string
  name: string
  description: string
  group: { key: string; label: string }
  maxAgeMs?: number
  run(): Promise<HealthCheckRunInput>
}

interface HealthRepairActionDefinition {
  /** Namespaced by core to `${owner.id}.${id}`. */
  id: string
  name: string
  plan(target: HealthRepairTarget): Promise<HealthRepairPlanItem[]>
  apply(items: HealthRepairPlanItem[]): Promise<HealthRepairApplyResult[]>
}

interface HealthObservation extends HealthObservationBaseInput {
  id: string
  status: HealthObservationStatus
  incidentId?: string
  checkId: string
  checkName: string
  owner: { kind: 'plugin' | 'adapter' | 'core'; id: string; label: string }
  group: { key: string; label: string }
  checkedAt: string
  observedAt: string
  staleAt: string
  snapshot: 'current' | 'last_known'
}

interface HealthCheckExecution {
  id: string
  checkId: string
  startedAt: string
  completedAt: string
  outcome: 'observed' | 'not_applicable' | 'failed' | 'invalid'
  reason?: string
  error?: { code: string; message: string }
}

interface HealthIncident {
  id: string
  status: Exclude<HealthObservationStatus, 'healthy'>
  disposition: HealthDisposition
  title: string
  impact: string
  resources: HealthResource[]
  resolution: HealthResolution
  observationIds: string[]
  observedAt: string
  staleAt: string
  stale: boolean
}

interface HealthCheckState {
  checkId: string
  latestExecution: HealthCheckExecution
  latestValidSnapshot?: {
    executionId: string
    observations: HealthObservation[]
  }
}

type HealthRepairTarget =
  | { type: 'incidents'; reportId: string; ids: [string, ...string[]] }
  | { type: 'observations'; reportId: string; ids: [string, ...string[]] }
  | { type: 'all_actionable'; reportId: string }

interface HealthRepairPrecondition {
  observationId: string
  executionId: string
  status: Exclude<HealthObservationStatus, 'healthy'>
  resolutionKey: string
}

interface HealthRepairPlanItem {
  id: string
  actionId: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  incidentIds: string[]
  observationIds: string[]
  preconditions: HealthRepairPrecondition[]
  changes: HealthRepairChange[]
}

interface HealthRepairPlan {
  planId: string
  basedOnReportId: string
  target: HealthRepairTarget
  createdAt: string
  expiresAt: string
  items: HealthRepairPlanItem[]
}

interface HealthRepairApplyResult {
  itemId: string
  actionId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
  affectedCheckIds: string[]
  changes: HealthRepairChange[]
}

interface HealthReportSummary {
  checks: { registered: number; completed: number; failed: number; invalid: number; notApplicable: number }
  incidents: { actionRequired: number; watching: number; advisory: number; unknown: number }
}

interface HealthReport {
  id: string
  revision: number
  generatedAt: string
  overallStatus: HealthReportStatus
  lastFullSweep: { id: string; startedAt: string; completedAt: string } | null
  checks: HealthCheckState[]
  observations: HealthObservation[]
  incidents: HealthIncident[]
  subsystems: { search: SearchReadiness }
  summary: HealthReportSummary
}
```

The runner returns canonical observations stamped with:

- `id = ${checkId}:${observationKey}`
- namespaced `checkId` and human `checkName`
- owner `{ kind: 'plugin' | 'adapter' | 'core', id, label }`
- subsystem group
- `checkedAt`, `sourceObservedAt`, and computed `staleAt`
- validated incident and resolution data

An incident ID is `${owner.id}:${group.key}:${incident.key}`. Observations from multiple checks
owned by the same plugin/adapter/core owner may join an incident only by intentionally sharing
that key. Incidents never merge across owners. The core merges severity, resources, and evidence;
it never correlates messages heuristically.

### 6.3 Contract invariants

- Every observed run returns at least one observation. Inapplicable checks return the explicit
  `not_applicable` variant and a reason.
- The status-discriminated union makes these states unrepresentable: a healthy observation with
  an incident, an error without action-required disposition, or an Unknown observation that is
  treated as an advisory. Every incident has exactly one non-empty resolution.
- Repair actions are registered separately from checks through one owner-aware canonical
  registry. A `repair` resolution is valid only when its namespaced `actionId` belongs to the
  same owner; multiple checks owned by that plugin may reference the shared action.
- Navigation targets are validated same-origin application paths. Commands are copyable/manual
  instructions and never auto-executed from the UI.
- Registration, observation, incident, resolution, action, and resource IDs match
  `^[a-z0-9][a-z0-9._:-]{0,127}$`. Labels/titles are 1-120 characters; summary/impact fields are
  1-500; detail/manual-step fields are at most 4,000; an observation has at most 50 resources;
  serialized evidence is at most 32 KiB. Evidence must be JSON-safe and secret-redacted.
- Members sharing an incident ID must have identical title, impact, and resolution key/payload.
  Conflicts are contract failures, not a silent “first row wins.” Status merges by
  `error > unknown > warning`; disposition merges by `action_required > watch > advisory`;
  resources union by `(kind, id)`; evidence remains attached to its source observation.
- Incident `observedAt` is the oldest member observation time, `staleAt` is the earliest member
  expiry, and `stale` becomes true when any member evidence is stale. The UI labels this as the
  oldest evidence rather than presenting the newest member as freshness for the whole incident.
- A thrown check, malformed return, invalid contract, or missing required observation becomes a
  synthetic Unknown execution owned by core. Other checks continue.

### 6.4 Canonical report

The cache is per registered check, not one replaceable flat array:

- `latestExecution` records the most recent attempt, including failed/invalid attempts.
- `latestValidSnapshot` records the most recent successful `observed` result. A successful run
  replaces that check's entire snapshot; findings absent from the new snapshot are resolved.
- A successful `not_applicable` run clears the prior snapshot and counts as complete.
- A failed/invalid rerun retains the prior snapshot as `last_known` and adds a core-owned Unknown
  execution incident. A prior known issue therefore remains visible, while a prior healthy row
  can no longer make the check appear healthy.
- Missing or stale required check evidence similarly creates one core-owned Unknown verification
  incident keyed by check ID, so `Unable to verify` always explains an Unknown overall status.
- Removing/unregistering a check removes its cache entry. Hot reload cannot leave ghost findings.

Every currently registered check is required before the report can claim Healthy. Platform or
configuration variants use explicit `not_applicable`; an inability to evaluate a relevant check
is Unknown, not not-applicable.

`HealthReport` is an immutable projection over the cache and contains:

- monotonic revision plus report identity and generation time;
- last completed full-sweep start and completion times;
- per-check execution state, owner, group, checked time, and not-applicable reason;
- canonical observations;
- grouped active incidents;
- canonical subsystem projections, including Search readiness;
- counts for registered, completed, failed, invalid, and not-applicable checks;
- counts by incident disposition, not raw result rows;
- overall discrete status.

Any cache change produces a new report revision. A targeted check refresh changes the report
revision and affected check state but does not rewrite `lastFullSweep`.

The nav badge and Overview counts use unique incidents. They never count chips, affected agents,
or evidence rows as separate incidents.

### 6.5 Overall status derivation

There is no synthetic numeric score.

Server-side precedence is exact:

1. **Needs attention** — at least one current or last-known `action_required` incident.
2. **Unknown or stale** — otherwise, at least one Unknown incident, registered check without a
   valid execution/snapshot, failed or invalid latest execution, or stale check/snapshot.
3. **Degraded but operating** — otherwise, at least one `watch` incident.
4. **Healthy** — otherwise. Advisories may coexist and live in System.

- **Checking** — client presentation only while obtaining the first usable report. When cached
  evidence exists, keep displaying its status with a visible checking indicator instead of
  hiding a known problem.

Thus a stale known action stays Needs attention, while a stale watch remains visible as
last-known evidence but makes the overall status Unknown until revalidated.

### 6.6 Migration and debt removal

- Replace `HealthCheckResult`, `AdapterHealthCheckResult`,
  `AdapterHealthCheckDefinition`, and the duplicate adapter health service with the canonical
  SDK contract.
- Remove `AppServices.health` / `createHealthService`; the audit confirmed there is no production
  consumer. Register runtime/search adapter checks into the canonical registry at the
  application composition boundary with adapter ownership.
- Remove `autoFix`, `autoFixable`, `healthFixed`, the `fixed` diagnostic status, and message-based
  identity/deduplication.
- Account for all 39 current first-party registrations across Health, Team, Tasks, Workflows,
  Assets, Brands, Git, Images, Memory, and Schedule. Migrate each producer or intentionally
  consolidate correlated probes (especially Search) behind one canonical registration; no
  current diagnostic signal disappears without an explicit spec update.
- Convert the core onboarding gate into a core-owned canonical execution rather than a one-off
  legacy result shape.
- Migrate CLI, exec tools, Team diagnostics, nav badge, notification/escalation, delegated repair,
  repair persistence, route schemas, SDK testing helpers, and documentation together.
- Validate the new registration shape before inserting it into the registry. An installed plugin
  still calling the removed registration contract fails activation with a typed contract error;
  the plugin-registry check surfaces that activation incident. A valid registration whose later
  `run()` output is malformed becomes an Unknown execution. There is no legacy registry path.
- Add an architecture test that rejects reintroduction of the removed legacy fields/types and
  message-derived incident identity.

## 7. Freshness and execution

1. Serve the cached report immediately when available.
2. Show the actual full doctor run and per-source observation times, never the client fetch time.
3. `observedAt = sourceObservedAt ?? latestSuccessfulExecution.completedAt`.
4. `ttl = registration.maxAgeMs ?? configuredDoctorIntervalMs`.
5. `grace = clamp(ttl * 0.20, 1 minute, 5 minutes)` and `staleAt = observedAt + ttl + grace`.
   A not-applicable execution uses its completion time as `observedAt`.
6. Every current registration must have a fresh successful observed/not-applicable execution for
   the report to be complete. Latest failed/invalid execution makes that check Unknown even if
   an older valid snapshot is retained for last-known context.
7. Opening Overview with stale/missing evidence automatically starts a fresh, report-only sweep.
8. `Run checks` is the primary header action and always requests a fresh report-only sweep.
9. Full sweeps are globally single-flight. Targeted refreshes are single-flight per check. If a
   full sweep and targeted refresh overlap on the same check, both callers join the same check
   execution. Only completion of the full registered set updates `lastFullSweep`.
10. Repair verification reruns the affected registrations, merges those executions into the
   canonical cache, and returns the verified incident state. It does not relabel an applied
   mutation as healthy before verification.
11. Doctor completion and repair verification emit a named invalidation event so open clients
   refresh promptly.

## 8. Search readiness

Search has one server-derived composite contract and one pure, exhaustively tested classifier.
It combines live adapter/index evidence with recent canonical Search observations. `Connected`
is evidence, never the conclusion.

```ts
type SearchReadinessStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
type SearchStageStatus = SearchReadinessStatus | 'not_applicable'

interface SearchReadinessStage {
  key: 'engine' | 'queries' | 'indexes' | 'journal'
  label: string
  status: SearchStageStatus
  summary: string
  observedAt: string | null
  staleAt: string | null
  observationIds: string[]
}

interface SearchReadiness {
  status: SearchReadinessStatus
  summary: string
  observedAt: string | null
  staleAt: string | null
  stages: SearchReadinessStage[]
  incidentIds: string[]
}
```

Search readiness is part of `HealthReport.subsystems`, not a second client-side health model:

- The report assembler derives it only from canonical cached executions/observations.
- A lightweight canonical Search live-status execution supplies current adapter/table/journal
  facts. The 30-second Overview fallback refreshes only this cheap source; it does not run a real
  canary every 30 seconds.
- Canary, consistency, spin, burn, and other deeper probes retain their declared doctor/source
  freshness and update the same cache during full or targeted checks.
- `GET /search-readiness` refreshes the lightweight source, rebuilds the canonical report, and
  returns `{ reportId, readiness: report.subsystems.search }`. It is a projection/refresh
  convenience, not an independently merged response.
- Overview, nav badge, CLI, notifications, and repair flows all read the incidents and Search
  projection from the same report.
- Root causes use distinct incident keys (for example availability, a specific table/index,
  journal quarantine, or a spinning backfill). Evidence shares an incident only when its title,
  impact, and primary resolution truly match.

### 8.1 States

- **Healthy** — Search is enabled and reachable, a fresh production-path canary succeeds,
  required logical tables point to active physical indexes, and there is no serious journal or
  engine finding.
- **Degraded** — queries still work, but one or more sources are rebuilding, partial, stale,
  backlogged, or under non-wedge load.
- **Unhealthy** — Search is disabled/unreachable, the canary is dark, a required index is missing
  or parked, writes are quarantined, or a spin/wedge condition is credible.
- **Unknown** — required evidence is absent, stale, invalid, or failed.

Classifier precedence is exact: a fresh Unhealthy stage wins; otherwise missing/stale/failed
required stage evidence yields Unknown; otherwise any Degraded stage yields Degraded; otherwise
all required stages must be Healthy. Every state includes source freshness. Its underlying
canonical incidents carry the contextual resolutions, so the projection does not duplicate them.
Every non-Healthy stage must reference at least one canonical incident ID; a classifier output
without an explaining incident is invalid and becomes Unknown.

### 8.2 Presentation

- Overview always shows the composite status and a compact labeled stage strip for Engine,
  Queries, Indexes, and Journal. Status is never color-only.
- Unhealthy/degraded Search incidents appear in the main incident list as well as the Search
  summary.
- System contains the detailed index/table/migration/outbox/enrichment data and reindex controls.
- Reindex/restart/repair mutations validate `res.ok`, show progress and outcome, and rerun the
  affected readiness evidence.

## 9. Incident and repair experience

Each incident row contains:

- aggregated observation status/disposition and plain-language title;
- one-sentence operator impact;
- affected resources and evidence freshness;
- one contextual primary action;
- expandable technical evidence.

Overview placement and ordering are deterministic:

1. `Needs action`: current or last-known `action_required` incidents; `error` before `warning`,
   then current/fresh before last-known/stale, then title and incident ID.
2. `Unable to verify`: Unknown incidents plus core-generated missing/stale/failed/invalid check
   incidents; execution/contract failures before stale-only entries, then oldest evidence and ID.
3. `Watching`: fresh `watch` warnings; then title and incident ID. A stale watch remains visible
   as last-known evidence but moves to `Unable to verify` until rechecked.
4. Advisories appear only in System and sort by subsystem, title, and incident ID.

The sort never uses arrival order, raw row count, or copy-derived severity. Each row shows the
incident's oldest evidence time and exposes per-observation times in its detail.

Primary resolution types are:

1. `Review repair` for deterministic repair handlers.
2. `Open <domain>` for a better owning surface such as Team diagnostics or Models -> Spend.
3. `Show resolution steps` for manual intervention.
4. `Check again` for retryable verification failures.

Repair behavior:

- Repair actions are registered by owner and namespaced as `${owner.id}.${localActionId}`.
  Checks owned by that owner may share an action; actions cannot be borrowed across owners.
- Planning is targeted by stable incident/observation IDs. A row action does not unexpectedly plan
  every unrelated repair.
- Bulk repair remains a secondary action.
- Safe items may be preselected.
- Manual/destructive items are never preselected and require individual explicit confirmation.
- Plan items identify incident IDs, observation IDs, owning check, safety, and exact changes.
- Correlated repair actions (for example two Search observations requiring the same engine
  restart) deduplicate by stable repair-action/plan-item identity and execute once.
- A plan response contains an opaque `planId`, `basedOnReportId`, `createdAt`, `expiresAt`
  (10 minutes), target selector, and per-item preconditions including the source execution IDs,
  observation status, and resolution key. The server retains the plan; the client cannot rewrite
  its changes or safety tier.
- Apply submits `planId`, selected item IDs, and a separate set of individually confirmed
  non-safe item IDs. A blanket `allowDestructive` switch is removed.
- Unrelated report revisions do not invalidate a plan, but changed/resolved/replaced targeted
  observations, changed resolution/preconditions, or expiry return typed `409 STALE_PLAN` and
  no mutation. The UI refreshes the incident and offers to re-plan.
- Apply results and the subsequent verification are both visible. `Applied` is not synonymous
  with `Verified healthy`.
- Unresolved findings remain visible. There is no dismiss/snooze escape hatch.
- Cron escalation and operator notification select fresh `action_required` incidents, not raw
  error rows or repairability booleans, and deduplicate/cool down by incident ID.

## 10. Data consumption and activity noise

### 10.1 Mounting and refresh

- Inactive tabs perform no tab-specific requests or polling.
- Emit explicit invalidations for doctor completion and repair verification. Reuse existing
  registry, Search, and execution events to invalidate the active tab. Activity may use its
  15-second fallback rather than introducing a high-volume SSE event for every recorded call.
- Fallback cadence is source-specific rather than one page-wide timer:
  - Overview live/runtime facts: 15 seconds.
  - Search readiness: 30 seconds.
  - Cached doctor report: 60 seconds plus events; fresh runs only by staleness or explicit action.
  - Agents: 60 seconds plus relevant events.
  - Activity: 15 seconds while mounted.
  - System inventory/detail: 60 seconds or explicit refresh after mutations.
- Request cancellation prevents stale tab responses from overwriting newer state.
- Remove unused `refreshInterval` and `showDetailedMetrics` settings. Preserve and document
  `usageHistoryScanMinutes`.

### 10.2 Routine classification

Extend usage recording with a producer-assigned activity class such as
`user | system | routine`; the UI must not infer routine work from display names.

- Health polling/status routes and heartbeat/status-refresh producers declare routine activity.
- `GET /usage-feed` defaults to excluding successful routine entries and accepts an explicit
  include-routine option.
- Failed routine activity bypasses that filter and is always returned.
- Activity adds time buckets for a failure-count/rate sparkline appropriate to the selected
  window.

## 11. Visual and interaction design

### 11.1 Existing patterns to adopt

- `PluginHeader` actions for `Run checks` and secondary refresh/detail actions.
- Use the shared Base UI `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` primitives for the
  four URL-synchronized tabs. Do not use `UnderlineTabs`; the selected state, arrow-key behavior,
  tab/tabpanel relationships, and focus handling must come from the accessible primitive.
- `SectionCard` for titled regions and “why this matters” captions.
- `StatTile` for small exact operational facts.
- `StatusBadge` for semantic states.
- `SegmentedControl` for time windows and activity kind.
- `EmptyState variant="section"`, `ErrorState`, and skeletons so loading, empty, failed, stale,
  and healthy remain distinct.
- `BakinDrawer` or existing disclosure primitives for raw evidence.
- Semantic tokens only; remove Health's hardcoded palette utilities and hand-rolled status maps.

Health may introduce local `IncidentRow` and `FreshnessLabel` patterns. Promote them to shared
SDK components only if the migrated Team diagnostics consumer uses the same semantics without
special cases; avoid creating speculative global primitives before the broader style-guide pass.

The current `PluginHeader` cannot wrap and its optional search has a fixed expanding width. This
project explicitly permits a minimal shared responsive enhancement—wrapping title/meta/actions,
bounding search to available width, and preserving the current visual hierarchy—because Health
cannot satisfy its container contract otherwise. Verify every existing `PluginHeader` consumer;
do not turn that fix into a broader header redesign.

### 11.2 Visualization policy

- Use trends for change over time, proportion bars for attributed vs unattributed activity, and
  status stages for Search readiness.
- Retain exact tables only when side-by-side comparison materially matters.
- Every graph has a plain-language takeaway and an always-available accessible data-table or
  disclosure equivalent. Values that exist only in a hover tooltip are a failure.
- If a shared chart keeps tooltips, each data mark is keyboard focusable and exposes the same
  label/value detail on focus; otherwise the chart remains a summary image and the adjacent table
  is the complete interaction surface.
- Colors are semantic, labeled, and never the only carrier of meaning.
- No decorative charts, gauges, synthetic scores, pseudo-precision, or raster artwork.

### 11.3 Container responsiveness

- The Health root establishes a named CSS container.
- Cards/grids respond to container width rather than viewport breakpoints.
- Below compact thresholds, comparison tables become stacked/expandable rows; raw System tables
  may use bounded internal scrolling instead of compressing columns.
- Header actions wrap, tabs remain keyboard reachable, labels do not truncate essential state,
  and no Health component has a fixed width that overflows its container.
- Validate Health at approximately 320, 480, 720, 1024, and wide container widths. Full-app phone
  validation may hide the known global activity panel solely to inspect the Health container;
  the shell limitation must remain documented, not misreported as fixed.
- Also capture the full app with the global activity panel open at each tested viewport. At phone
  width this is an expected known-shell failure, followed by a Health-only inspection with the
  panel hidden; at supported widths it must not overlap or compress Health into an unusable state.

### 11.4 Accessibility

- Keyboard access for tabs, disclosures, drawers, mutations, and repair confirmations.
- Visible focus state on every interactive control, including hover-reveal actions.
- Drawers/dialogs trap focus while open, restore focus to their invoking control on close, and do
  not lose the focused incident after a report refresh.
- Polite live regions announce only explicit user-triggered checks, plans, applies, and outcomes.
  Background polling/invalidation updates visible status text silently instead of announcing on
  every cadence.
- Incidents and charts have headings, status text, and non-color equivalents.
- Reduced-motion preferences are respected and covered by a browser/component assertion.

## 12. HTTP and public interface changes

- `GET /doctor` returns the canonical structured report; `fresh=true` joins/starts the
  single-flight sweep.
- `GET /checks` returns canonical registration metadata including owner, description, group,
  max age, and repair capability.
- `/summary` becomes live operational facts only; it no longer embeds a competing doctor model.
- `GET /search-readiness` refreshes the lightweight canonical source and returns the Search
  projection from the newly revised report; detailed Search status/telemetry endpoints remain for
  System and Activity.
- `POST /doctor/repair/plan` accepts the discriminated `HealthRepairTarget` and returns the opaque,
  expiring, server-held plan contract.
- `POST /doctor/repair/apply` accepts `planId`, selected item IDs, and individually confirmed
  non-safe item IDs. It returns typed `409 STALE_PLAN` without mutation when target preconditions
  changed or the plan expired.
- Repair apply/verify responses use stable canonical IDs, affected execution IDs, the resulting
  report ID, and verified incident state.
- `GET /usage-feed` adds activity-class filtering and time buckets.
- Replace broad `passthrough` schemas for Health report, Search readiness, and repair contracts
  with exact Zod response schemas.
- Update the CLI doctor commands, exec tools, hooks, Team diagnostics, nav badge, and all tests to
  the new single version. No old route/response adapter remains.
- Preserve explicit CLI semantics: exit `0` for Healthy/advisory-only, `2` for Degraded but
  operating, and `1` for Needs attention or Unknown/stale. JSON mode returns the canonical report.
- Update `plugins/health/bakin-plugin.json` so every actual route and changed capability is
  declared; align the server/manifest versions and bump both to the same minor version.

## 13. Project structure

Expected areas (the implementation plan will name exact files per checkpoint):

```text
packages/sdk/src/types/registration.ts     Canonical public health contracts
packages/sdk/src/utils/                    Typed health run/observation helpers
packages/sdk/src/testing/                  Plugin-author test harness contract
packages/core/src/adapters/                Adapter health contract consolidation
src/core/health-check-registry.ts          Owner-aware canonical registry
src/core/doctor-checks.ts                  Validation, execution, aggregation
src/core/doctor.ts                         Cache, freshness, single-flight, events
src/core/doctor-{repair,delegate,...}.ts   Stable-ID repair/escalation lifecycle
src/core/usage.ts                          Activity classification and buckets
plugins/*/                                 Migration of all first-party producers
plugins/health/index.ts                    Typed routes and composite responses
plugins/health/components/                 Four-tab action-first UI
plugins/health/types.ts                    Health plugin wire contracts
tests/core/                                Contract, runner, report, repair tests
tests/plugins/health/                      Route, classifier, and component tests
docs/src/content/docs/                     Operator and plugin-author documentation
.claude/knowledge/                         Doctor, plugin, usage, and UI knowledge
```

## 14. Code style

Prefer typed constructors with semantic fields visible at the producer. Do not recreate terse
message-only helpers:

```ts
return healthObserved([
  healthWarning({
    key: 'canary.partial',
    summary: 'Search answered, but some sources missed the query budget.',
    incident: {
      key: 'readiness',
      title: 'Search is degraded',
      impact: 'Results may be incomplete until every index can answer.',
      disposition: 'watch',
      resources: [{ kind: 'service', id: 'search', label: 'Search' }],
      resolution: {
        type: 'navigate',
        label: 'Review Search',
        href: '/health?tab=system&section=search',
      },
    },
    evidence: { omittedTables, degradedTables, tookMs },
  }),
])
```

Conventions:

- TypeScript strictness and existing formatting/lint rules.
- Stable semantic keys, not array indexes or display copy.
- Pure classifiers/aggregators separated from route and component code.
- Exhaustive discriminated-union switches.
- No component fetches hidden inside presentational rows.
- No swallowed fetch/mutation errors.
- No unrelated component splitting; extract only real domain or reusable units.

## 15. Testing strategy

### 15.1 Contract and core

- Compile-time negative cases plus Zod/runtime validation for every union and invariant; illegal
  healthy/error/unknown incident combinations cannot typecheck.
- Stable owner/check/observation/incident IDs.
- Explicit not-applicable behavior; empty/malformed/throwing checks fail Unknown while other
  checks complete.
- Multi-check incident grouping, resource deduplication, metadata-conflict failure, and unique
  incident counts.
- Overall status derivation across action, watch, advisory, unknown, stale, and mixed cases.
- Exact incident merge, freshness, placement, and stable sort rules.
- Freshness fallback/grace and per-source `maxAgeMs`.
- Cache replacement: successful replacement resolves absent rows; failed/invalid reruns retain
  last-known observations while preventing Healthy; not-applicable clears prior snapshots.
- Full-sweep and per-check single-flight concurrency across cron/manual/page/targeted callers,
  including overlapping joins and full-sweep timestamp semantics.
- Partial repair verification cache merge.
- Adapter checks appear through the canonical registry and the dead parallel service is absent.
- Architecture guard rejects legacy health result fields/types and message parsing for identity.

### 15.2 Producers and Search

- Migrate and update existing tests for all first-party health producers.
- Search classifier matrix for enabled/disabled, connected/unreachable, healthy/partial/dark
  canary, active/migrating/parked/missing indexes, pending/quarantined journal, busy/wedged/spin,
  and stale/missing evidence.
- Most-severe-credible-signal precedence.
- Search projection and incidents come from the canonical report; `/search-readiness` cannot
  diverge or require a client-side merge.
- Correlated Search repair deduplication and real-query verification.

### 15.3 Routes, CLI, and persistence

- Exact route schemas and status codes for cached/fresh/failed reports, targeted plan/apply, and
  Search readiness.
- Repair plan expiry and target-precondition tests: unrelated report changes remain valid;
  changed/resolved targets return `409 STALE_PLAN` with zero apply calls.
- CLI and exec-tool rendering uses structured fields and stable IDs.
- Notification/escalation deduplicates incidents by ID rather than messages.
- Legacy repair requests archive intact; new requests round-trip and verify with the new schema.
- Plugin manifest route parity test covers every Health route.
- Legacy registration input is rejected as an activation contract error; malformed output from a
  valid registration becomes Unknown without crashing the sweep.

### 15.4 UI

- URL-backed tab/window/kind/routine state.
- Base UI tab arrow-key/ARIA/tabpanel behavior and URL synchronization.
- Only active tabs fetch/poll.
- Loading, empty, error, stale, checking, healthy, watching, and action states are distinct.
- Overview always shows Search readiness.
- Incident grouping/counts and contextual actions.
- Exact session sum and corrected labels.
- Agents consolidation removes duplicate newest-session rendering.
- Routine-success filtering never removes failures.
- Mutation progress, error, apply, and verification feedback.
- Keyboard and accessible chart equivalents.
- Shared `PluginHeader` wrapping/bounded-search behavior across its existing consumers.
- Chart data is reachable without hover, focused marks (when retained) mirror tooltip values,
  drawers/dialogs restore focus, explicit-only live regions stay quiet during polls, and reduced
  motion is honored.

### 15.5 Real-browser verification

- Use the running `/health` page with real data.
- Verify wide and constrained container layouts, including the known-shell workaround for a
  phone-width Health-only inspection.
- Capture Overview, Agents, Activity, System, incident expansion, and repair-plan states with the
  global activity panel open at every viewport; then hide it only for the documented narrow
  Health-container inspection.
- Confirm no console errors, failed requests, overlapping content, unreadable tables, or
  off-tab polling.
- Compare request traces before/after and prove Health no longer dominates its own Activity view.

## 16. Commands

```bash
# Development
bun run dev

# Targeted contract/core/plugin tests during implementation
bun test --isolate tests/core/health-check-registry.test.ts tests/core/doctor-plugin-checks.test.ts tests/core/doctor.test.ts tests/core/doctor-repair.test.ts
bun test --isolate tests/plugins/health

# Static checks
bun run typecheck
bun run lint
bun run check:cycles

# Product builds
bun run build:plugins
bun run build:host

# Full regression
bun run test

# Documentation generation, validation, route parity, and build
bun run docs:check

# Refresh documented product screenshots after browser approval
bun run docs:screenshots
```

The implementation plan must add exact new test filenames to the targeted commands and include
real-browser commands/checkpoints.

## 17. Documentation impact

Update in the same project:

- `docs/src/content/docs/using/health.md` — new tabs, statuses, Search readiness, freshness,
  actions, repair verification, data scopes, and screenshots.
- `docs/src/content/docs/extending/plugins/server-contracts.md` — canonical registration/run
  examples, invariants, groups, resources, resolutions, and validation failures.
- `docs/src/content/docs/extending/sdk/overview.md` and generated SDK references — remove the old
  `HealthCheckResult` contract.
- `.claude/knowledge/doctor-and-health-checks.md` — canonical model, execution/cache/freshness,
  repair/delegation, and no-message-parsing rules.
- `.claude/knowledge/plugin-system.md` — registration metadata and adapter ownership path.
- `.claude/knowledge/agent-health-diagnostics.md` — structured agent resources and Health/Team
  consumption.
- `.claude/knowledge/usage-recording.md` — activity classes, filtering, and Health polling.
- `.claude/knowledge/style-guide.md` only for proven Health patterns and resolved Health token
  backlog; do not turn this project into the later global style-guide pass.
- Health manifest descriptions and route list.

README is currently unaffected because it does not describe the Health page or contract. Recheck
after implementation and update only if that changes.

## 18. Boundaries

### Always

- Validate public/plugin output at the boundary.
- Treat missing, stale, invalid, and failed evidence as non-healthy.
- Use stable IDs and structured resources/actions everywhere.
- Keep diagnostics report-only until the operator explicitly enters a repair flow.
- Verify repair outcomes with fresh affected checks.
- Use semantic tokens, shared UI patterns, honest loading/error states, accessible text, and
  container-responsive layouts.
- Preserve URL state and provide visible mutation feedback.
- Update tests, docs, generated references, and manifests with the implementation.
- Preserve the user's unrelated generated-file change.

### Ask first

- Add a dependency.
- Change the global shell/sidebar/activity-panel layout.
- Add durable incident acknowledgement/history or a broader persistence migration than the
  approved repair-request archive.
- Change configured doctor cadence or escalation policy defaults.
- Introduce any automatic repair or mutation during report-only checks.
- Expand the work into unrelated global style-guide cleanup.

### Never

- Add a backwards-compatibility shim or dual health contract.
- Parse result messages for identity, grouping, affected resources, repairability, or navigation.
- Infer Healthy from absence, a successful fetch alone, or adapter connectivity alone.
- Hide routine failures, fetch failures, invalid plugin output, or stale data.
- Auto-select destructive repairs or equate `applied` with `verified healthy`.
- Use a synthetic health score, decorative graph, or unexplained color.
- Write operational state from a diagnostic run.
- Hand-edit generated vendor/embedded assets or overwrite unrelated worktree changes.

## 19. Success criteria

- [x] Overview answers “what needs me?” without scanning technical inventory.
- [x] Search readiness is always visible and cannot report Healthy from connectivity alone.
- [x] Related rows group into stable incidents; counts match incidents, not raw evidence/chips.
- [x] Every active incident has one clear contextual next action.
- [x] Missing/stale/failed evidence never renders as Healthy or an empty success state.
- [x] Freshness shows actual check times; stale Overview evidence triggers a single-flight fresh
      report.
- [x] Repairs remain explicit, destructive choices remain individually confirmed, and affected
      checks verify the result.
- [x] Every one of the 39 current first-party registration sites is migrated or intentionally
      consolidated with its diagnostic signal covered; legacy health fields/types and the
      duplicate adapter service are gone.
- [x] CLI, exec tools, notifications, delegation, Team diagnostics, nav badge, Health UI, and
      routes consume the same canonical report.
- [x] Duplicate latest-session cards are consolidated and accurately labeled.
- [x] Agent usage/efficiency and cost scopes are understandable and non-contradictory.
- [x] Activity is failure-first; successful routine noise is hidden by default while routine
      failures remain visible.
- [x] Search and plugin technical inventory remains available under System, exceptions first.
- [x] Only the active tab polls; event invalidation and slower source-specific fallbacks replace
      the page-wide 10-second polling fan-out.
- [x] Health components remain usable at constrained container widths without compressed tables
      or fixed-width overflow.
- [x] Visualizations communicate real trends/proportions/status and include accessible text
      equivalents.
- [x] Existing relevant tests pass; new contract, Search, repair, route, UI, and browser coverage
      passes; typecheck, lint, cycle check, builds, and docs checks pass.
- [x] Health user docs, plugin-author docs, knowledge files, generated SDK references, manifest,
      and screenshots match the shipped behavior.

## 20. Out of scope

- Global shell mobile/sidebar/activity-panel redesign.
- The repository-wide palette/token/style-guide sweep.
- Durable incident acknowledgement, snoozing, or incident history.
- A separate Search administration plugin/page.
- Changes to Models' canonical spend/budget engine.
- Replacing the process-local usage recorder with durable activity telemetry.
- Automatic destructive repair.

## 21. Open questions

None. Product and contract decisions above were resolved during the kickoff interview. Any new
scope discovered during planning must update this spec and return for approval before build work.
