# TODO: Issue #137 — Health Checks Registry

**Spec:** `.claude/specs/issue-137-health-checks-registry.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/markhayden/bakin/issues/137
**Branch:** `issue-137-health-checks-registry`

## T0 — Branch + scaffold commit

- [x] `git checkout -b issue-137-health-checks-registry` (already done)
- [x] Write spec at `.claude/specs/issue-137-health-checks-registry.md`
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` (current content is #129) → `.claude/tasks/issue-129-{plan,todo}.md`
- [ ] Commit: `chore(issue-137): spec + plan scaffold`

## T1 — feat(core): HealthCheckResult types + PluginContext.registerHealthCheck

- [ ] Add `HealthCheckResult`, `PluginHealthCheckInput`, `HealthCheckDef` in `packages/core/src/plugin-types.ts`
- [ ] Add `registerHealthCheck(def): string` method to `PluginContext`
- [ ] Extend re-export list in `src/lib/plugin-types.ts`
- [ ] Interim stubs at all 8 ctx-literal sites (plugin-registry + route.ts:2sites + 6 test files)
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(core): HealthCheckResult types + PluginContext.registerHealthCheck`

## T2 — feat(health): health-check-registry store + unit tests

- [ ] New file `plugins/health/lib/health-check-registry.ts`
- [ ] Exports: `registerHealthCheck` / `getHealthCheck` / `listHealthChecks` / `unregisterHealthCheck` / `unregisterPluginHealthChecks` / `registerPluginHealthCheck`
- [ ] No builtin seeding (plugin-contributions-only)
- [ ] New test `tests/plugins/health/health-check-registry.test.ts` — mirror `notification-channel-registry.test.ts`
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run tests/plugins/health/` clean
- [ ] Commit: `feat(health): health-check-registry with plugin namespacing + teardown`

## T3 — feat(core): wire registerHealthCheck through plugin-registry

- [ ] Import `registerPluginHealthCheck` + `unregisterPluginHealthChecks` in `src/lib/plugin-registry.ts`
- [ ] Add `healthCheckIds: string[]` to `PluginState` + both construction sites
- [ ] Replace T1 stub at production site with real impl (try/catch + log + push)
- [ ] Add `unregisterPluginHealthChecks(pluginId)` at teardown site `:372`
- [ ] Checkpoint: `pnpm tsc --noEmit` + full `pnpm vitest run` clean
- [ ] Commit: `feat(core): wire registerHealthCheck through plugin-registry`

## T4 — feat(health): list hooks + REST route

- [ ] Register `health.listChecks` + `health.getCheck` hooks in `plugins/health/index.ts:activate()`
- [ ] Register `GET /checks` route returning `{ checks: [{ id, name, pluginId, autoFix }] }` (strip `run`)
- [ ] New test `tests/plugins/health/checks-route.test.ts` — empty registry + populated case
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(health): expose registered checks via hooks + REST route`

## T5 — feat(core): run plugin health checks in runDiagnostics

- [ ] Import `listHealthChecks` in `src/core/doctor.ts`
- [ ] Append plugin-check Promise.all loop to `runDiagnostics()` with per-check try/catch
- [ ] Synthetic error result on throws, never crashes the sweep
- [ ] New test file `tests/core/doctor-plugin-checks.test.ts` — happy path, sync throw, async reject, alongside-builtins assertion
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `feat(core): run plugin health checks in runDiagnostics`

## T6 — refactor(workflows): migrate 3 workflow checks out of core

- [ ] New file `plugins/workflows/lib/health-checks.ts`
- [ ] Move `checkWorkflowDefinitions` (doctor.ts:1139) — internalize `listDefinitions` hook call
- [ ] Move `checkStaleWorkflowInstances` (doctor.ts:1175) — internalize `listInstances` hook; internalize `autoFix` setting read; keep `tasks.readTaskboard` as hook (cross-plugin)
- [ ] Move `checkWorkflowSkills` (doctor.ts:1102) — sync, no internalization needed
- [ ] Inline `ok` / `warn` / `fixed` helpers at top of new file
- [ ] Register all 3 via `ctx.registerHealthCheck` in `plugins/workflows/index.ts:activate()`
- [ ] Delete 3 function definitions from `src/core/doctor.ts`
- [ ] Delete 3 `results.push(...)` calls in `runDiagnostics()`
- [ ] New test `tests/plugins/workflows/health-checks.test.ts` — fixture-based regression, shape-identical to pre-migration
- [ ] Grep verification: `checkWorkflowDefinitions|checkStaleWorkflowInstances|checkWorkflowSkills` in `src/core/doctor.ts` → 0 hits
- [ ] Checkpoint: `pnpm tsc --noEmit` + `pnpm vitest run` clean
- [ ] Commit: `refactor(workflows): migrate workflow health checks out of core/doctor.ts`

## T7 — test(health): orchestrator isolation + migration regression

- [ ] Integration: activate workflows + health together, assert 3 workflow-owned checks appear in `runDiagnostics()` output
- [ ] Isolation: one plugin throws, another returns results — both contribute to the final list
- [ ] End-to-end shape regression for the health-page consumer
- [ ] Checkpoint: full `pnpm vitest run` + `pnpm tsc --noEmit` clean
- [ ] Commit: `test(health): regression guards + migration isolation`

## T8 — Ship

- [ ] `git push -u origin issue-137-health-checks-registry`
- [ ] Open PR against `main` — reference #137 + spec + 2 follow-up plans
- [ ] Quick manual smoke: `bakin doctor` output looks unchanged from pre-migration
- [ ] File 2 follow-up issues:
  - `chore(core): collapse DiagnosticResult into HealthCheckResult after all checks migrate`
  - `chore: hook-name parity pass — rename all list{Noun} hooks to {namespace}.list`
- [ ] Merge when green
- [ ] Close #137 with before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md` → `.claude/tasks/issue-137-{plan,todo}.md`
