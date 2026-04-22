# Plan — Issue #137: Health Checks Registry

**Spec:** `.claude/specs/issue-137-health-checks-registry.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/137
**Branch:** `issue-137-health-checks-registry`
**Precedent to mirror:** `workflows.notificationChannels` (#125 / PR #126) — same registry shape, same wiring, same teardown.

## Goal

Land the 4th Registry Extension Point from `docs/ideas/plugin-system.md`: `health.checks`. Core surface + plugin-registry wiring + orchestrator integration, with the workflows-plugin migration as the forcing-function proof. Pattern is validated the moment three existing core checks move into their owning plugin without breaking the doctor dashboard.

## Dependency graph

```
T0 scaffold (archive #129 tasks, commit spec + plan + todo)
  │
  ▼
T1 core types + ctx stubs .................... (foundation for everything)
  │
  ▼
T2 health-check-registry store ................ (depends on T1 types)
  │
  ▼
T3 plugin-registry wiring + teardown ........... (depends on T2; replaces T1 stub)
  │                                                       ↓
  ▼                                              Checkpoint: registry usable
T4 health plugin hooks + REST route ............ (depends on T2; parallel-safe with T5)
  │
  ▼
T5 orchestrator integration in doctor.ts ....... (depends on T2; can land before or after T4)
  │                                                       ↓
  ▼                                              Checkpoint: plugin checks execute
T6 workflows migration (3 checks) .............. (depends on T3 + T5)
  │                                                       ↓
  ▼                                              Checkpoint: migration complete
T7 regression gap-fill tests
  │
  ▼
T8 ship
```

Solo sequential in practice. Each commit builds and passes tests — interim stubs in T1 exist specifically to keep tsc green across T1–T3.

## Task detail

### T0 — chore(issue-137): spec + plan scaffold

**Status:** partial. Branch + spec exist uncommitted. `tasks/*.md` still holds #129 content.

**Steps:**
- Archive `tasks/plan.md` + `tasks/todo.md` (#129 content) → `.claude/tasks/issue-129-{plan,todo}.md` via `git mv`
- Commit staged renames + spec + this plan + todo together

**Acceptance:**
- [ ] `.claude/tasks/issue-129-{plan,todo}.md` present with #129 content
- [ ] `tasks/plan.md` + `tasks/todo.md` contain this new #137 content
- [ ] `.claude/specs/issue-137-health-checks-registry.md` committed
- [ ] `git status` clean after commit

**Commit:** `chore(issue-137): spec + plan scaffold`

---

### T1 — feat(core): HealthCheckResult types + PluginContext.registerHealthCheck

**Shape changes:**
- `packages/core/src/plugin-types.ts` — add `HealthCheckResult`, `PluginHealthCheckInput`, `HealthCheckDef` types (per spec §Design)
- Add `registerHealthCheck(def: PluginHealthCheckInput): string` method to `PluginContext`
- `src/lib/plugin-types.ts` — extend re-export list

**Interim stubs** (keep tsc green until T3 wires the real path):
All 8 `PluginContext`-literal sites get `registerHealthCheck: (def) => \`${pluginId}.${def.id}\`` (or `vi.fn(() => '')` in test files — same shape #125 used for `registerNotificationChannel`):
- `src/lib/plugin-registry.ts` (insert after `registerNotificationChannel` ~line 220)
- `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` (two sites)
- `tests/plugins/test-helpers.ts`
- `tests/plugins/contract.test.ts`
- `tests/plugins/projects/sync-hook.test.ts`
- `tests/plugins/workflows/sync-hook.test.ts`
- `tests/plugins/assets/unlink-hook.test.ts`
- `tests/plugins/assets/retype-preserves-search.test.ts`
- `tests/integration/search-watcher-sync.test.ts`

**Acceptance:**
- [ ] Types exported from both core + re-export
- [ ] `PluginContext.registerHealthCheck` signature present
- [ ] All 8 ctx-literal sites stubbed
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm vitest run` green

**Commit:** `feat(core): HealthCheckResult types + PluginContext.registerHealthCheck`

---

### T2 — feat(health): health-check-registry store + unit tests

**New file:** `plugins/health/lib/health-check-registry.ts` — mirror `plugins/workflows/lib/notification-channel-registry.ts`:

```ts
const registry = new Map<string, HealthCheckDef>()

export function registerHealthCheck(def: HealthCheckDef): void     // throws on duplicate id
export function getHealthCheck(id: string): HealthCheckDef | undefined
export function listHealthChecks(): HealthCheckDef[]
export function unregisterHealthCheck(id: string): void
export function unregisterPluginHealthChecks(pluginId: string): void

export function registerPluginHealthCheck(
  pluginId: string,
  input: PluginHealthCheckInput,
): string  // namespaces id to `{pluginId}.{id}`, returns namespaced id
```

**No builtin self-seeding** — unlike channels/node-types, core doctor checks stay as direct calls. Registry is plugin-contributions-only.

**New test:** `tests/plugins/health/health-check-registry.test.ts` — mirror `tests/plugins/workflows/notification-channel-registry.test.ts`:
- register + retrieve + list
- collision throw
- `registerPluginHealthCheck` namespaces correctly
- `unregisterPluginHealthChecks(pluginId)` removes only that plugin's entries
- registry starts empty (no builtin seeds)

**Acceptance:**
- [ ] 6 exports on the module matching the precedent
- [ ] 6+ unit-test assertions pass
- [ ] `pnpm tsc --noEmit` clean

**Commit:** `feat(health): health-check-registry with plugin namespacing + teardown`

---

### T3 — feat(core): wire registerHealthCheck through plugin-registry

**Edits to `src/lib/plugin-registry.ts`:**

1. Import `registerPluginHealthCheck` + `unregisterPluginHealthChecks` alongside the workflows helpers (around :24)
2. Add `healthCheckIds: string[]` field to `PluginState`
3. Initialize `healthCheckIds: []` at both `PluginState` construction sites (search for `nodeKinds: []` — two sites)
4. Replace T1's interim stub at ~:220 with real impl:
   ```ts
   registerHealthCheck: (def: PluginHealthCheckInput): string => {
     try {
       const namespacedId = registerPluginHealthCheck(pluginId, def)
       state.healthCheckIds.push(namespacedId)
       return namespacedId
     } catch (err) {
       log.error(
         `registerHealthCheck collision in plugin "${pluginId}" for id "${def.id}"`,
         err as Error,
       )
       return `${pluginId}.${def.id}`
     }
   }
   ```
5. Extend teardown at `:372` (user-plugin-override path — verified single teardown site):
   ```ts
   unregisterPluginNodeTypes(pluginId)
   unregisterPluginNotificationChannels(pluginId)
   unregisterPluginHealthChecks(pluginId)  // NEW
   ```

**Acceptance:**
- [ ] Real impl replaces T1 stub at production plugin-registry site only
- [ ] Other 7 stubs stay (tests + per-request context that doesn't need the real registry)
- [ ] Teardown updated
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Checkpoint: registry functional end-to-end — a plugin calling `ctx.registerHealthCheck(...)` writes to the real Map

**Commit:** `feat(core): wire registerHealthCheck through plugin-registry`

---

### T4 — feat(health): list hooks + REST route

**Edits to `plugins/health/index.ts`** in `activate(ctx)`:
- `ctx.hooks.register('health.listChecks', () => listHealthChecks().map(stripRun))`
- `ctx.hooks.register('health.getCheck', (d) => { const def = getHealthCheck(d.id as string); return def ? stripRun(def) : null })`
- `ctx.registerRoute({ path: '/checks', method: 'GET', handler: async () => json({ checks: listHealthChecks().map(stripRun) }) })`

Where `stripRun(def) = { id, name, pluginId, autoFix }` — omits non-serializable `run`.

**New test:** `tests/plugins/health/checks-route.test.ts` — activate the health plugin via `activatePlugin`, assert:
- `/checks` returns `{ checks: [] }` on a fresh registry
- After `registerHealthCheck(...)` via the plugin helper, the route returns that entry with correct shape (no `run` field)

**Acceptance:**
- [ ] Hooks registered with documented shape
- [ ] Route registered at `/checks`
- [ ] Test asserts empty + populated cases
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run` clean

**Commit:** `feat(health): expose registered checks via hooks + REST route`

---

### T5 — feat(core): run plugin health checks in runDiagnostics

**Edits to `src/core/doctor.ts`:**

1. Import `listHealthChecks`:
   ```ts
   import { listHealthChecks } from '../../plugins/health/lib/health-check-registry'
   ```
2. At the end of `runDiagnostics()` (after the existing `await Promise.all(...)` block around :1732), append:
   ```ts
   // Plugin-contributed health checks (#137). Per-check try/catch so one
   // bad handler never crashes the sweep.
   const pluginChecks = listHealthChecks()
   const pluginResultArrays = await Promise.all(
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
     }),
   )
   results.push(...pluginResultArrays.flat())
   ```

**New test file:** `tests/core/doctor-plugin-checks.test.ts` — `src/core/doctor.ts` has no dedicated test today; gap-filling is fair game.

Test cases:
- Register a plugin check that returns `[{ status: 'ok', ... }]` → appears in `runDiagnostics()` results
- Register a plugin check that throws synchronously → synthetic error result appears, other checks still complete
- Register a plugin check that rejects async → same synthetic-error behavior
- Plugin check results appear alongside (not replacing) builtin check results — asserts `results.length` grew by exactly the plugin-check count

Doctor test requires extensive mocks per CLAUDE.md (content-dir, openclaw-client, settings, etc.) — focus on the plugin-check code path; mock the existing builtin checks to a stable baseline.

**No UI verification needed:** `plugins/health/components/health-page.tsx:28` consumes `DiagnosticResult`-shaped rows. Plugin check results are shape-identical, so no UI change is required. Confirmed by inspection.

**Acceptance:**
- [ ] `runDiagnostics()` ends with the plugin-check Promise.all + results.push
- [ ] Throws in plugin checks never propagate out of runDiagnostics
- [ ] 3+ new tests pass
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Checkpoint: a plugin check registered via the real pipeline appears in doctor output end-to-end

**Commit:** `feat(core): run plugin health checks in runDiagnostics`

---

### T6 — refactor(workflows): migrate 3 workflow checks out of core

**The forcing function.** Until this commit, `health.checks` is infrastructure nobody uses. This is where it becomes live.

**New file:** `plugins/workflows/lib/health-checks.ts` — move three functions out of `src/core/doctor.ts`:
- `checkWorkflowDefinitions` from `doctor.ts:1139`
- `checkStaleWorkflowInstances` from `doctor.ts:1175`
- `checkWorkflowSkills` from `doctor.ts:1102`

**Internalization during move:**
- `checkWorkflowDefinitions` currently calls `getHookRegistry().invoke('workflows.listDefinitions', {})`. Replace with direct import from `plugins/workflows/lib/source-registry` (or wherever `listDefinitions` is defined). Verify shape match during build.
- `checkStaleWorkflowInstances` currently takes `autoFix: boolean`. After move, read `getSettings().doctor.autoFixSkill` inline (reuse the core settings-read pattern). Its `hooks.invoke('workflows.listInstances', {})` becomes a direct `listInstances()` import. Its `hooks.invoke('tasks.readTaskboard', {})` STAYS as a hook — workflows→tasks is legitimate cross-plugin communication.
- `checkWorkflowSkills` is sync, filesystem-only. No internalization needed.

**Helpers needed:** `ok()`, `warn()`, `fixed()` constructors from `doctor.ts`. Inline them at the top of `plugins/workflows/lib/health-checks.ts` (4 lines each, trivial). Keeps the plugin self-contained for eventual helper migration in a follow-up PR.

**Edits to `plugins/workflows/index.ts`** in `activate(ctx)`:
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
  name: 'Workflow skills validation',
  run: async () => checkWorkflowSkills(getContentDir()),
})
```

**Edits to `src/core/doctor.ts`:**
- Delete three function definitions: `checkWorkflowDefinitions`, `checkStaleWorkflowInstances`, `checkWorkflowSkills`
- Delete three `results.push(...)` calls in `runDiagnostics()`

**New test:** `tests/plugins/workflows/health-checks.test.ts` — fixture directories with:
- Valid + invalid workflow definitions (resolvable vs. broken skill references)
- Stale + fresh workflow instances
- Skills with + without `output_schema`

Assert each migrated function produces the same `DiagnosticResult[]` count + shape as before the move. Invoke the run functions directly (not through the registry — that's T7's job).

**Acceptance:**
- [ ] `plugins/workflows/lib/health-checks.ts` exists with 3 function exports
- [ ] Workflows plugin `activate()` registers all 3 via `ctx.registerHealthCheck`
- [ ] `src/core/doctor.ts` no longer defines or calls the 3 functions
- [ ] Migration regression test passes — output shapes identical
- [ ] Full `runDiagnostics()` still produces the same check coverage (via the plugin registry)
- [ ] `grep "checkWorkflowDefinitions\|checkStaleWorkflowInstances\|checkWorkflowSkills" src/core/doctor.ts` → 0 hits
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Checkpoint: migration complete, pattern validated end-to-end

**Commit:** `refactor(workflows): migrate workflow health checks out of core/doctor.ts`

---

### T7 — test(health): orchestrator isolation + migration regression

Gap-fill anything T5 and T6 didn't cover:

- **Integration test:** activate BOTH workflows + health plugins through `activatePlugin`, call `runDiagnostics()`. Assert the 3 workflow-owned checks appear in the results with correct `{pluginId}.{id}` naming.
- **Isolation test** (if not already in T5): plugin A throws + plugin B returns results → plugin B still appears.
- **End-to-end shape regression:** verify the `plugins/health/components/health-page.tsx` consumer path doesn't break with plugin-contributed rows. Manual eyeball if writing the component test feels heavyweight; a lightweight integration assertion is enough.

**Acceptance:**
- [ ] Any coverage gap identified at T5/T6 closure is filled
- [ ] Full `pnpm vitest run` clean
- [ ] `pnpm tsc --noEmit` clean

**Commit:** `test(health): regression guards + migration isolation`

---

### T8 — Ship

- [ ] Push branch: `git push -u origin issue-137-health-checks-registry`
- [ ] Open PR against `main` — reference #137, link spec, mention the 2 follow-ups to file on merge
- [ ] Quick manual smoke: `bakin doctor` on the other machine should produce the same check output as before (the 3 workflow checks are now plugin-contributed; user shouldn't notice any difference)
- [ ] File 2 follow-ups (per spec):
  - `chore(core): collapse DiagnosticResult into HealthCheckResult after all checks migrate`
  - `chore: hook-name parity pass — rename all list{Noun} hooks to {namespace}.list`
- [ ] Merge when green
- [ ] Close #137 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-137-{plan,todo}.md`

## Risks & call-outs

- **T5 imports plugin code from core.** `src/core/doctor.ts` imports `listHealthChecks` from `plugins/health/lib/`. This reverses the usual core-doesn't-depend-on-plugins direction. Justified — `src/lib/plugin-registry.ts:24` already imports from `plugins/workflows/lib/` for the same reason. The owner plugin's registry module IS the source of truth for that extension point. Document in commit message.
- **T6 internalization of hook calls.** `checkWorkflowDefinitions` uses a hook to reach `listDefinitions`. Moving into the workflows plugin, we replace that with a direct import. Risk: if the hook handler does any transformation, the direct call might have a different shape. Verify during T6 — may need a small adapter layer.
- **T5 test setup complexity.** `runDiagnostics()` has 18+ imports and reads many filesystem paths. Mocking everything for a full run is expensive. Prefer testing the plugin-check loop in isolation — register mock plugin checks, mock the builtin-check side to a stable baseline, assert only the plugin-check-path behavior. We're adding a new loop at the end, not regressing existing behavior.
- **Commit sequencing invariant.** T1 stubs MUST be at all 8 sites before merging — if we land T1 with only 7 stubbed, the 8th file breaks tsc. Grep all 8 paths during T1 before committing.

## Archival

After merge, T8 moves `tasks/plan.md` + `tasks/todo.md` into `.claude/tasks/issue-137-{plan,todo}.md` — matches the `issue-115-`, `issue-118-`, `issue-125-`, `issue-129-` archival pattern.
