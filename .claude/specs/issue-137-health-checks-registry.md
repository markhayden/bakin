# Health Checks Registry (#137)

**Status:** Draft
**Tracking issue:** [#137](https://github.com/madeinwyo/bakin/issues/137)
**Depends on:** PRs #126 (channels registry) and #131 (models UX) for established patterns
**Unblocks:** `assets.renderers` (final registry); then the adapter layer work

## Problem Statement

`src/core/doctor.ts` (1808 lines) hardcodes 17 diagnostic checks inline. Three of them read workflows-plugin data (`checkWorkflowDefinitions`, `checkStaleWorkflowInstances`, `checkWorkflowSkills`) but live in core because there's no extension point for plugins to contribute doctor checks.

Two concrete pains fall out of this:

1. **Ownership is wrong.** The workflows plugin owns the data these checks interrogate but can't own the check code. Any evolution of the data model requires touching core.
2. **Third-party plugins can't participate.** A future Mastodon publisher plugin (or any marketplace plugin) has no way to register "Mastodon API reachable?" as a doctor-dashboard check without editing `src/core/doctor.ts`.

Unlike `models.providers` (#128, closed as premature abstraction), this registry has a forcing function baked in: three existing checks want to move out of core right now.

## Goals

- Add a `health.checks` registry extension point — 4th of the five called out in `docs/ideas/plugin-system.md`.
- `ctx.registerHealthCheck(...)` on `PluginContext`, mirroring the `registerNotificationChannel` precedent exactly: auto-namespaced ids, error-isolated execution, clean teardown on hot reload.
- Orchestrator integration: `runDiagnostics()` transparently gains plugin-registered checks alongside the builtin sweep.
- **Proof-of-pattern migration:** move the 3 workflow-owned checks out of `src/core/doctor.ts` into the workflows plugin. Pattern is validated the moment this PR lands — not speculative.
- Cross-plugin read paths (`health.listChecks` hook + `GET /api/plugins/health/checks`) so admin surfaces can introspect what's registered.

## Non-Goals

- Not migrating all 17 core checks. Only the 3 workflows-owned ones. Future migrations happen when each owner plugin is touched anyway.
- Not changing the `bakin doctor` CLI surface — it calls `runDiagnostics()` which transparently gains plugin results.
- Not building admin UI for toggling individual checks on/off.
- Not merging with the `src/core/onboarding/` `check()/install()` contract — that's first-run bootstrap, different purpose and cadence.
- No manifest changes — runtime registration only, matching channels + node-types.
- Not introducing check scheduling, priority ordering, or inter-check dependencies. Plugin checks run in parallel after the builtin sweep.
- No sub-namespace on ctx (e.g. no `ctx.health.register(...)`) — flat `registerHealthCheck` matches the other register* methods.

## Design

### Types (core)

Add to `packages/core/src/plugin-types.ts` after the notification-channel block:

```ts
// ---------------------------------------------------------------------------
// Health check registration
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

export interface PluginHealthCheckInput {
  /** Short id, auto-namespaced as `{pluginId}.{id}`. */
  id: string
  /** Human-readable label for admin UIs. */
  name: string
  /** Runs the check, returns any number of result rows. Failures (thrown or
   *  rejected) are caught by the orchestrator and converted to a synthetic
   *  error result — a single bad handler never crashes the doctor sweep. */
  run: () => Promise<HealthCheckResult[]>
  /** Advisory flag for UIs: true if run() may perform auto-fixes internally.
   *  Pure metadata for v1; the orchestrator calls every registered check
   *  regardless of this value. */
  autoFix?: boolean
}

export interface HealthCheckDef extends PluginHealthCheckInput {
  runtime: 'plugin'
  pluginId: string
}
```

`HealthCheckResult` is shape-identical to the existing `DiagnosticResult` in `src/core/doctor.ts`. Going forward both types refer to the same thing; `DiagnosticResult` remains a type alias in doctor.ts for now to avoid a noisy rename.

### Registry store

New file `plugins/health/lib/health-check-registry.ts`, mirroring `plugins/workflows/lib/notification-channel-registry.ts`:

```ts
const registry = new Map<string, HealthCheckDef>()

export function registerHealthCheck(def: HealthCheckDef): void
export function getHealthCheck(id: string): HealthCheckDef | undefined
export function listHealthChecks(): HealthCheckDef[]
export function unregisterHealthCheck(id: string): void
export function unregisterPluginHealthChecks(pluginId: string): void

/** Plugin wrapper — namespaces id to `{pluginId}.{id}`, returns namespaced id. */
export function registerPluginHealthCheck(
  pluginId: string,
  input: PluginHealthCheckInput,
): string
```

**No builtins.** Unlike channels and node-types, the core `src/core/doctor.ts` checks stay as direct calls in `runDiagnostics()` — the registry is purely for plugin contributions. Doctor remains the single place that knows about core checks; the registry adds a second, plugin-scoped layer on top.

### PluginContext surface

`packages/core/src/plugin-types.ts`:

```ts
/**
 * Register a health check owned by this plugin. The id is auto-namespaced
 * to `{pluginId}.{id}`. `run()` is invoked during every `runDiagnostics()`
 * sweep; throws are isolated — one bad check doesn't crash the doctor.
 * Returns the namespaced id.
 */
registerHealthCheck(def: PluginHealthCheckInput): string
```

`src/lib/plugin-registry.ts` wires it through the `registerPluginHealthCheck` helper (mirror of `registerNotificationChannel` wiring), adds `healthCheckIds: string[]` to `PluginState`, and calls `unregisterPluginHealthChecks(pluginId)` in the user-plugin-override teardown path at :354.

### Orchestrator integration

`src/core/doctor.ts` `runDiagnostics()` gains a plugin-check pass after the existing builtin sweep:

```ts
// ... existing builtin checks ...
results.push(...await Promise.all(/* existing async checks */))

// Plugin-contributed checks — isolated try/catch per check so one bad
// handler doesn't crash the whole doctor pass.
const pluginChecks = listHealthChecks()
const pluginResults = await Promise.all(
  pluginChecks.map(async (def) => {
    try {
      return await def.run()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return [{
        check: def.id,
        status: 'error' as const,
        message: `Plugin health check threw: ${message}`,
        autoFixable: false,
      }]
    }
  })
)
results.push(...pluginResults.flat())
```

Plugin check results are appended to the same `DiagnosticResult[]` as builtins — no separate section. The health page UI already groups by status, so ordering doesn't matter for display.

### Cross-plugin read surface

`plugins/health/index.ts` — registers two hooks + one REST route during `activate()`:

```ts
ctx.hooks.register('health.listChecks', () => listHealthChecks().map(d => ({
  id: d.id,
  name: d.name,
  pluginId: d.pluginId,
  autoFix: !!d.autoFix,
})))

ctx.hooks.register('health.getCheck', (d: Record<string, unknown>) => {
  const def = getHealthCheck(d.id as string)
  return def ? { id: def.id, name: def.name, pluginId: def.pluginId, autoFix: !!def.autoFix } : null
})

ctx.registerRoute({
  path: '/checks',
  method: 'GET',
  description: 'List registered plugin health checks (does not execute them).',
  handler: async () => Response.json({
    checks: listHealthChecks().map(d => ({
      id: d.id, name: d.name, pluginId: d.pluginId, autoFix: !!d.autoFix,
    })),
  }),
})
```

Hook returns + REST payload strip the `run` function — handlers can't be serialized and consumers only want metadata.

### Migration — workflows plugin

Three `src/core/doctor.ts` functions move to the workflows plugin:

1. **`checkWorkflowDefinitions`** (`doctor.ts:1139`) — reads `getHookRegistry().invoke('workflows.listDefinitions')`, cross-references skill references against `{contentDir}/workflows/skills/`. Move verbatim into `plugins/workflows/lib/health-checks.ts`; the hook invocation becomes a direct function call since we're already inside the workflows plugin.

2. **`checkStaleWorkflowInstances`** (`doctor.ts:1175`) — reads `{contentDir}/workflows/instances/*.json`, flags anything `in_progress` for >2 hours. The `autoFix` parameter becomes an internal check of `getSettings().doctor.autoFixSkill` since the registry signature doesn't pass parameters to `run()`.

3. **`checkWorkflowSkills`** (`doctor.ts:1102`) — compares bundled `plugins/workflows/defaults/workflow-skills/*.md` against user's `{contentDir}/workflows/skills/`.

In `plugins/workflows/index.ts:activate()`:

```ts
ctx.registerHealthCheck({
  id: 'definitions',
  name: 'Workflow definition integrity',
  run: () => checkWorkflowDefinitions(getContentDir()),
})
ctx.registerHealthCheck({
  id: 'stale-instances',
  name: 'Stale workflow instances',
  autoFix: true,
  run: () => checkStaleWorkflowInstances(getContentDir()),
})
ctx.registerHealthCheck({
  id: 'skills',
  name: 'Workflow skills bundled vs installed',
  run: async () => checkWorkflowSkills(getContentDir()),
})
```

Delete the three function definitions from `doctor.ts`. Remove the three `results.push(...)` lines in `runDiagnostics()`. The plugin-registry loop picks them up.

### File inventory

- `packages/core/src/plugin-types.ts` — add types + `registerHealthCheck` method
- `src/lib/plugin-types.ts` — extend re-export list
- `src/lib/plugin-registry.ts` — import helpers, add `healthCheckIds` to `PluginState`, wire `registerHealthCheck`, extend teardown
- `plugins/health/lib/health-check-registry.ts` — new file, Map store + helpers
- `plugins/health/index.ts` — register `health.listChecks` + `health.getCheck` hooks + `GET /checks` route
- `src/core/doctor.ts` — append plugin-check loop to `runDiagnostics()`; delete three migrated functions
- `plugins/workflows/lib/health-checks.ts` — new file housing the three migrated functions
- `plugins/workflows/index.ts` — three `ctx.registerHealthCheck(...)` calls in `activate()`
- `tests/plugins/health/health-check-registry.test.ts` — new
- `tests/plugins/health/checks-route.test.ts` — new (route + hook integration)
- `tests/plugins/workflows/health-checks.test.ts` — new (migration proof)

All 8 `PluginContext`-literal sites (plugin-registry, route.ts, test-helpers, contract.test, 4 misc test files) need a `registerHealthCheck` stub.

## Resolved Decisions

- **Flat `ctx.registerHealthCheck(...)`, no `ctx.health.*` sub-namespace.** PluginContext's rule of thumb: one-shot register-a-thing methods are flat (registerNav/Route/Slot/ExecTool/Skill/Workflow/NodeType/NotificationChannel — 7 precedents); multi-verb APIs get a namespace (activity.*, hooks.*, search.*). Health checks is one-shot. If we ever add `runCheck(id)` or similar, introducing `ctx.health.*` alongside the existing method is additive and non-breaking.
- **Registry owned by the health plugin** (`plugins/health/lib/health-check-registry.ts`), not by core. Matches how workflows owns `notification-channel-registry.ts`. Core `doctor.ts` imports from the plugin — same directionality as `src/lib/plugin-registry.ts` importing from `plugins/workflows/` today.
- **`autoFix` is pure metadata.** No orchestrator behavior hangs off it; every registered check's `run()` is always called. Plugins that do internal auto-fixes gate on `getSettings().doctor.autoFixSkill` themselves. UI + summary log can surface the metadata. Future-widening to "orchestrator skips auto-fix checks when the setting is off" is non-breaking.
- **Plugin checks run after the builtin sweep, appended to the same result list.** No interleaving, no ordering logic. Health page UI groups by status, so order doesn't matter for display.
- **Failures in a plugin's `run()` yield a synthetic error result, not a crash.** Doctor sweep always completes. Core checks + other plugin checks are unaffected by one bad handler.
- **`HealthCheckResult` shape-identical to `DiagnosticResult` — coexist for now, collapse once the last check migrates out of doctor.ts.** Not unbounded tech debt: `DiagnosticResult` stays as the existing export from `doctor.ts`, `HealthCheckResult` is the new canonical export from `packages/core/src/plugin-types.ts`. They point at the same shape. Once all 17 checks have been migrated to owner plugins (this PR does 3; the other 14 migrate when their owners are touched anyway), `doctor.ts` can delete `DiagnosticResult` and every consumer imports `HealthCheckResult` instead. Tracked as follow-up: `chore(core): collapse DiagnosticResult into HealthCheckResult after all checks migrate` (filed when this PR merges).
- **Hook name stays `health.listChecks` (not `health.list`).** Six existing hooks use the `list{Noun}` pattern (`workflows.listDefinitions`, `team.listAgents`, etc). Switching health alone creates inconsistency. Switching all six together is a coordinated rename affecting every plugin — worth doing as its own focused PR. Tracked as follow-up: `chore: hook-name parity pass — rename all list{Noun} hooks to {namespace}.list` (filed when this PR merges).
- **REST route response includes `pluginId` per check.** Namespacing is already visible in the id string (`workflows.definitions`) but an explicit `pluginId` field makes client-side grouping cheaper and doesn't cost anything on the wire.

## Open Questions

None remain. All decisions locked; two follow-up issues captured under Resolved Decisions.

## Acceptance Criteria

- [ ] `registerHealthCheck` method exists on `PluginContext`, auto-namespaces plugin ids as `{pluginId}.{id}`
- [ ] Plugin-registry wiring mirrors `registerNotificationChannel` — imports, `PluginState.healthCheckIds: string[]`, teardown at user-plugin-override site
- [ ] New `plugins/health/lib/health-check-registry.ts` with register/get/list/unregister + plugin namespacing helper + unregisterPluginHealthChecks
- [ ] `health.listChecks` + `health.getCheck` hooks registered; `GET /api/plugins/health/checks` route registered
- [ ] `src/core/doctor.ts` `runDiagnostics()` appends plugin-check results to the same list as builtins, with per-check try/catch isolation
- [ ] `checkWorkflowDefinitions`, `checkStaleWorkflowInstances`, `checkWorkflowSkills` moved out of `doctor.ts` into `plugins/workflows/lib/health-checks.ts`
- [ ] Workflows plugin's `activate()` registers the three checks via `ctx.registerHealthCheck`
- [ ] `runDiagnostics()` no longer calls the three functions directly
- [ ] Unit tests: registry add/collision/list/get/unregister + plugin namespacing + plugin teardown
- [ ] Integration test: activate health plugin, call `/checks`, assert empty result before any other plugin registers; then activate workflows, re-call, assert 3 entries
- [ ] Orchestrator test: mock a plugin check that throws → doctor sweep completes, the failing check yields a synthetic error result, other checks still run
- [ ] Migration test: workflows health checks produce the same `DiagnosticResult[]` shape they did before the move (fixture-based)
- [ ] `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Grep: `checkWorkflowDefinitions|checkStaleWorkflowInstances|checkWorkflowSkills` in `src/core/doctor.ts` returns zero hits

## Testing Strategy

Follow CLAUDE.md rules (mock `content-dir`, `logger`, `watcher`, `openclaw-client`, `tasks/flow-store`). Registry tests follow the shape of `tests/plugins/workflows/notification-channel-registry.test.ts`.

- **`tests/plugins/health/health-check-registry.test.ts`** — full surface coverage: register/get/list/unregister, collision throw, plugin namespacing correctness, plugin teardown leaves nothing behind, registry starts empty.
- **`tests/plugins/health/checks-route.test.ts`** — activate health plugin via `activatePlugin` helper, call `GET /checks` on an empty registry (returns `{ checks: [] }`), register a fake check, call again, assert payload.
- **`tests/plugins/workflows/health-checks.test.ts`** — fixture directories with valid definitions, stale instances, missing skills. Assert each migrated function returns the same shape / count of `DiagnosticResult` rows as the old inline versions did.
- **Doctor orchestrator test** — extend `tests/core/` coverage (or create new `tests/core/doctor-plugin-checks.test.ts`): register two plugin checks, one that returns ok and one that throws, run `runDiagnostics()`, assert both appear in the result (synthetic error for the throwing one).

## Sequencing

1. **feat(core): HealthCheckResult types + PluginContext.registerHealthCheck** — core types + stubs at all ctx-literal sites (1 commit)
2. **feat(health): health-check-registry with plugin namespacing + teardown** — new registry file + unit tests (1 commit)
3. **feat(core): wire registerHealthCheck through plugin-registry** — imports, `PluginState.healthCheckIds`, teardown mirror (1 commit)
4. **feat(health): list hooks + REST route** — `health.listChecks` / `health.getCheck` / `GET /checks` (1 commit)
5. **feat(core): run plugin health checks in runDiagnostics** — orchestrator integration with per-check try/catch (1 commit)
6. **refactor(workflows): migrate workflow health checks out of core/doctor.ts** — move functions, register in activate(), delete from doctor.ts (1 commit)
7. **test(health): orchestrator isolation + migration regression** — remaining test coverage (1 commit)
8. **Ship** — push, PR, smoke, merge

Each commit builds clean and passes tests. Commit 1 adds interface; commits 2-5 wire it up; commit 6 is the forcing-function migration; commit 7 closes gaps.

## Not Doing (and Why)

- **Migrating the other 14 checks out of `doctor.ts`** — out of scope; each gets migrated when its owner plugin is touched for unrelated reasons. Avoids a sprawl PR.
- **Admin UI for toggling plugin checks** — the health page already groups results by status. Disabling individual checks is a future feature once users ask for it.
- **Merging with the onboarding `check()/install()` contract** — different purposes: onboarding = first-run bootstrap, doctor = ongoing health. Shared result type would tempt unification that doesn't make sense semantically.
- **Check scheduling / priority / dependencies** — the doctor sweep is atomic; every check runs every pass. Introducing staged execution is a v2+ concern.
- **Per-check enable/disable settings** — plugins that want this can read their own settings and early-return from `run()`. Don't need orchestrator-level machinery.
- **Manifest declaration of contributed checks** — runtime registration only, same as channels + node-types. Manifest work happens in the future plugin-system distribution spec.
- **Widening `autoFix` into orchestrator skip behavior** — advisory metadata only in v1. Non-breaking to add later.
- **Collapsing `DiagnosticResult` and `HealthCheckResult` into one canonical type** — follow-up refactor after both names have been around long enough to pick the right survivor.
