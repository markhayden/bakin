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

- `src/core/doctor.ts` — cron (`runCycle` = sweep → escalation → auto-close), full/targeted coordination, audit
- `src/core/doctor-escalation.ts` — per-incident cover + the escalation policy (auto-apply / approval tasks / delegate)
- `src/core/doctor-approvals.ts` — `health-repair` / `health-navigate` approval kinds, review-task opening, interrupted-apply recovery
- `src/core/doctor-autoclose.ts` — fresh-verification auto-close of repair requests (shared by the manual verify)
- `src/core/doctor-repair-store.ts` — durable repair requests (`kind`, `status`, `checkIds`, `approvalId`, frozen `proposal`)
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

## Acknowledge & snooze — the "I know" verb (health trust overhaul, 2026-07-24)

Per-incident ack/snooze keyed on stable incident ids; ONE flat store
(`~/.bakin/health/acks.json`, `src/core/health-acks.ts`) and ONE join point
(`getHealthReport`, beside sensitivity). The projected `ackState`
(`'acked' | 'snoozed'`, optional on `HealthIncident` + the wire mirror in
`plugins/health/lib/route-schemas.ts` — keep both in LOCKSTEP, rc.25
lesson) is what every consumer filters on; nobody re-derives.

- **Tiered:** advisory/watch/unknown incidents ack (silent until material
  change) or snooze (24h/7d). `action_required` is SNOOZE-ONLY (7d cap)
  and re-fires on ANY evidence change — money/outages are never
  permanently silenceable (enforced at store, route, and type level).
- **Re-fire (one comparison, `resolveAckState`):** acks return when the
  effective tier escalates past `tierAtAck` or the resource-set
  fingerprint changes; count drift within a tier stays silent. Snoozes
  expire (resolved at next report access — up to one doctor tick of lag).
  Invalid records prune lazily.
- **Suppression is total but transparent:** acked incidents leave the
  badge, Fix first, notices, and the escalation relay; they render in the
  overview's collapsed "Acknowledged (N)" section with un-ack one click
  away, and they are excluded from `overallStatus` (an all-acked box reads
  calm). A corrupt ack store FAILS OPEN toward visibility: acks ignored,
  everything re-surfaces, warn logged.
- **Verified, never trusted (#898):** `acks.json` is a plain file anything
  running as this user can write, so ONE validator (`ackRecordProblem`)
  gates both `writeAckRecord` and every read: key equals `incidentId`,
  `at` is a real time not in the future, `action_required` is snooze-only,
  snoozes run `0 < until − at ≤ 7 days`, and `action_required` snoozes
  carry `evidenceSha`. A failing record suppresses NOTHING (the incident
  shows) and stays in the file — writes and prunes never drop it, and the
  projection never prunes it (its key may not even name the incident it
  claims) — so the Health `acks` check (`health.acks`, watch /
  `evidence_gap`), `GET /doctor/acks` `invalid[]` and `bakin doctor acks`
  name it until `bakin doctor unack <id>` clears it. A valid record says
  nothing about who wrote it; records carry no `actor` — it would be
  self-asserted.
- Surfaces: `POST /doctor/ack` (`action: ack|snooze|clear`),
  `GET /doctor/acks`, card controls, and `bakin doctor
  acks|ack|snooze|unack`. Ack writes republish immediately (ackState rides
  the semantic projection key).

**Severity philosophy (same overhaul):** the dashboard lights up only for
things the user can and should act on. Self-resolving warming states
(transcript scan after boot, run-workspace first sweep) are ADVISORY
unknowns (the contract now allows advisory on unknown incidents — never
action_required); every standing card carries a deterministic resolution
where one exists (premium-on-cheap → apply-recommended-routes; spend
pricing gaps → spend-evidence-refresh-pricing; spend lane fossils →
accept-unattributed-history, widens authorization → one-click, writes
`BudgetPolicy.acceptUnattributedBefore`); enrichment is ONE self-healing
coverage stat (assets plugin, daily no-force retry pass), never a
per-asset nag. Thresholds are constants, not settings (simplicity
mandate): enrichment advisory below 60% on 5+ enrichable assets;
premium-on-cheap escalates advisory→watch past $5 of KNOWN attributed
spend per 7d.

## Sensitivity & incident classes (#690)

Producers may stamp `class` on incident inputs (SDK `HealthIncidentClass`,
10 values — service_failure, data_integrity, budget_block, evidence_gap,
usage_anomaly, unattributed_usage, runaway_usage, cleanup_backlog,
policy_denial, unsupported_surface). The ONE sensitivity policy
(`projectEffectiveDispositions` in `src/core/health-report.ts`, applied once
in `getHealthReport` under `settings.doctor.sensitivity`:
`developer | standard`, default standard — the `quiet` mode was retired in
#1007 because it was identical to standard; a settings file still saying it
falls back to the default) computes every incident's `effectiveDisposition`:

- standard caps usage_anomaly, cleanup_backlog, policy_denial, and
  unsupported_surface at **advisory**; caps only ever LOWER urgency. The
  navigation badge and the board escalation act on action_required only, in
  either mode.
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
- **The notification rule (D10)** is mode-independent: the navigation badge
  and the board escalation act only on effective `action_required` — watch
  stays visible on the Health page but silent, under developer and standard
  alike (this was the whole of the retired `quiet` mode).
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

Repair actions are separate `HealthRepairActionDefinition` registrations with `plan(target)` (bounded and LOCAL — no network, no engine calls; search-consistency plans from the check's recorded evidence and re-validates in apply), a required `operationPlan(items)`, optional `resources` (authorized against the owner at registration: core resources for core code/adapters/core plugins only, `<ownerId>:*` for plugins), and `apply(items, op)` that reports through the op context (#895).

1. A consumer targets incident IDs, observation IDs, or all actionable incidents from a specific report.
2. Core asks only referenced owner actions to plan concrete `HealthRepairPlanItem`s.
3. `src/core/doctor-repair-plans.ts` stores the opaque plan server-side for ten minutes and binds each item to observation execution/status/resolution preconditions.
4. Core stamps every canonical item's `effects` (the item's own, else the action's) and its `mode` through the ONE policy `repairMode` (`packages/core/src/health/repair-mode.ts`: `self-heal` unless it deletes user content, spends money or widens authorization → `one-click`). Self-heal items may be preselected; each one-click item requires explicit confirmation (`confirmedItemIds`). Clients never re-derive the mode.
5. Apply rechecks expiry and only the affected evidence. Changed/resolved evidence returns typed `STALE_PLAN` with zero action calls.
6. Applied actions report their own success/failure and affected check IDs. Core reruns those checks and returns verification separately. **The ONE authorization gate runs in the apply path for every caller** (`authorizeItems` in `doctor-repair.ts`, spec §3.2 / plan R3 N2): an action that declares `mutation` (upgrade/sync/reinstall/restart/rebuild/delete/policy) is judged per item by `authorizeMutation` for the applying actor (`system` origin, an `agent` acting for its task, or the `operator`); until consent records exist (PR6) an unattended upgrade/sync/reinstall is refused `consent-unreviewed` and comes back as a `skipped` result carrying `authorization: { refused: true, reason }` with the copy table's words — the old escalation routes it to the one-click approval, never counts it as a failed attempt.
7. **Apply is an operation** (`startDoctorRepair`, `src/core/doctor-repair.ts`): a parent (`apply` → `verify`, `REPAIR_PARENT_PLAN`) whose fingerprint `repair:<planId>:<sorted itemIds>` is claimed BEFORE the plan is consumed (two tabs → one run), one child per selected action (its own plan + resources, run in sequence), outcome by the D22 precedence table (`ok` / `nothing_applied` / `partially_applied` / `apply_failed` / `verification_failed` / `cancelled`), and the `DoctorRepairApplyReport` as `result.body` (rows kept on every outcome). `POST /doctor/repair/apply` answers 202 `{ operationId, bootId }` (200 attached; 409 STALE_PLAN / CONFIRMATION_REQUIRED unchanged). The dialog follows it with `useOperation` + `OperationProgress` and can close mid-repair; `bakin doctor --fix` follows it with the CLI renderer; escalation awaits it in-process (`awaitDoctorRepair`, origin `system`). No client deadline, no "outcome unknown" guess.

Every repair action passes the runtime contract (`tests/helpers/repair-contract.ts`: applied inside a real operation built from its own plan — it must report, enter only declared stages in plan order, and never throw from an op call).

Never infer repairability from status or text. Never attach a mutation callback to a check result. Delegated repair records use the v2 store; bytes in the old v1 directory are an immutable archive and are not parsed by current code.

## Decision choices and return verification (Codex r1 fold, 42ceddc73)

A human decision is often a NAMED pair the re-homing table spells out ("Claim / Use as guest", "Drop / Keep", "Keep my edit / Restore shipped", "Disable plugin", "raise / ack / resume"). Those are **decision choices**: `resolution.choices?: HealthDecisionChoice[]` (≤4, unique keys, on either outcome) — `{ kind: 'link', href, field? }` lands on a control, `{ kind: 'request', method, url, body?, tone?, effects, confirm? }` performs the decision through the OWNER's own route — the runner refuses a url whose CANONICAL pathname (`canonicalDecisionPath`: `..`/`.` segments resolved, no percent-encoding in the path, same origin) lies outside `/api/plugins/<ownerId>/…` (core/adapters own `/api/…`) unless it is one of core's shared decision controls (`SHARED_DECISION_CONTROLS`: `/api/plugins/{disable,enable}`), and the contract requires `confirm` whenever any declared effect is true or `tone` is `danger` (`plugins/health/lib/decision-choice.ts`; the incident row renders a button per choice, asks in `ConfirmDialog` when `confirm` is set, shows the route's refusal verbatim, and the page reruns the checks after a success). Choices never add a third outcome: they are the controls of the decision, named on the card instead of hidden behind it. A durable "Keep" is a recorded decision the check honours (kept table names, an accepted shipped sha), never a generic ack.

**Return verification** for a handoff lives outside the row (`plugins/health/components/handoff-return.ts`): the row ARMS the incident when the command actually reached the clipboard (`onCopied` through `CopyButton` → `CodeBlock` → `HandoffCard`) or a Terminal session opened (and disarms it when the session was refused); the Health page's `useHandoffReturn(runChecks)` reruns once per arming — on mount (back from `/terminal/…`), on window focus (back from the operator's own shell) or when the tab becomes visible. A row can never own that listener: it unmounts with the navigation, and a clipboard write fires no DOM event it could see.

**Canonical plan items** carry two ids: `id` (core's opaque `<canonicalActionId>:<localId>`) and `localId` (the planner's own handle). An action's `apply()` reads `item.localId`; a targeted planner resolves its subjects THROUGH the report (`src/core/doctor-repair-targets.ts`: `incidentsNamedBy` / `subjectIdsNamedBy`), never by parsing incident ids. `mutation` is REQUIRED on every action — `'none'` is the explicit, reviewable "nothing here needs authorization"; the gate itself (not the caller) states the two item rules: a one-click ITEM is refused to every unattended actor whatever the kind (`operator-only`), and `none` with a self-heal item is allowed.

## Search readiness

Search deliberately has one readiness story:

- **Engine** — Health's cheap `search` check owns enablement, installation, connectivity, supervision, and write-journal state.
- **Queries** — `search-canary` runs a real query through the production path.
- **Indexes** — the live check plus `search-consistency` / `search-spin` cover mappings, migrations, and zero-progress builds.
- **Journal** — pending/old/quarantined writes from the canonical live Search observation.

The old standalone Search-outbox and Memory Search-table registrations were absorbed by the live Health Search check. Deep canary/consistency/spin/engine-burn checks remain independent because they have different cost and freshness. Every non-healthy readiness stage references canonical observations/incidents.

Overview always displays the four stages. System owns detailed indexes, migrations, journal, enrichment, and explicit reindex operations.

## First-party producer inventory

There are 41 direct first-party plugin registration sites after the two approved Search consolidations, the addition of GitHub readiness and runtime-cron tracking, the work-class routing check, and the schedule prompt check:

- Health: 22 system/runtime/work-cost/Search/plugin checks
- Team: 4
- Tasks: 4
- Workflows: 3
- Schedule: 3
- Assets, Brands, Git, Images, Models, Spend: 1 each (Spend's `spend.budget` moved out of Health in the spend ownership series; Health gained `spend.policy-available`, which names the gate's fail-closed state when the spend plugin is not answering — a plugin cannot report its own activation failure)

Health's local IDs are `content-dir`, `acks` (#898 — names ack records that broke the acknowledge rules), `media.sharp` (#889 — image processing; one-click store install repair `media-install-store`), `capabilities`, `github-readiness`, `service`, `runtime`, `session-store`, `channel-approvals`, `channel-aliases`, `restart-recovery`, `execution-safety`, `context.startup-size`, `spend.policy-available`, `usage.agent-burn`, `search`, `search-consistency`, `search-spin`, `search-canary`, `search-engine-burn`, `skill`, `plugin-assets`, `plugin-artifacts`, and `plugin-registry`.

`plugin-artifacts` verifies every installed Whiskit artifact against this host and, for a stranded (needs-update) github plugin, reads the updates engine's `plugin:<id>` record (#1007 — `PluginArtifactDeps.record`; the check never probes an artifact index itself, and the private TTL cache is gone): an `update-available` record is the one-click `plugin-upgrade` offer (a `compatible-rebuild` under the installed version included), a `blocked` record is "wait for a compatible release" with the engine's reason, and no record / no successful observation is Unknown with the `plugin-reinstall` repair (re-stage the recorded install) — never a fake upgrade. `pluginUpgradeOffer` is the ONE offer answer: `plugin-assets` (`plugin-bins-invalid`, `skill-source-invalid`) and `plugin-registry` (`activation-failed`) choose `plugin-upgrade` vs `plugin-reinstall` from it; the capabilities check names `package-sync` / `package-reinstall` from `capabilityRemedy` (self-healing PR1 slice 1.3b). Slice 1.3c added the core/adapter/channel repairs under the old contract: `health-acks-reset` (file moved aside, never deleted) / `health-acks-prune`, `service-setup` (the ONE engine `src/core/service-setup.ts` shared with `bakin setup service`; the repair never kills or doubles a running server — a loaded job is left alone, a server outside the service defers the load), `runtime-restart` (`runtime.restart()` + ping), `session-store-prune` (the optional adapter member `sessions.pruneStore` — Pi implements it; OpenClaw keeps its text), `discord-bridge-reconnect` (`reconnectDeliveryBridge`, the helper the `/api/channels/reconnect` long-poll runs; credential failures keep the Settings → Channels handoff), and the core-owned `core.onboard` (what `bakin onboard --yes` runs, each component its own operation). Slice 1.3d: `requeue-stranded-tasks` (health-owned beside the restart-recovery check; `recoverStrandedTasks` settles the named tasks through the same engine as the boot pass and reports each outcome — recoverable candidates only, exhausted/manual ones stay the operator's), spend's `budget-resume` (the kill switch off) and git's `git-release-worktree` (a missing TASK worktree released through the agents' release verb, forced; a terminal-session one keeps its text). Slice 1.4b-2 turned the remaining decision rows into existing repairs: `unclaimed-tables` → `search-drop-unclaimed-tables` (Keep = acknowledge), an installable `service-ownership` refusal → `search-engine-claim` (other refusals keep their steps), and `user-edited-drifted` → `install-plugin-assets`, whose plan adds one MANUAL `restore:<skill>` item per drifted user-edited skill ONLY for a targeted row (never under all-actionable) — apply passes `restoreUserEdited` to `applyPluginAssets`, which releases the lock by removing the skill before the install writes the shipped copy (`InstallReport.restored`). "Disable plugin" for an upstream-blocked artifact (row 98) is deferred to PR6 with the plugin lifecycle verbs. Slice 1.4c-1: every `instructions` resolution that carries a `command` renders the kit's `HandoffCard` on the Health card (`plugins/health/components/incident-row.tsx` + `use-terminal-handoff.ts`): the exact command, copyable; when the Terminal plugin is active (one manifest read per page, only for an expanded command card) an "Open in Terminal" action creates a human shell session, types the command WITHOUT submitting it, and navigates to `/terminal/<id>`; copy or handoff arm a one-shot rerun of the incident's check on the next window focus (return verification). Pi's install/provider rows and the gateway-floor rows ride this unchanged; the OpenClaw grant row keeps its steps until a verified command exists. 1.4c-2/3 (the remaining human rows land on their control, never a page top): the capability incident's `?capability=<raw slug>` highlights and focuses that pack's row in Explore → Capabilities, where every installed row now carries the readiness engine's verdict (`GET /api/packages/capabilities`: Ready, or Not ready + the remediation lines + a key link to Settings → Integrations & Keys); the alias incident lands on the aliases editor (`&field=notifications.channelAliases.aliases` — the Channels tab maps the prefix); the Discord guild-unjoined incident lands on the servers field, where a "Not joined" server shows an "Invite the bot" link the BRIDGE builds from the READY payload's bot user id (`botInviteUrl` in `src/core/delivery/index.ts` → `GuildReadiness.inviteUrl` on the readiness snapshot — View Channels + Send Messages, one guild, no token involved; the adapter-boundary test bans a raw Discord endpoint anywhere but the bridge, so UIs only render the link); the runtime-credentials incident lands on `/runtime?tab=overview&field=credentials`, which outlines and focuses the credential tiles. **Declared incident catalogs (1.5, unactivated until the 1.7 cutover):** a registration may carry `incidents: HealthIncidentDeclaration[]` — FINITE families `{ id, subjectKind, resolution: repair{actionId} | human{needs}, required: always|never|owner-decides }` (`not-ready` covers every `not-ready:<capability>` instance). The registry validates the catalog in the SAME synchronous call the plugin context makes inside `activate()` (`validateIncidentCatalog` in `health-check-registry.ts`), so a refused catalog FAILS the owner's activation with the declaration NAMED: a human family without `needs`, a duplicate id, an unknown subject kind, or a repair family whose action is neither registered for that owner nor a shared engine action (`SHARED_ENGINE_ACTIONS` = `core.diagnose`, referenced VERBATIM by every owner — the runner's namespacing skips it). Register actions BEFORE the checks that declare them. An emitted incident may name its family (`declarationId`); the runner (`assertDeclaredInstance` in `doctor-checks.ts`) refuses an instance whose resolution contradicts it — wrong action, a human family emitted as repair/rerun, an undeclared id — as `outcome: 'invalid'` with code `INVALID_HEALTH_DECLARATION` and the usual verification incident; a human family accepts the pre-cutover `navigate`/`instructions` shapes until 1.7 tightens it to `human` + matching `needs`. The report projection carries `declarationId` on the canonical incident. `core.diagnose` (`src/core/doctor-diagnose-repair.ts`) is registered by `ensureCoreRepairActions()` BEFORE plugins activate (`server.ts`) and by every doctor entry point: its item is `manual` (A17: investigations ASK) and its apply opens ONE investigation task through the ONE delegate, taking over the running repair's incident reservation, briefed by `src/core/doctor-brief.ts` — the ONE brief builder for every agent-run Health task (the delegated-repair brief kept its sanctioned-fix lines and integrity rules verbatim; the fallback brief adds the engine attempts, the hand-back shapes, the sanctioned/refused CLI verbs, the Terminal convention and the turn budget, and names `bakin_exec_terminal_session` / `_health_handback` / `_health_repair` ONLY when the exec-tool registry has them — PR5 lands the last two). Pins: `tests/core/doctor-registration-teeth.test.ts`, `doctor-brief.test.ts`, `doctor-diagnose-repair.test.ts`. The public-API freeze covers the seven browser entrypoints, not `@makinbakin/sdk/types`, so the new types changed nothing there (319 values / 430 types). Evidence carries `updateObservedAt` (the record's last SUCCESSFUL observation, null before one) and `updateCheckError` when the last attempt failed. `updates.changed` re-runs the check for its plugin subjects (`doctor-refresh.ts`).

`restart-recovery` raises the `stale-tasks` incident ("In-progress tasks have no live run") from the ledger-only stranded predicate in `src/core/task-liveness.ts` — a task with a live run is never listed, so a repair task running the doctor can no longer flag itself (the 2026-09-28 margo false positive). The tasks plugin's file-based `heartbeat-missing` observation was deleted with it; heartbeat files are Team-page status notes.

Schedule registers `schedule-cutover`, `schedule-sync` and `schedule-prompts` (`plugins/schedule/lib/health-checks.ts`). `schedule-sync` applies the schedule plugin's task-prompt predicate to untracked native crons: only jobs with a real prompt are orphans to track (`track-runtime-cron`); the runtime's own marker crons surface as a healthy `runtime-internal` observation. `schedule-prompts` raises one incident (class `cleanup_backlog`, resource `{ kind: 'schedule', id }`) per Bakin-owned schedule whose prompt is not a task prompt — `action_required` until the scheduler has paused it (`pauseReason: 'unrunnable-prompt'`), `watch` once contained — resolved by the destructive `remove-unrunnable-jobs` repair ("Remove job") whose plan freezes exactly one change per job id and whose apply deletes only those still-unrunnable ids — escalation routes it through a `health-repair` approval task like any other destructive repair. See `.claude/knowledge/bakin-owned-scheduler.md`.

Health registers six local repair actions: journal revival, consistency rebuild, spin rebuild, canary restart, engine-burn restart, and runtime skill sync. Other plugin owners register their own actions beside their checks — the spend plugin owns `spend-evidence-refresh-pricing` and `accept-unattributed-history` next to its `budget` check (whose "no limits" state is healthy, never a nag — spec S8).

The Brands `integrity` check uses the same `plugins/brands/lib/integrity.ts` scan as the brand integrity route. It reports unreadable manifests, dangling assets, tasks blocked by missing/draft brands, and stale drafts as structured observations and incidents; no consumer parses its summary text.

The `capabilities` check projects the shared capability-readiness engine per installed pack. `github-readiness` is informational when `gh` is absent, but reports an action-required incident with explicit authentication instructions when the CLI is installed and unauthenticated. `bakin check capabilities` uses the same onboarding component rather than a parallel probe.

The Models `routing` check (`models.routing`, `plugins/models/lib/health-checks.ts`) warns on unrouted recommended system work classes (with per-class 7d spend evidence), on standing thinking clamps, and on premium-tier models observed on cheap-recommended classes. Proposals derive from the ONE model-plan recommender (`src/core/model-plan.ts` via `plugins/models/lib/plan.ts` — see models-plugin.md); its `apply-recommended-routes` repair applies the same `routeProposals` the Models page's Advanced view previews off `GET /plan` — through the selections mutator, never a direct settings write.

The Models `dead-selections` check (`models.dead-selections`, `plugins/models/lib/dead-selections.ts`, #907) owns "a model that cannot run": ONE action_required finding per persisted selection (agent pin, route, tag override, runtime default/fallback/alias) whose model has no credentials, was rejected by the account, is runtime-unavailable, or is gone from the catalog — class `service_failure`, resource `{ kind: 'model_selection', id: <ref> }`, plain-words summary. Each finding carries the proposal the Models page shows; the `apply-model-proposal` repair holds the PLANNED `{ref, from, to, revision}` from plan() to apply() and submits it through `POST /selections`, so a change in between is refused by the revision check instead of silently re-targeted. No proposal ⇒ navigate to `/models?ref=<ref>`. Failed or partial evidence (catalog / credentials / rejections) ⇒ ONE `unknown` finding per source (class `evidence_gap`) and no per-selection findings for facts that depend on it. See `.claude/knowledge/models-plugin.md` § Dead selections.

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

## Audit, escalation, and auto-close

Each completed full sweep appends `doctor.run` with report ID, registered count, incident counts, and overall status. Escalation considers fresh effective-`action_required` incidents (not stale, not acked/snoozed) by stable incident ID — never severity text. The old "notify the main agent" mode is gone: an agent is told about an incident only through a delegated repair task.

`settings.doctor`:

- `intervalMs` — full-sweep cadence
- `requireOnboard` — whether the core onboarding check applies
- `escalation` — boolean (default true); any non-boolean value falls back to the default
- `escalationCooldownMs` — any repair request younger than this covers its incidents (no one-task-per-cycle churn)
- `escalationStaleAfterMs` — how long an open todo/inProgress task covers a still-burning incident

**Request files are validated on read (#898):** every repair-request file passes a zod schema (`src/core/doctor-repair-store.ts`); a malformed one is skipped and logged on its own — it never aborts the listing (which would silently stop escalation) and reads as absent for get/update. A request whose `createdAt` is in the future covers nothing, checked before cooldown or column logic (no clamping). A pre-#942 file without `kind`/`checkIds` is simply invalid (the compat defaults were retired in #945): it is skipped and logged, and escalation re-judges its incidents fresh.

**Repair brief:** besides the sanctioned fixes, the delegated brief's integrity rules forbid fabricating Bakin-internal state AND silencing — no ack/snooze, no doctor/escalation settings changes, no moving the task to review to go quiet; a blocked, clearly reported task is the success path.

**Cover is per incident and bounded** (`assessRepairCoverage`, #898 PR G): the cooldown covers regardless of column; an open task covers for ONE window (`escalationStaleAfterMs`, measured from the request's last VALID `resurfaced` event (parseable, not in the future), else its creation — column moves never reset it); a verified or dismissed request or a missing task covers nothing. Past the window — or when the task was closed while its incident still fails — the request RESURFACES its existing task instead of a duplicate: an in-flight run skips the cycle; otherwise `escalateTaskToReview` (the ONE documented exception to the agent transition table) moves it to Review with a log line (a task already in Review just gets the line; a Blocked task moves too, its blocked reason carried onto the log line — handed back means the operator's to take, and repair admission reads the column; leaving Done OR Archived goes through the audited `reopenIfLeavingDone` — archiving a done task keeps its completion row, so the resurface clears it), its pending approval is re-announced (`reannounceApproval`, toast/OS only) or — for a delegated request — a `health-navigate` approval opens on the same task (`attachResurfaceApproval`, request back to `sent`, Dismiss = 7-day snooze), and a `resurfaced` event marks the window. The incidents stay covered. An `applying` request always covers and never resurfaces; cycles are serialized and each resurface re-reads, re-judges and mutates the request and task in ONE synchronous block (nothing — auto-close verifying, an approval resolving — can interleave); attaching sets `sent` only over `completed`/`failed`. `doctor --delegate` is serialized and answers `already_delegated` for incidents an open repair task (one whose task still exists) already works (a future-dated request works nothing, the same rule coverage applies; the index keeps every open candidate newest first, so a deleted newer task falls back to an older live one). A resurface can't strand a dispatch: dispatch re-reads the column right after its claim. Auto-close withdraws the approval on the UPDATED request, so one attached while its checks ran is withdrawn too. Every incident whose request is open carries `repairTaskId` in the report (the newest candidate from `openRepairWorkByIncident` — a memo the store drops on every write — whose task still exists; none links nothing) (not a resource — resources feed the ack fingerprint), and the incident card links "Repair task". Only uncovered incidents proceed.

**Policy per cycle** (`escalateCronIncidents`, spec D3–D5; adapted to the three-outcomes contract until PR5's engine replaces it): plan once for the uncovered set; `self-heal` items are applied immediately (`startDoctorRepair` + `awaitDoctorRepair`, origin `system`) and the incidents they fix never become tasks; incidents with a NON-SAFE proposal → ONE review task holding a `health-repair` approval whose proposal is frozen (`openRepairApproval`; when the safe attempt for them already failed, the proposal carries that `failure` receipt and the card shows it); `navigate` incidents → one review task + `health-navigate` approval each; **repair-type incidents nothing could fix automatically — the safe apply failed or settled without a report, planning threw, or no action was proposed — go to the OPERATOR (#896 D3.4): ONE `operator-review` task (`openOperatorReview`, no approval, the failure receipt or planner error in the brief), never to an agent that would re-run the same installer**; everything else (instructions, rerun) → ONE delegated task for the main agent (`delegateDoctorRepair`, brief with sanctioned fixes + integrity rules). Nothing is dropped silently. **Admission (#896 D3.1–D3.3):** incidents are reserved by owner token (`src/core/doctor-reservations.ts`) before any work starts — a repair under its operation fingerprint (identical requests attach), a delegation under its own token, escalation for the span it judges (it hands the safe subset to the auto-repair operation and the delegated subset to the delegation by token, and releases the rest as each approval/task is written) — so a second repair or a manual `doctor --delegate` over a held incident is refused (`repair_in_flight`, HTTP 409, CLI exit 1) instead of racing. The durable twin of that admission: an apply over an incident an OPEN `delegate` request's task is still working (an agent-runnable column — not Review, not closed) is refused too (`heldBy: task:<id>`) unless the caller IS that task's agent (CLI agent context, the one hand-off); once escalation hands the task back (resurfaced to Review) or it is closed, the operator may apply — they were asked to take over. The CLI renders only a 409 whose body matches the refusal schema; any other 409 stays a formatted error. Review tasks have no assignee: dispatch pulls from `todo` only and liveness checks read `inProgress` only, so they are never dispatched nor stranded.

**Repair requests** (`doctor/repair-requests-v2/`): `kind: delegate | approval-repair | approval-navigate | operator-review`, `status: planned → sent → (applying →) completed | verified | failed | dismissed`, `checkIds` (the fresh-verification target), `approvalId`, frozen `proposal`, `failure` (the failed attempt: operation, stage, error, time — on `operator-review` requests and on frozen proposals). An `operator-review` request covers and auto-closes like any other and resurfaces its own task with its own copy, never a navigate approval. `applying` is written BEFORE any mutation so a crash mid-apply is recovered at boot (`recoverInterruptedApplies`: clean checks → verified + task done, else failed + task blocked; the pending record is withdrawn).

**Auto-close** (`reconcileRepairRequests`, spec D2 / plan review R4): after every cycle and, debounced 30 s, whenever the report's incident set changes, each open request (not `applying`/`verified`/`dismissed`, task not done/archived, older than 60 s) re-runs its originating checks (`runTargetedDiagnostics(checkIds)`) and closes ONLY when every one of them **evaluated healthy on that run** (`checkEvaluatedHealthy`: observed outcome, snapshot from that execution, every observation healthy and current) AND none of its incidents remain. Unknown, failed, timed-out, stale or unregistered checks keep the task open — an absent incident alone never closes anything. Closing = request `verified` + task log + done (`skipDoneGuard`, channel system) + pending approval cancelled `resolved`. The manual verify route/CLI (`verifyDoctorRepairRequest`) runs a full sweep then the SAME judgement, completing the task on a pass. Decisions themselves (Apply / Dismiss) are documented in `.claude/knowledge/approvals.md`.

## Re-homing (1.7) — where the build departed from the table

The 206-row table (`.claude/specs/self-healing-health-and-updates-2026-10-inventories/re-homing.md`) is the source; every owner has a `tests/plugins/<owner>/re-homing.test.ts` (adapters: `tests/adapter-<x>/re-homing.test.ts`; health splits into `re-homing.test.ts` + `re-homing-search.test.ts`) pinning each row's family. Deviations, all commented at the emission site: split families where one key had two outcomes (54 ownership claim/guest, 57 engine-unavailable/guest, 112 structural/structural-package/structural-opaque); `unclaimed-tables` (76) stamps `deletesUserContent: true` so the ONE policy yields the click the spec wants, and its Keep is a recorded decision (`kept-search-tables.ts`, `POST /api/plugins/health/search/unclaimed-tables/{keep,forget}`: kept names are skipped and reported, a new table is raised anew); row 54 carries BOTH choices — the claim repair with "Use that engine as a guest" as a link choice to the System setting `search.settings.url` (now an editable field; the human variant and row 57's guest variant land on the same field); row 94's "Keep my edit" is a request choice recording the shipped sha the operator accepted (`~/.bakin/plugins/accepted-edits.json`; the scanner raises the drift again only when the plugin ships a new copy) beside the one-click Restore item; `required` comes from a usage FACT on rows 6 (an installed agent package declares the pack: lockfile `dependents` / agent `dependencies`) and 7 (the git plugin's `allowedRepoRoots` is non-empty), and is never presumed any more: row 26 (`guild-unjoined`) reads the routing targets the readiness snapshot already resolved and claims only what evidence proves — a target that resolves `ok` is placed in a REACHABLE server; a target that resolves to no known channel (`unknown_channel`) proves nothing, because a Discord channel ref carries no guild id and the bot cannot enumerate a server it has not joined (the same verdict covers a deleted channel or a typo, which keep their own routing-check control), so the card is `required:false`/advisory with `usageKnown:false` and is never red on that guess (Codex r3 R3-3); every target placed (or none configured) ⇒ advisory; `unverifiable` (no channel list) ⇒ advisory with `usageKnown:false`; rows 174/180–182 and 189 read usage FACTS — an asset's task is the manifest's own `taskId` (tasks carry no asset field) and counts while that task is OPEN (`ctx.tasks.get`), brands through the `brands.assetReferences` hook (absent plugin = no brand references, a throwing leg = `usageKnown:false`, never urgency), so an unreferenced broken asset is advisory; the asset recover page's "Detach references" clears the manifest's task and runs `brands.detachAsset`; row 174 keeps its original meaning (a required store location that is a FILE) and its card choice `POST /api/plugins/assets/recover/store-location` renames the file aside so `repair-store` self-heals the directory — there is no asset id to land a recover page on; brands (189) raise ONE incident per affected brand (`integrity-<id>` dangling refs, `invalid-<id>` unreadable OR missing manifest — a directory without `brand.json` is a record, not "nothing to recover": the recover facts say `no-manifest` and Recreate/Delete apply (Codex r2 N8), `ghost-<id>` tasks waiting on a missing brand → `/tasks?taskId=<id>&field=brand`, on a draft → the brand page), required only while an OPEN task's EFFECTIVE brand is this one — `lib/usage.ts` is the ONE fact (own → ancestry → `projects.getBrand`, resolved like the gate, independent of whether the manifest reads; when that fact is UNKNOWN (task board or project hook failed, `usage.error`) the card says "could not be determined" with the reason, never "no open task uses this brand" — r3 #8; a throwing task store or project hook makes it UNKNOWN, never urgency), read by the check and the recover route alike (Codex r2 N9); row 98 reads two facts — the ledger's `disabled` mark (a disabled plugin's stale artifact is a plain observation) and a LIVE consumer (`PluginArtifactDeps.consumers`: open tasks whose `source.pluginId` is the plugin, plus in-progress workflow instances on definitions the plugin owns, read through `workflows.definitions.list` / `workflows.instances.list`); declared contributions and installed skills/bins are what disabling takes away — context in the copy, never usage — so a plugin nothing consumes is advisory and an unreadable consumer fact is advisory with the gap named (Codex r2 / r1 #11) — and its card carries the containment choice (`request` → `POST /api/plugins/disable`, `effects` all false, confirmed) beside the Updates link; disable is a SUSPEND (`pluginRegistry.suspendPlugin`: hooks/tools/runtime search wiring go, durable tables and queued writes stay — `deactivatePlugin` is uninstall's destructive teardown), and the ONE live activation boundary (`activateUserPluginDir`) never activates a plugin the ledger marks disabled — an upgrade/reinstall/restore/link lands on disk and reports `skipped: 'disabled'` until Enable clears the mark (Codex r2 N1/N7); `package-sync`/`package-reinstall` resolve EVERY target through the report, `all_actionable` included, each item bound to its own pack's incident (Codex r2 N3) and computed where it has one (20 alert alias, 127/128 a skill referenced by an IN-USE definition; 133–137 a workflow RUNNING (an in-progress instance) OR SCHEDULED — the schedule plugin's `schedule.workflowsScheduled` hook (enabled Bakin jobs with a `workflowId`, paused ones included; a missing or throwing hook is "no schedule fact", never "in use"); a definition file that does not parse is the schema family's named instance (`schema-<wf>-parse`) and never hides the rest of the scan; the raw recover editor keys the shared dirty-exit guard on its query identity (`isSameLocation` over `recover`/`skill`/`step`) so Back to `/workflows` asks before dropping a draft (r3 #7); a skill's verdict is ONE function (`lib/skill-validate.ts`: the frontmatter must PARSE to a mapping and carry an `output_schema` MAPPING — malformed YAML and a prose-only or list `output_schema` fail both the check and the raw save route, Codex r2 N11); the recover surfaces (`workflow-recover-banner.tsx`, `roster-recover-panel.tsx`) keep evidence states apart — findings, verified-empty (the originating check OBSERVED in the report), unverified (it has not), unavailable (the report could not be read; the last known findings stay, never "resolved") (Codex r2 N10) — and the raw editor's draft rides the shared `useUnsavedChangesGuard` (route changes, links and the recover view's own Dismiss through `requestExit`, Codex r2 N12); 149/150 paused; 158/159 selection use — defaults, fallbacks, routes with a model and live-roster agent pins are resolved by turns by construction, a tag override is in use while an OPEN task carries its tag (`DeadSelectionDeps.openTaskTags`; an unreadable board is its own unknown observation and the override reads advisory, never presumed), an alias while another selection names it; 163 a pause-mode hold OR an open incident whose rule is still at/over its cap — the two facts the gate and `GET /status` derive `deferred` from — else advisory; 167 stays `always` because a breach IS a deferral). Spend's card buttons ride `resolution.choices`: 163 raise (link to the incident banner, which holds the amount) / ack / resume (confirmed; the route's `409 still_over_limit` surfaces as the choice's error) through `POST /incidents/:id/resolve`; 167 raise (link to the rule's row, `/spend?tab=limits&field=<rule id>` + `field: budget-rule-<id>`, focused like `?incident=`) and ack of that rule's open incident; row 200 sets `required: false` AND `disposition: 'advisory'` (the two agree — never red on a guess); row 143's fold names `core.self-update` as a hint only (PR7 registers it); row 161 is the same human decision as row 40 until subjects fold; row 194's session variant lands on `/terminal/<id>`; the Pi install handoff is the pinned npm package name; row 204's handoff is OpenClaw's device scope-upgrade (`openclaw devices list` → `openclaw devices approve <requestId>` → `bakin restart` — the gateway files a pending upgrade request when it refuses `operator.admin`, and the client drops the optional scope for its lifetime, so only a fresh connection asks again); the gateway floor (the Updates `gateway` row, not a table row) is the adapter's `gateway-protocol` check with family `gateway-below-floor` (human external-install, handoff `openclaw update`); a rerun whose cached verdict is not `ok` performs a FRESH bounded probe (`probeGatewayCompatibility`: dial + handshake under the connect timeout, evidence `probe: fresh|cached|failed`) so the operator who just upgraded is seen — a failed probe keeps the cached verdict and says so, never healthy; the runtime page's `?field=credentials` group renders the runtime's PROVIDER sign-in handoff read from the report — selected by the family's identity (`declarationId: 'provider-configuration'`, the id Pi row 198 and OpenClaw (`openclaw models auth login`, parity added in Codex r2; a PARTIAL inventory is unknown, never credential-less) both declare), never "the first credential need" (OpenClaw's `override-authorization` device-scope grant authenticates no provider; Codex r3 R3-4) — under the tiles, copy-only WITH return verification: a successful copy arms the incident's originating check ids in a host-local module (`credential-return.ts`, surviving a Terminal round trip) and the next mount/focus/visibility POSTs a targeted `doctor/run` for exactly those checks before re-reading both reports (R3-5); a runtime that published no sign-in command gets an honest gap line, never an invented command; rows 106/107's "roster editor" is `/team?recover=1` with one row per failing ENTRY (`?agent=<id>` / `?entry=<n>` land on it, evidence carries positions/names/workspace) — a duplicate's executable decision is "remove the agent entirely" through the team route when the agent is not main — the main agent (the route refuses it) and, with `agents.registryLocation()`, every duplicate also get the registry-edit `HandoffCard` naming EVERY entry key (`evidence.registry.entryKeys`, `removable`), a copied command arms ONE targeted roster recheck on the next focus/visibility (Codex r3 #5/#6), and verified-empty on the roster and workflow recover surfaces requires the check's run to have INSPECTED (no `unknown`/last-known row), a later failed refresh shows as stale even after an empty result, and the clean banner offers Recheck (r3 #2) (the neutral contract removes BY id, so ONE of two same-id entries cannot be addressed; Pi's registry schema and OpenClaw's keyed `entries` make a missing id reachable only from a legacy OpenClaw `agents.list`), and an id-less entry's control is the registry file itself: the OPTIONAL neutral member `agents.registryLocation()` (Pi: `<PI_HOME>/agent/bakin-agents.json` + `agents[n]`; OpenClaw: `openclaw.json` + `agents.list[n]` for the legacy array, the keyed `entries` map otherwise; conformance-pinned present on both, absent on the mock) gives the check a `handoff` (`"${EDITOR:-nano}" <path>`) and the row a `HandoffCard` naming the entry key + a targeted recheck; a runtime without the member keeps the entry-addressed row and the honest sentence. Actions that only install sha256-pinned own content or sweep Bakin's scratch declare `mutation: 'none'` (a `reinstall`/`delete` kind would make the gate refuse their self-heal); upgrade-shaped ones (`plugin-upgrade`, `plugin-reinstall`, `package-sync`, `package-reinstall`) do, so an unattended run is refused `consent-unreviewed` until PR6 supplies consent records — the gate's one honest exception: with no record and no computed delta the reason is "review first", never a source list it never consulted. Verification rows (206, stale/missing evidence) carry the check owner's subject and `core.diagnose`. `search-disabled` (52) became a plain warning observation (an error must carry an incident).

## Authoring checklist

1. Put the domain engine with its owner; keep the check a thin projection.
2. Choose stable local check, observation, and incident keys.
3. Supply name, description, group, and realistic `maxAgeMs`.
4. Return at least one observation or explicit not-applicable.
5. Model every branch, including unavailable dependencies, without invented success.
6. Attach resources/evidence for attribution; keep evidence bounded and secret-safe.
7. Two outcomes only (spec D1): `{ type: 'repair', actionId }` (owner-local, or `core.diagnose` verbatim) or `{ type: 'human', needs, href, field?, handoff? }` — `needs` is `credential | payment | decision | external-install`, `href` the same-origin path to the control that fixes it (1.4a–c built them), `field` the form field id when the fix is a value to enter, `handoff: { command, cwd? }` the one shell command for a credential or install the operator runs (the card's Terminal handoff with return verification), `choices` the named card buttons (§ Decision choices and return verification). No free-text steps, no "rerun": a transient or informational state is a warning/unknown observation WITHOUT an incident, listed under its check.
8. Declare every incident family in the registration's `incidents` catalog (`{ id, subjectKind, resolution, required: always | never | owner-decides }`), stamp every emitted incident with `subject`, `declarationId` (+ `required` for an owner-decides family), register repair actions BEFORE the checks that declare them, and give every action its `effects` and its `mutation` (`'none'` when nothing needs authorization). Both ends are validated: a bad catalog fails activation naming the declaration; a contradicting instance reads `invalid` (`INVALID_HEALTH_DECLARATION`).
9. Add direct branch tests and plugin activation/unregistration coverage.
10. Run `tests/architecture/health-contract.test.ts` so no compatibility plane is reintroduced.

## Test map

- `tests/core/health-contract.test.ts` — exact runtime input validation
- `tests/core/health-check-registry.test.ts` — ownership, namespace, unregister
- `tests/core/doctor-plugin-checks.test.ts` — isolated execution/invalid output
- `tests/core/health-report.test.ts` — report merge, sort, precedence, IDs
- `tests/core/doctor-cache.test.ts` — snapshot retention, TTL, flights, events
- `tests/core/doctor-repair-plans.test.ts` / `doctor-repair.test.ts` — targeting, confirmation, staleness, verification
- `tests/core/doctor-delegate.test.ts` / `doctor-escalation.test.ts` — delegation brief, per-incident cover, policy partition
- `tests/core/doctor-approvals.test.ts` — health-repair / health-navigate kinds (frozen proposal, plan-changed, dismiss, interrupted apply)
- `tests/core/doctor-autoclose.test.ts` — every evidence state that keeps a repair task open; the one that closes it
- `tests/plugins/{owner}/health-checks.test.ts` — direct producer branches
- `tests/architecture/health-contract.test.ts` — retired vocabulary and planes

Storage-touching tests must isolate content directories and global registries. Use the SDK test context to capture checks and repair actions separately.

## Decision record

The single-version cutover replaced a flat message-oriented result array, inline repair metadata, a second adapter service, whole-report caching, and message-derived identity. Those shapes were intentionally removed rather than adapted: dual contracts made status, freshness, ownership, and repair safety impossible to trust consistently across UI, CLI, and automation.

## Background freshness and navigation alerts

Navigation always signals only unsuppressed effective `action_required` incidents,
in every sensitivity mode. Monitoring (`watch`) and advisories remain available
inside Health without lighting the nav. The nav and page parse the same canonical
report; no raw-disposition fallback or parallel summary interpretation remains.

The server coordinator checks due diagnostics using each registered `maxAgeMs`
(and the doctor interval as default), independently of page visits. Failed checks
retry after 30 seconds. Durable task/workflow, budget, search-completion, settings,
plugin-lifecycle, owned-file and update-observation changes (`updates.changed`
re-runs `plugin-artifacts` for plugin subjects and `search` for the engine/model
subjects, #1007) invalidate affected checks. Invalidation
arriving during execution queues fresh work after the older flight. Stream chunks,
search progress, and report publication never trigger recursive checks.

The coordinator also advances time-dependent projections, including snooze expiry.
The full doctor sweep and explicit Run checks remain available; mounting Health
no longer starts a special sweep. External probes without change events still
have their registered detection cadence. Clients reconcile report events,
reconnect, and resume; failed reads preserve last-known state and retry.
Reconciliation is a cached read, never a substitute for an explicit diagnostic
sweep. Events arriving during an explicit sweep coalesce into one follow-up read
after it settles, preserving the manual run's result and any intervening changes.
Changing the resource URL or unmounting cancels that queued read.
