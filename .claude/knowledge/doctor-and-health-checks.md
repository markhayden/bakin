# Doctor & Canonical Health

## Purpose

Doctor is Bakin's diagnostic execution engine. It runs owner-registered checks, validates their structured observations, retains honest last-known evidence, and publishes one immutable `HealthReport` used by the CLI, HTTP routes, dashboard, badge, delegation, notifications, and repair workflows.

The important invariant is **one contract, one registry, one report**. There is no flat-result compatibility response, adapter-specific health plane, or UI message parser. Producers describe evidence; core owns identity, freshness, orchestration, and projection; consumers read the canonical report.

Approved design: `.claude/specs/health-action-first-ui.md`.

## Contract home and ownership

The public producer and consumer types live only in `packages/sdk/src/types/health.ts` and are re-exported from `@makinbakin/sdk` / `@makinbakin/sdk/types`.

Registrations have a core-stamped owner:

- `plugin:{pluginId}` for `ctx.registerHealthCheck()` and `ctx.registerHealthRepairAction()`
- `adapter:{adapterId}` for checks selected while composing a runtime adapter
- `core:{coreId}` for host-owned checks such as onboarding

Core namespaces local check/action IDs with the owner ID. An owner-local `storage` check from the `docs-basic` plugin becomes `docs-basic.storage`. Observation and incident keys are stable within the registered check; display text is never identity.

`src/core/health-contract.ts` performs exact runtime validation before registration or report publication. It validates IDs and bounds, group metadata, same-origin navigation, resources, owner-local repair references, JSON-safe/redacted evidence, and evidence size. Invalid registration fails activation and is visible through plugin activation health.

## Producer contract

`HealthCheckRegistrationInput` requires:

```ts
{
  id: string
  name: string
  description: string
  group: { key: string; label: string }
  maxAgeMs?: number
  run(): Promise<HealthCheckRunInput>
}
```

A run is either:

- `{ outcome: 'observed', observations: [first, ...rest] }`
- `{ outcome: 'not_applicable', reason }`

Empty observed output is unrepresentable. Use the constructors from `@makinbakin/sdk/utils`:

- `healthHealthy` — current evidence with no incident
- `healthWarning` — advisory, watch, or action-required incident
- `healthError` — action-required incident
- `healthUnknown` — watch incident when evidence cannot be verified
- `healthObserved` / `healthNotApplicable` — run wrappers

Every observation has a stable key and human summary. Add structured `resources` to incidents and JSON evidence when consumers need attribution or detail. Agent attribution, for example, uses `{ kind: 'agent', id, label }`; no consumer parses an agent name from prose.

Checks are diagnostic only. They must not repair, install, retry, reindex, restart, or otherwise mutate the state they inspect.

## Registry and lifecycle

`src/core/health-check-registry.ts` owns the two registries:

```text
checks                         repair actions
  registerOwnedHealthCheck       registerOwnedHealthRepairAction
  listHealthChecks               listHealthRepairActions
  unregisterOwnerHealth          unregisterOwnerHealth
```

`src/lib/plugin-context-factory.ts` binds plugin ownership. Runtime composition binds adapter ownership. Hot reload removes both registries for the owner and tells the report cache to delete removed snapshots, so an unloaded plugin cannot leave a ghost finding.

The selected Pi adapter checks contribute unique adapter facts (home, agents root, auth, models, and extension trust). Generic runtime/channel checks remain Health-owned. OpenClaw does not duplicate those generic signals, and Search adapters do not expose a second health service.

## Execution and report pipeline

```text
runDiagnostics() / runTargetedDiagnostics()
  -> list owner-aware definitions
  -> runHealthCheck() per definition
  -> validate and stamp execution + observation identity
  -> applyHealthCheckRun() to per-check cache
  -> getHealthReport() immutable projection
  -> emit health.report.changed
```

Key files:

- `src/core/doctor.ts` — cron, full/targeted coordination, audit, optional notification
- `src/core/doctor-checks.ts` — isolated check execution and validation
- `src/core/doctor-report-cache.ts` — per-check current/last-valid state and report revisions
- `src/core/health-report.ts` — incident merge, placement, sorting, counts, overall precedence
- `src/core/health-search-readiness.ts` — Engine/Queries/Indexes/Journal projection

A thrown, malformed, conflicting, or empty result becomes a core-owned **Unable to verify** incident. Other checks continue. The failure execution and latest valid snapshot are stored separately: failed current evidence does not erase previously valid evidence, but retained evidence is clearly stamped `snapshot: 'last_known'` and becomes stale at its original TTL plus grace.

Full sweeps are globally single-flight. Targeted runs are single-flight per check. A targeted run overlapping a full sweep joins the same check execution without corrupting `lastFullSweep`. A full-sweep marker is committed only if the registry membership stayed unchanged for the entire sweep.

Every report change increments its revision and emits `health.report.changed`; cached reads never execute checks.

## Report semantics

`HealthReport` contains:

- report ID, revision, generated time, and last completed full sweep
- overall status and exact check/incident summaries
- check execution states and latest valid snapshots
- canonical observations and merged incidents
- subsystem projections, currently Search readiness

## Sensitivity & incident classes (#690)

Producers may stamp `class` on incident inputs (SDK `HealthIncidentClass`,
10 values — service_failure, data_integrity, budget_block, evidence_gap,
usage_anomaly, unattributed_usage, runaway_usage, cleanup_backlog,
policy_denial, unsupported_surface). The ONE sensitivity policy
(`projectEffectiveDispositions` in `src/core/health-report.ts`, applied once
in `getHealthReport` under `settings.doctor.sensitivity`:
`developer | standard | quiet`, default standard) computes every incident's
`effectiveDisposition`:

- standard/quiet cap usage_anomaly, cleanup_backlog, policy_denial, and
  unsupported_surface at **advisory**; caps only ever LOWER urgency.
- Unclassified incidents are treated service_failure (a missing stamp can
  never hide an outage); error-status incidents are never demoted;
  evidence_gap is deliberately uncapped — its producers split raw severity
  (rule-affecting = watch, informational = advisory) per D12.
- Raw `disposition` is preserved on the wire; the UI shows a "Calmed from
  watch" badge + a plain-language class chip on cards, and demoted/advisory
  incidents ride the Overview notices popover (the `advisories` view-model
  bucket) — demotion means quiet, never hidden. A runtime that
  intentionally lacks a surface should return `not_applicable`, not an
  unsupported_surface failure. Repair delegation (`all_actionable`) and the
  CLI act on effective disposition too — a calmed incident never spawns a
  paid repair task.
- **Quiet (D10)** additionally lives at the NOTIFICATION layer: the nav
  badge and escalation act only on effective `action_required` — watch
  stays visible on the Health page but silent.
- The semantic projection key includes sensitivity + effective dispositions:
  flipping the System & Alerts dropdown republishes on the next read, no
  restart. Conflicting class stamps on one incident id are a producer bug
  (`HealthIncidentConflictError`); invalid class strings are rejected at the
  producer contract boundary (zod enum in health-contract).

Overall precedence is operator-facing. Urgency is computed over EFFECTIVE
dispositions, but evidence honesty is NOT demotable — unknown-status/stale
incidents drive `unknown_stale` in every mode (unknown is never healthy):

1. effective action-required incident -> `needs_attention`
2. required evidence missing/failed/invalid/stale -> `unknown_stale`
3. fresh effective-watch incident -> `degraded`
4. otherwise -> `healthy`

Advisories remain visible in detail but do not make the overall state unhealthy. Unknown is never collapsed into warning or healthy.

Incident IDs derive from owner/check/stable keys, not titles or messages. Resources and compatible resolutions are deduplicated while projecting the report. This lets UI focus, notification dedupe, repair preconditions, and delegation survive copy edits.

## Explicit repair protocol

Repair actions are separate `HealthRepairActionDefinition` registrations with `plan(target)` and `apply(items)`.

1. A consumer targets incident IDs, observation IDs, or all actionable incidents from a specific report.
2. Core asks only referenced owner actions to plan concrete `HealthRepairPlanItem`s.
3. `src/core/doctor-repair-plans.ts` stores the opaque plan server-side for ten minutes and binds each item to observation execution/status/resolution preconditions.
4. Safe items may be preselected. Each manual/destructive item requires explicit confirmation.
5. Apply rechecks expiry and only the affected evidence. Changed/resolved evidence returns typed `STALE_PLAN` with zero action calls.
6. Applied actions report their own success/failure and affected check IDs. Core reruns those checks and returns verification separately.

Never infer repairability from status or text. Never attach a mutation callback to a check result. Delegated repair records use the v2 store; bytes in the old v1 directory are an immutable archive and are not parsed by current code.

## Search readiness

Search deliberately has one readiness story:

- **Engine** — Health's cheap `search` check owns enablement, installation, connectivity, supervision, and write-journal state.
- **Queries** — `search-canary` runs a real query through the production path.
- **Indexes** — the live check plus `search-consistency` / `search-spin` cover mappings, migrations, and zero-progress builds.
- **Journal** — pending/old/quarantined writes from the canonical live Search observation.

The old standalone Search-outbox and Memory Search-table registrations were absorbed by the live Health Search check. Deep canary/consistency/spin/engine-burn checks remain independent because they have different cost and freshness. Every non-healthy readiness stage references canonical observations/incidents.

Overview always displays the four stages. System owns detailed indexes, migrations, journal, enrichment, and explicit reindex operations.

## First-party producer inventory

There are 40 direct first-party plugin registration sites after the two approved Search consolidations, the addition of GitHub readiness and runtime-cron tracking, and the work-class routing check:

- Health: 22 system/runtime/work-cost/Search/plugin checks
- Team: 4
- Tasks: 4
- Workflows: 3
- Schedule: 2
- Assets, Brands, Git, Images, Models: 1 each

Health's local IDs are `content-dir`, `capabilities`, `github-readiness`, `service`, `runtime`, `session-store`, `channel-approvals`, `channel-aliases`, `restart-recovery`, `execution-safety`, `context.startup-size`, `budget`, `usage.agent-burn`, `search`, `search-consistency`, `search-spin`, `search-canary`, `search-engine-burn`, `skill`, `plugin-assets`, `plugin-artifacts`, and `plugin-registry`.

Health registers six local repair actions: journal revival, consistency rebuild, spin rebuild, canary restart, engine-burn restart, and runtime skill sync. Other plugin owners register their own actions beside their checks.

The Brands `integrity` check uses the same `plugins/brands/lib/integrity.ts` scan as the brand integrity route. It reports unreadable manifests, dangling assets, tasks blocked by missing/draft brands, and stale drafts as structured observations and incidents; no consumer parses its summary text.

The `capabilities` check projects the shared capability-readiness engine per installed pack. `github-readiness` is informational when `gh` is absent, but reports an action-required incident with explicit authentication instructions when the CLI is installed and unauthenticated. `bakin check capabilities` uses the same onboarding component rather than a parallel probe.

The Models `routing` check (`models.routing`, `plugins/models/lib/health-checks.ts`) warns on unrouted recommended system work classes (with per-class 7d spend evidence), errors on routes targeting unavailable models, and warns on standing thinking clamps and premium-tier models observed on cheap-recommended classes. Its `apply-recommended-routes` repair action applies the same recommendation engine the Routing tab's `POST /routing/recommend` preview uses. See `.claude/knowledge/models-plugin.md` § Routing.

## Public consumers

- `GET /api/plugins/health/doctor` returns the raw canonical report; `fresh=true` joins a full sweep.
- `/summary` contains live process facts, not a second doctor projection.
- `/search-readiness` projects the Search subsystem from a canonical report.
- `/checks` returns canonical registration metadata.
- Repair plan/apply routes are exact POST contracts; stale plans return HTTP 409 with `STALE_PLAN`.
- `bakin_exec_health_doctor` and CLI doctor consume the same report.
- Health Overview, System, nav badge, Team diagnostics, escalation, and delegation filter structured incidents/resources.

Do not create a route-specific compatibility mapper or parse a diagnostic message. A consumer that needs new data should extend the canonical structured contract and its validation/tests.

## Activity is a related but separate contract

Every usage-recorder producer declares `activityClass: 'user' | 'system' | 'routine'`. Successful routine work is excluded from default Health Activity; routine failures always remain. See `.claude/knowledge/usage-recording.md`.

## Audit, notification, and escalation

Each completed full sweep appends `doctor.run` with report ID, registered count, incident counts, and overall status. Notification/escalation considers fresh `action_required` incidents and deduplicates by stable incident ID. It does not classify issues from severity text or whether an old row advertised an inline fix.

The doctor cron retains its global settings under `settings.doctor`:

- `intervalMs` — full-sweep cadence
- `requireOnboard` — whether the core onboarding check applies
- `escalation` — `off`, stable-ID notification, or delegated repair task
- `escalationCooldownMs` — minimum interval before a closed/missing covering request may be replaced
- `escalationStaleAfterMs` — maximum age for an open covering task to suppress a still-burning incident set

Task escalation compares exact incident IDs. A fresh open task that covers every current action-required incident suppresses duplication. `done` and `archived` tasks are closed, while an open task older than `escalationStaleAfterMs` is treated as stalled and re-escalated after the normal cooldown. Scanning continues past a stale request so a newer fresh covering task still wins. Delivery and delegation failures are logged without aborting the doctor cron; failed notifications release their reservation so the next run can retry.

## Authoring checklist

1. Put the domain engine with its owner; keep the check a thin projection.
2. Choose stable local check, observation, and incident keys.
3. Supply name, description, group, and realistic `maxAgeMs`.
4. Return at least one observation or explicit not-applicable.
5. Model every branch, including unavailable dependencies, without invented success.
6. Attach resources/evidence for attribution; keep evidence bounded and secret-safe.
7. Use same-origin navigation, explicit instructions, rerun, or an owner-local repair reference.
8. Register mutations separately and state concrete planned changes/safety.
9. Add direct branch tests and plugin activation/unregistration coverage.
10. Run `tests/architecture/health-contract.test.ts` so no compatibility plane is reintroduced.

## Test map

- `tests/core/health-contract.test.ts` — exact runtime input validation
- `tests/core/health-check-registry.test.ts` — ownership, namespace, unregister
- `tests/core/doctor-plugin-checks.test.ts` — isolated execution/invalid output
- `tests/core/health-report.test.ts` — report merge, sort, precedence, IDs
- `tests/core/doctor-cache.test.ts` — snapshot retention, TTL, flights, events
- `tests/core/doctor-repair-plans.test.ts` / `doctor-repair.test.ts` — targeting, confirmation, staleness, verification
- `tests/core/doctor-delegate.test.ts` / `doctor-escalation.test.ts` — structured downstream consumers
- `tests/plugins/{owner}/health-checks.test.ts` — direct producer branches
- `tests/architecture/health-contract.test.ts` — retired vocabulary and planes

Storage-touching tests must isolate content directories and global registries. Use the SDK test context to capture checks and repair actions separately.

## Decision record

The single-version cutover replaced a flat message-oriented result array, inline repair metadata, a second adapter service, whole-report caching, and message-derived identity. Those shapes were intentionally removed rather than adapted: dual contracts made status, freshness, ownership, and repair safety impossible to trust consistently across UI, CLI, and automation.
