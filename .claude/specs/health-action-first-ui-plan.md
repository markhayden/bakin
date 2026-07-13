# Health Action-First UI — Implementation Plan

**Status:** COMPLETED 2026-07-13
**Spec:** .claude/specs/health-action-first-ui.md
**Branch:** feat/health-action-first-ui
**Primary surface:** /health

The implementation follows the approved single-version contract. Every ordinary
task is a tested, rollback-safe commit. The canonical contract cutover is the
one deliberate size exception: changing registerHealthCheck breaks all 39
first-party producers and every report consumer at once, and the spec forbids
a compatibility bridge or dual response. Its small work packages therefore
accumulate without intermediate commits and land as one green atomic checkpoint.

## 1. Plan-time baseline and guardrails

- Current branch main matches origin/main.
- Preserve the user-owned modification in
  packages/host/src/api/_embedded-assets-static.ts. Never edit, stage, reset, or
  regenerate it.
- The approved spec and this plan are the only project files changed before
  implementation.
- Baseline targeted contract/core/Health suite: 209 passing, 0 failing.
- Baseline route/architecture suite: 24 passing, 0 failing.
- Baseline bun run typecheck: green.
- Exactly 39 first-party plugin registrations exist across Health (22), Team
  (4), Tasks (4), Workflows (3), Assets, Brands, Git, Images, Memory, and
  Schedule.
- Search consolidation intentionally changes those 39 registrations to 37:
  health.search becomes the cheap Engine/Indexes/Journal source and absorbs
  health.search-outbox plus memory.search-tables. The canary, consistency,
  spin, and engine-burn checks remain independent.
- The generic Health runtime and channel-approval checks retain the two signals
  duplicated by OpenClaw’s adapter definitions; the duplicate OpenClaw
  definitions are removed. Pi’s unique home/agent-root/auth/model observations
  enter the canonical registry with adapter ownership. Antfly’s empty adapter
  check method is removed.
- No new dependency is planned.

## 2. Dependency graph and checkpoints

~~~text
C0 spec/plan anchor
  |
C1 canonical contract + producers + all old-contract consumers (atomic)
  |
  +--> C2 activity classification and buckets (atomic internal contract)
  +--> C3 responsive PluginHeader
  +--> C4 accessible chart data
             |
             v
      C5 cancellable/event-aware Health hooks
             |
             +--> C6 Overview --> C7 targeted repair
             +--> C8 Agents
             +--> C9 Activity
             +--> C10 System
                       |
                       v
                C11 four-tab shell flip
                       |
                C12 browser/responsive gate
                       |
                C13 legacy UI deletion
                       |
                C14-C16 docs, generated refs, screenshots
                       |
                C17 final regression and independent review
~~~

- Checkpoint A: after C1 — canonical report is the only production contract.
- Checkpoint B: after C4 — shared UI foundations are ready.
- Checkpoint C: after C7 — action-first Overview and repair loop are complete.
- Checkpoint D: after C11 — the four-tab experience is active.
- Checkpoint E: after C13 — browser-approved UI with legacy code removed.
- Release gate: after C17.

## 3. Tasks and commit strategy

### C0 — Anchor the approved project

**Commit:** docs(health): approve action-first spec and implementation plan

**Files**

- .claude/specs/health-action-first-ui.md
- .claude/specs/health-action-first-ui-plan.md

**Acceptance**

- Spec and plan both say Approved.
- Feature branch is created from the verified main baseline.
- Only these two paths are staged; the embedded-assets change remains unstaged.

**Verification**

~~~bash
git status --short
git diff --check -- .claude/specs/health-action-first-ui.md .claude/specs/health-action-first-ui-plan.md
~~~

**Dependencies:** none  
**Size:** XS

---

### C1 — Atomic canonical Health cutover

**Commit:** refactor(health): cut over to canonical health reports

There is no transitional registration overload, legacy route projection, or
message parser. Work packages C1.1–C1.16 may temporarily leave the worktree red,
but no intermediate commit or handoff is allowed. The final C1 commit is made
only after the entire gate is green. A revert restores the complete legacy
system.

#### C1.1 — SDK contract and compile-time invariants

**Likely files**

- packages/sdk/src/types/health.ts (new)
- packages/sdk/src/types/registration.ts
- packages/sdk/src/types/context.ts
- packages/sdk/src/types/index.ts
- tests/core/health-type-contract.test.ts (new)

**Acceptance**

- Input and output contracts exactly model observations, incidents, report,
  freshness, owners, resources, resolutions, repair targets/plans/results, and
  Search readiness.
- Illegal healthy/error/unknown combinations fail at typecheck.
- HealthCheckResult and old repair fields are no longer public declarations.

**RED:** add compile-time pins and run bun run typecheck.  
**GREEN:** the same command passes at the final C1 gate.

#### C1.2 — Typed constructors and SDK test context

**Likely files**

- packages/sdk/src/utils/health.ts (new)
- packages/sdk/src/utils/index.ts
- packages/sdk/src/testing/index.ts
- tests/sdk-testing/health-checks.test.ts (new)
- tests/architecture/type-single-home.test.ts

**Acceptance**

- Semantic constructors expose keys, status, incident, resources, resolution,
  and evidence at each producer.
- Test contexts capture checks and separately registered repair actions.
- healthOk/healthWarn/healthError/healthFixed and fixed status are gone.

**RED/GREEN**

~~~bash
bun test --isolate tests/sdk-testing/health-checks.test.ts tests/architecture/type-single-home.test.ts
~~~

#### C1.3 — Exact runtime validation and owner-aware registries

**Likely files**

- src/core/health-contract.ts (new)
- src/core/health-check-registry.ts
- packages/core/src/plugin-types.ts
- tests/core/health-contract.test.ts (new)
- tests/core/health-check-registry.test.ts

**Acceptance**

- Registration is validated before insertion and bad legacy input throws a
  typed activation contract error.
- IDs, lengths, same-origin navigation, JSON-safe/redacted evidence, evidence
  size, resources, and owner-local repair references are validated.
- Checks and repair actions have plugin/adapter/core ownership and cleanly
  unregister on reload.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/health-contract.test.ts tests/core/health-check-registry.test.ts
~~~

#### C1.4 — Plugin activation and hot-reload wiring

**Likely files**

- src/core/plugin-registry.ts
- src/core/plugin-registry-types.ts
- src/lib/plugin-context-factory.ts
- src/core/plugin-host/reload-pipeline.ts
- tests/core/plugin-registry.test.ts

**Acceptance**

- PluginContext exposes registerHealthCheck and registerHealthRepairAction
  against the one canonical shape.
- Invalid registration fails plugin activation and is visible in the plugin
  failure registry.
- Hot reload removes both checks, actions, and cached snapshots.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/plugin-registry.test.ts tests/plugins/lifecycle/hot-reload-integration.test.ts
~~~

#### C1.5 — Validating runner and immutable report projection

**Likely files**

- src/core/doctor-checks.ts
- src/core/health-report.ts (new)
- tests/core/doctor-plugin-checks.test.ts
- tests/core/health-report.test.ts (new)

**Acceptance**

- Runs stamp stable execution/check/observation/incident IDs and owner metadata.
- Throws, malformed output, conflicts, and empty observed results become
  core-owned Unknown verification incidents while unrelated checks finish.
- Incident merge, resource dedupe, exact counts, overall precedence, placement,
  and stable sort match the spec.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/doctor-plugin-checks.test.ts tests/core/health-report.test.ts
~~~

#### C1.6 — Per-check cache, freshness, and single-flight

**Likely files**

- src/core/doctor-report-cache.ts (new)
- src/core/doctor.ts
- tests/core/doctor-cache.test.ts (new)
- tests/core/doctor.test.ts

**Acceptance**

- Latest execution and latest valid snapshot are separate.
- Replacement, last-known retention, not-applicable clearing, TTL/grace, stale
  Unknown incidents, and unregister cleanup are exact.
- Full sweeps are globally single-flight; targeted checks are per-check
  single-flight; overlap joins without corrupting lastFullSweep.
- Every report change emits health.report.changed.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/doctor-cache.test.ts tests/core/doctor.test.ts
bun run check:cycles
~~~

#### C1.7 — Targeted repair plan store and stale protection

**Likely files**

- src/core/doctor-repair.ts
- src/core/doctor-repair-plans.ts (new)
- tests/core/doctor-repair.test.ts
- tests/core/doctor-repair-plans.test.ts (new)

**Acceptance**

- Plan targets incidents, observations, or all actionable incidents by stable
  report IDs.
- Opaque plans live server-side for 10 minutes and carry item preconditions.
- Safe items may be selected; non-safe items require individual confirmation.
- Unrelated report revisions remain valid; changed/resolved target evidence or
  expiry returns typed STALE_PLAN with zero apply calls.
- Apply reruns affected checks and reports applied versus verified separately.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/doctor-repair-plans.test.ts tests/core/doctor-repair.test.ts tests/core/doctor-cache.test.ts
~~~

#### C1.8 — Delegation, notification, escalation, and record versioning

**Likely files**

- src/core/doctor-repair-store.ts
- src/core/doctor-delegate.ts
- src/core/doctor-escalation.ts
- tests/core/doctor-delegate.test.ts
- tests/core/doctor-escalation.test.ts

**Acceptance**

- Existing doctor/repair-requests bytes become an immutable v1 archive and are
  never parsed by v2 code; new records use a distinct versioned directory.
- Delegation and verification use stable incident/observation identity.
- Notification/escalation select fresh action-required incidents and dedupe by
  incident ID, not message or repairability.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/doctor-delegate.test.ts tests/core/doctor-escalation.test.ts tests/core/doctor-repair-store.test.ts
~~~

#### C1.9 — Remove the duplicate adapter plane

**Likely files**

- packages/core/src/adapters/shared.ts
- packages/core/src/adapters/runtime/concepts.ts
- packages/core/src/adapters/runtime/index.ts
- packages/core/src/adapters/search/index.ts
- packages/core/src/app-services.ts

Then:

- packages/core/src/index.ts
- src/core/app-services.ts
- src/lib/plugin-context-services.ts
- src/lib/plugin-permissions.ts
- tests/core/adapter-health-registration.test.ts (new)

**Acceptance**

- Adapter definitions use the canonical SDK registration contract.
- AppServices.health, createHealthService, AdapterHealthCheckResult, and
  AdapterHealthCheckDefinition are deleted.
- Selected runtime adapter checks register at composition with adapter owner.
- User-plugin runtime facades no longer expose raw adapter health definitions.

**RED/GREEN**

~~~bash
bun test --isolate tests/core/adapter-health-registration.test.ts tests/lib/plugin-permissions.test.ts
~~~

#### C1.10 — Adapter producers and duplicate consolidation

**Likely files**

- packages/adapter-pi/src/health-checks.ts
- packages/adapter-pi/src/runtime.ts
- packages/adapter-openclaw/src/runtime.ts
- packages/adapter-antfly/src/client.ts
- packages/adapter-antfly/src/adapter.ts

**Acceptance**

- Pi emits structured home, agents-root, auth, and model observations.
- Duplicate OpenClaw gateway and approval definitions are removed because the
  generic Health checks preserve those exact signals.
- Antfly’s empty getHealthChecks surface is removed.
- Direct adapter tests pin ownership and observation branches.

**RED/GREEN**

~~~bash
bun test --isolate tests/adapter-pi/unsupported-health.test.ts tests/adapter-openclaw/health-checks.test.ts tests/integration/search-conformance/antfly.conformance.test.ts
~~~

#### C1.11 — Health platform producers

Each batch is at most five implementation/test files:

- Basics: content-dir, capabilities, service, runtime, system-checks test.
- Communications: channel-approvals, channel-aliases, system-checks test.
- Durability: session-store, restart-recovery, their direct tests.
- Execution/context: execution-safety, context-report, their direct tests.
- Cost/burn: budget, agent-burn, their direct tests.
- Distribution: sync-skill, plugin-assets, plugin-artifacts, direct tests.
- Registry: extract inline plugin-registry check into its own module and test.

**Acceptance**

- Every old branch is represented by a stable observation key/resource.
- Empty/inapplicable conditions are explicit, never empty arrays.
- Repairable observations reference separately registered owner actions.
- Direct gaps for capabilities and plugin activation failures are closed.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health tests/plugins/health-agent-burn-check.test.ts tests/core/restart-recovery.test.ts
~~~

#### C1.12 — Search live composite and readiness classifier

**Likely batches**

- Live: search.ts, search-outbox.ts, Memory health producer/test, Health system
  test.
- Registration: Health index, Memory index, checks route test.
- Deep: search-consistency.ts, search-spin.ts, their tests.
- Watch: search-engine-watch.ts and its tests.
- Projection: src/core/health-search-readiness.ts (new) and
  tests/plugins/health/search-readiness.test.ts (new).

**Acceptance**

- One cheap live execution exposes Engine, Indexes, and Journal and absorbs
  health.search-outbox plus memory.search-tables without losing any branch.
- Canary supplies Queries; other deep probes keep independent freshness.
- Classifier covers healthy/degraded/unhealthy/unknown precedence and every
  non-healthy stage references a canonical incident.
- Shared outbox/reindex/restart actions dedupe correlated repair work.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/search-readiness.test.ts tests/plugins/health/system-checks.test.ts tests/plugins/health/search-spin.test.ts tests/plugins/health/search-engine-watch.test.ts tests/plugins/memory/health-checks.test.ts
~~~

#### C1.13 — Remaining first-party producers

Each owner is a separate small work unit with its index, producer, and closest
test:

- Team, Tasks, Workflows, Assets, Schedule.
- Images and Git gain missing direct health tests.
- Brands retains its route/integrity coverage.

**Acceptance**

- All 39 original registration sites are accounted for: 37 canonical plugin
  registrations after the two approved Search consolidations.
- Compound Assets, Images, Git, Team, Tasks, and Workflows signals remain
  separate observations rather than copy-derived rows.
- Session-death evidence includes structured session/task/agent resources.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/team/health-checks.test.ts tests/plugins/tasks/health-checks.test.ts tests/plugins/workflows/health-checks.test.ts tests/plugins/assets/health-checks.test.ts tests/plugins/assets/enrichment-engine.test.ts tests/plugins/schedule/health-checks.test.ts tests/plugins/images/health-checks.test.ts tests/plugins/git/health-checks.test.ts tests/plugins/brands/routes.test.ts
~~~

#### C1.14 — Exact Health routes, manifest, and exec hooks

**Likely files**

- plugins/health/lib/route-schemas.ts (new)
- plugins/health/types.ts
- plugins/health/index.ts
- plugins/health/bakin-plugin.json
- tests/plugins/health/routes.test.ts

**Acceptance**

- GET /doctor returns the canonical report and fresh=true joins the sweep.
- /summary is live facts only; /search-readiness returns a report projection.
- Repair planning/apply are exact POST contracts with typed 409.
- /checks, hooks, and exec tools expose canonical metadata/report data.
- Server and manifest are 1.4.0, all 18 routes are declared, search.write is
  declared, dead settings are removed, usageHistoryScanMinutes remains.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/routes.test.ts tests/plugins/health/checks-route.test.ts tests/plugins/health/manifest-route-parity.test.ts
bun run build:plugins
~~~

#### C1.15 — CLI and secondary report consumers

Small work units:

- CLI command: src/cli/commands/doctor.ts and command tests.
- TUI: src/core/cli/ui/doctor.tsx, doctor-repair.tsx, and UI tests.
- Nav badge: use-health-summary, provider, and component tests.
- Team diagnostics: diagnostics-tab and direct test.
- Existing flat Health page: page/sections/Search/repair tests updated to the
  canonical report so the app remains functional before the later IA flip.

**Acceptance**

- Full and offline doctor use the canonical report; offline unverified sources
  are Unknown, not fake warnings/healthy rows.
- Exit codes are 0 Healthy/advisory, 2 Degraded, 1 Needs attention/Unknown.
- Nav badge counts unique non-advisory incidents.
- Team filters agent incidents through structured resources.
- Active runtime sessions use the sum of sessions, not row count.

**RED/GREEN**

~~~bash
bun test --isolate tests/cli/doctor-repair.test.ts tests/cli/doctor-ui.test.tsx tests/cli/doctor-repair-ui.test.tsx tests/components/use-health-summary.test.tsx tests/components/health-badge-provider.test.tsx tests/plugins/team/diagnostics-tab.test.tsx tests/plugins/health/health-page.test.tsx
~~~

#### C1.16 — Legacy-debt architecture guard

**Likely files**

- tests/architecture/health-contract.test.ts (new)
- tests/architecture/type-single-home.test.ts
- packages/sdk/src/utils/index.ts
- packages/core/src/index.ts

**Acceptance**

- Repository scan rejects HealthCheckResult, adapter health duplicates,
  autoFixable, autoFix, healthFixed, fixed diagnostic status, message-derived
  incident signatures, and the dead health service.
- No legacy registration or response adapter remains.

**RED/GREEN**

~~~bash
bun test --isolate tests/architecture/health-contract.test.ts tests/architecture/type-single-home.test.ts
rg -n 'HealthCheckResult|AdapterHealthCheckResult|AdapterHealthCheckDefinition|autoFixable|healthFixed|rowSignature' packages plugins src tests
~~~

#### C1 final atomic gate

~~~bash
bun test --isolate tests/core/health-contract.test.ts tests/core/health-check-registry.test.ts tests/core/doctor-plugin-checks.test.ts tests/core/health-report.test.ts tests/core/doctor-cache.test.ts tests/core/doctor.test.ts tests/core/doctor-repair-plans.test.ts tests/core/doctor-repair.test.ts tests/core/doctor-delegate.test.ts tests/core/doctor-escalation.test.ts
bun test --isolate tests/plugins/health tests/plugins/health-agent-burn-check.test.ts tests/plugins/team/health-checks.test.ts tests/plugins/tasks/health-checks.test.ts tests/plugins/workflows/health-checks.test.ts tests/plugins/assets/health-checks.test.ts tests/plugins/schedule/health-checks.test.ts tests/plugins/memory/health-checks.test.ts tests/plugins/images/health-checks.test.ts tests/plugins/git/health-checks.test.ts
bun run typecheck
bun run lint
bun run check:cycles
bun run build:plugins
bun run build:host
~~~

**Dependencies:** C0  
**Size:** XL, atomic interface migration

---

### C2 — Producer-assigned activity classes and failure buckets

**Commit:** feat(health): classify activity and hide routine success

This internal recorder signature also changes atomically: activityClass is
required, not defaulted or inferred from names.

**Work units / likely files**

- Query/aggregation: src/core/usage.ts, tests/core/usage.test.ts.
- Route metadata: packages/sdk/src/types/api-route.ts,
  src/core/server/request-handler.ts, src/core/rest-tracking.ts, REST wiring
  tests.
- Agent/tool producers: agent-cost.ts, dispatch-single.ts, task-service.ts,
  exec-tools/provider.ts, heartbeat.ts.
- MCP/Search/background producers: mcp-server.ts, search-outbox.ts,
  search-plugin-api.ts, search-query.ts, Assets enrichment queue.
- Health projection: plugins/health/index.ts, route schema/types/tests.

**Acceptance**

- Every recorder producer declares user, system, or routine.
- Successful routine entries are excluded by default; failed routine entries
  always remain.
- Usage feed supports include-routine and returns failure count/rate buckets.
- Health’s own successful polling cannot dominate default Activity.

**RED**

~~~bash
bun test --isolate tests/core/usage.test.ts tests/integration/usage-wiring-rest.test.ts tests/plugins/health/routes.test.ts
bun run typecheck
~~~

**GREEN**

~~~bash
bun test --isolate tests/core/usage.test.ts tests/integration/usage-wiring-agent.test.ts tests/integration/usage-wiring-mcp.test.ts tests/integration/usage-wiring-rest.test.ts tests/plugins/health/routes.test.ts
bun run typecheck
~~~

**Dependencies:** C1  
**Size:** L, atomic internal contract

---

### C3 — Container-safe shared PluginHeader

**Commit:** fix(ui): make PluginHeader container-safe

**Files**

- src/components/plugin-header.tsx
- tests/components/plugin-header.test.tsx

**Acceptance**

- Title/meta/actions wrap; search is bounded by available width.
- Essential status is not truncated; focus remains visible.
- Reduced motion removes width animation.
- Existing consumers remain visually and behaviorally intact.

**RED/GREEN**

~~~bash
bun test --isolate tests/components/plugin-header.test.tsx
bun run build:plugins
~~~

**Dependencies:** C1  
**Size:** S

---

### C4 — Keyboard-accessible charts and data equivalents

**Commit:** feat(ui): expose chart data without hover

**Files**

- src/components/charts/stacked-column-chart.tsx
- src/components/charts/chart-data-table.tsx (new)
- packages/sdk/src/components/index.ts
- tests/components/charts.test.tsx

**Acceptance**

- Hovered and focused marks expose identical labels/values.
- Every value is available through an always-present table/disclosure.
- Legend focus is visible and reduced motion is respected.
- Empty charts remain honest.

**RED/GREEN**

~~~bash
bun test --isolate tests/components/charts.test.tsx
~~~

**Dependencies:** C1  
**Size:** S

---

### C5 — Cancellable, source-aware Health hooks

**Commit:** feat(health): add source-aware data hooks

**Files**

- plugins/health/hooks/use-health-resource.ts (new)
- plugins/health/hooks/use-health-report.ts (new)
- tests/plugins/health/use-health-resource.test.tsx (new)
- tests/plugins/health/use-health-report.test.tsx (new)

**Acceptance**

- AbortController and request generations prevent stale overwrite.
- Initial error, background error, stale retained data, and loading are distinct.
- Report refreshes at 60 seconds plus health.report.changed; explicit/stale
  refresh joins one request.
- Background refresh never announces into a live region.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/use-health-resource.test.tsx tests/plugins/health/use-health-report.test.tsx
~~~

**Dependencies:** C1  
**Size:** S

---

### C6 — Action-first Overview and always-visible Search

**Commit:** feat(health): add action-first Overview

**Files**

- plugins/health/hooks/use-overview-data.ts (new)
- plugins/health/lib/health-view-model.ts (new)
- plugins/health/components/overview-tab.tsx (new)
- plugins/health/components/incident-row.tsx (new)
- tests/plugins/health/overview-tab.test.tsx (new)

**Acceptance**

- Overall state and real evidence freshness lead.
- Needs action, Unable to verify, and Watching follow canonical placement/sort.
- Search stage strip is always present and every nonhealthy state is explained.
- Right now shows running dispatches, summed sessions, and recent failures.
- Healthy state is explicit; incident evidence and contextual action expand.
- Focused incident survives refresh.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/overview-tab.test.tsx tests/plugins/health/use-health-report.test.tsx
~~~

**Dependencies:** C3, C5  
**Size:** M

---

### C7 — Targeted repair experience

**Commit:** feat(health): target and verify repairs

**Files**

- plugins/health/components/repair-dialog.tsx
- plugins/health/hooks/use-repair-plan.ts (new)
- plugins/health/components/incident-row.tsx
- tests/plugins/health/repair-dialog.test.tsx

**Acceptance**

- Row actions plan only the selected incident/observations.
- Safe items alone preselect; each non-safe item confirms individually.
- Apply sends planId, selections, and confirmed non-safe IDs.
- STALE_PLAN refreshes and offers re-plan without mutation.
- Applied and verified are distinct, focus restores, and only explicit actions
  use the polite live region.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/repair-dialog.test.tsx tests/plugins/health/overview-tab.test.tsx
~~~

**Dependencies:** C6  
**Size:** M

---

### C8 — Consolidated Agents tab

**Commit:** feat(health): consolidate agent usage and outcomes

**Files**

- plugins/health/hooks/use-agents-data.ts (new)
- plugins/health/components/agents-tab.tsx (new)
- plugins/health/components/agents-usage-chart.tsx (new)
- plugins/health/components/agents-comparison.tsx (new)
- tests/plugins/health/agents-tab.test.tsx (new)

**Acceptance**

- One agents_window parameter drives 24h/7d/30d data.
- Trends include an exact table/takeaway.
- Observed, attributed, unattributed, completions, outcomes, and flags share
  one comparison surface.
- Latest transcript token traffic appears once and is accurately labeled.
- Cost scopes differ visibly; compact spend links to Models -> Spend.
- Compact containers stack rows rather than compressing tables.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/agents-tab.test.tsx tests/plugins/health/usage-history-route.test.ts tests/plugins/health/agent-diagnostics-routes.test.ts
~~~

**Dependencies:** C4, C5  
**Size:** M

---

### C9 — Failure-first Activity tab

**Commit:** feat(health): make activity failure-first

**Files**

- plugins/health/hooks/use-activity-data.ts (new)
- plugins/health/components/activity-tab.tsx (new)
- plugins/health/components/activity-row.tsx (new)
- plugins/health/components/activity-failure-trend.tsx (new)
- tests/plugins/health/activity-tab.test.tsx (new)

**Acceptance**

- URL stores window, kind, and include-routine state.
- Failures lead; routine success hides; routine failure never hides.
- Sparkline includes an exact bucket table.
- Human label/impact precede raw names, IDs, timing, metadata, and payload.
- Only the mounted tab polls at 15 seconds.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/activity-tab.test.tsx tests/plugins/health/routes.test.ts
~~~

**Dependencies:** C2, C4, C5  
**Size:** M

---

### C10 — Subsystem-first System tab

**Commit:** feat(health): add subsystem-first System view

**Files**

- plugins/health/hooks/use-system-data.ts (new)
- plugins/health/components/system-tab.tsx (new)
- plugins/health/components/system-search-section.tsx (new)
- plugins/health/components/system-inventory.tsx (new)
- tests/plugins/health/system-tab.test.tsx (new)

**Acceptance**

- Subsystem summaries lead.
- Search detail shows indexes, migrations, journal, enrichment, and checked
  mutation results before refreshing readiness.
- Plugin failures/upgrades precede Installed plugins.
- Runtime shows summed sessions, uptime, memory, port, PID, and Node.
- Full checks include healthy and not-applicable states grouped/collapsed.
- section=search focuses Search; raw compact tables scroll internally.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/system-tab.test.tsx tests/plugins/health/routes.test.ts
~~~

**Dependencies:** C5  
**Size:** M

---

### C11 — Activate the four URL-backed tabs

**Commit:** feat(health): switch to URL-backed Health IA

**Files**

- plugins/health/components/health-page.tsx
- tests/plugins/health/health-page.test.tsx

**Acceptance**

- Named Health CSS container and responsive PluginHeader.
- Base UI Tabs with Overview/Agents/Activity/System URL synchronization.
- Invalid tabs normalize to Overview; arrow keys and ARIA relationships work.
- Only selected tab mounts, so off-tab endpoints are never requested.
- Run checks is the primary action and explicit-only live status is announced.

**RED/GREEN**

~~~bash
bun test --isolate tests/plugins/health/health-page.test.tsx tests/plugins/health
bun run typecheck
bun run lint
~~~

**Dependencies:** C6, C7, C8, C9, C10  
**Size:** S

---

### C12 — Repeatable browser, responsive, and request-trace gate

**Commit:** test(health): add browser verification

**Files**

- scripts/verify-health-ui.ts (new)
- package.json

**Acceptance**

- Tests Overview, Agents, Activity, System, evidence, and repair states.
- Captures wide plus 1024/720/480/320 containers with the global activity panel
  open; documents the known phone shell failure; repeats Health-only narrow
  inspection with it hidden.
- Verifies keyboard tabs/disclosures/dialogs, focus restoration, reduced motion,
  overflow, console errors, failed requests, and off-tab polling.
- Request trace proves Health no longer leads its own Activity noise.
- All existing PluginHeader consumers receive browser or explicit unit/build
  coverage.

**Verification**

~~~bash
bun run dev:mock
bun run verify:health-ui --base-url http://127.0.0.1:3737
~~~

**Dependencies:** C11  
**Size:** M

---

### C13 — Delete the replaced flat dashboard

**Commit 1:** refactor(health): remove legacy flat cards

**Delete**

- plugins/health/components/health-sections.tsx
- plugins/health/components/supervision-sections.tsx
- plugins/health/components/usage-history-section.tsx
- plugins/health/components/search-section.tsx
- plugins/health/components/plugins-section.tsx

**Commit 2:** refactor(health): remove legacy polling

**Delete**

- plugins/health/components/use-health-data.ts
- tests/plugins/health/supervision-sections.test.tsx

**Acceptance**

- No duplicate latest-session/context surface.
- No page-wide 10-second fan-out or obsolete query parameters.
- Every retained behavior has direct new-tab coverage.

**Verification**

~~~bash
rg -n 'HEALTH_POLL_MS|usePolledJson|Latest Session Context|Context Usage|usage_tab|usage_window' plugins/health tests/plugins/health
bun test --isolate tests/plugins/health
bun run typecheck
~~~

**Dependencies:** C12 green  
**Size:** S + XS

---

### C14 — Operator docs and screenshots

**Commit:** docs(health): document action-first dashboard

**Files**

- docs/src/content/docs/using/health.md
- scripts/docs/screenshot-manifest.yaml
- docs/public/media/screenshots/using-health--dashboard.webp
- docs/public/media/screenshots/using-health--usage-panel.webp

**Acceptance**

- Tabs, statuses, freshness, Search stages, scopes, routine filtering, actions,
  repair verification, and the known shell limit are explained.
- Overview and Activity screenshots/captions/alt text match the product.

**Verification**

~~~bash
bun run docs:screenshots
bun run docs:check
~~~

**Dependencies:** C13  
**Size:** S

---

### C15 — Plugin-author and internal knowledge

**Commit 1:** docs(health): document canonical contracts

**Files**

- docs/src/content/docs/extending/plugins/server-contracts.md
- docs/src/content/docs/extending/sdk/overview.md
- .claude/knowledge/doctor-and-health-checks.md
- .claude/knowledge/plugin-system.md
- .claude/knowledge/agent-health-diagnostics.md

**Commit 2:** docs(knowledge): record Health UI and activity patterns

**Files**

- .claude/knowledge/usage-recording.md
- .claude/knowledge/style-guide.md

**Acceptance**

- Registration/run examples, validation, ownership, groups, resources,
  freshness, repair actions, activity classes, and no-message-parsing rules
  match the shipped contract.
- README is rechecked and changed only if implementation creates a stale claim.

**Verification**

~~~bash
rg -n 'HealthCheckResult|autoFixable|status.*fixed|summary.doctor' docs/src/content/docs .claude/knowledge README.md
bun run docs:check
~~~

**Dependencies:** C13  
**Size:** S + XS

---

### C16 — Regenerate references

**Commit:** docs(reference): regenerate canonical Health surfaces

**Expected generated files**

- docs/public/openapi.json
- docs/src/content/docs/reference/generated/api.mdx
- docs/src/content/docs/reference/generated/cli.mdx
- docs/src/content/docs/reference/generated/exec-tools.mdx
- docs/src/content/docs/reference/generated/hooks.mdx
- docs/src/content/docs/reference/generated/sdk.md
- docs/src/content/docs/reference/generated/core-plugins.md
- docs/.generated/coverage.json

**Acceptance**

- Generated API, SDK, CLI, exec-tool, hook, and core-plugin references contain
  only the canonical surface and exact manifest routes.
- No unrelated generated host asset is staged.

**Verification**

~~~bash
bun run docs:generate
bun run docs:check
git status --short
~~~

**Dependencies:** C14, C15  
**Size:** S

---

### C17 — Final regression, debugging, and independent review

No planned product changes. Any finding lands as a narrow conventional
fix/test/docs commit followed by the relevant gate rerun.

**Automated release gate**

~~~bash
bun test --isolate tests/plugins/health tests/components/plugin-header.test.tsx tests/components/charts.test.tsx tests/components/use-health-summary.test.tsx tests/components/health-badge-provider.test.tsx
bun run typecheck
bun run lint
bun run check:cycles
bun run build:plugins
bun run build:host
bun run verify:health-ui --base-url http://127.0.0.1:3737
bun run test
bun run docs:check
~~~

**Independent review axes**

- Contract/API stability and invalid-input behavior.
- Cache/concurrency/freshness and repair race safety.
- Security: secret-safe evidence, same-origin actions, no implicit mutations.
- Producer signal census and Search contradiction checks.
- UI IA, consumability, responsive behavior, accessibility, and request noise.
- Dead-code/legacy-contract scan and documentation parity.

**Final worktree acceptance**

- Project branch contains only intentional commits.
- packages/host/src/api/_embedded-assets-static.ts remains exactly the user’s
  unstaged change.
- No generated build stamps or browser artifacts are staged.
- Final report records tests, browser widths, request counts, review findings,
  and any remaining out-of-scope shell issue.

**Final verification — 2026-07-13**

- Full repository suite: 6,987 passed, 9 skipped, 0 failed across 720 files;
  isolated Kanban drag-and-drop suite: 11 passed, 0 failed.
- Focused Health suite: 221 passed, 0 failed. Browser verifier: 182 passed,
  0 failed, with two documented global-shell constraints at phone width.
- Typecheck, lint (0 errors), cycle guard (0 new), plugin build, host build,
  docs check, and diff whitespace checks passed.
- Documentation validated 45 pages and 322 routes; generated references and
  both Health screenshots match the shipped four-tab workspace.
- Independent contract, concurrency, producer-census, UI, documentation, and
  security/performance reviews completed. Findings were repaired and their
  focused gates rerun before the final full-suite pass.
- The user-owned `packages/host/src/api/_embedded-assets-static.ts` change was
  preserved unstaged and unmodified by this project.

## 4. Rollback strategy

- C0 is documentation only.
- C1 is the single contract boundary. Revert it as one unit; never cherry-pick
  individual C1 work packages.
- C2 is the activity-recorder boundary and also reverts as one unit.
- C3–C10 are additive foundations/tab implementations.
- C11 is the UI activation switch; reverting it restores the canonical flat
  dashboard while preserving all backend work.
- C13 deletes legacy UI only after browser approval, so it can be reverted
  independently if needed.
- Docs/generated commits are last and contain no runtime behavior.

## 5. Scope control

Always preserve the approved contract, tests, documentation, semantic tokens,
container responsiveness, and explicit repair verification. Ask before adding
a dependency, altering the global shell, changing doctor cadence/escalation
defaults, or expanding into the global style-guide sweep. Never introduce a
legacy adapter, dual Health response, message-derived identity, synthetic score,
silent failure, or automatic destructive repair.
