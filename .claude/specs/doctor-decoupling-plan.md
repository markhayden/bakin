# Execution Plan — Doctor Decoupling & Type Collapse

Companion to `.claude/specs/doctor-decoupling.md`. Read the spec first for the *what* and *why*; this is the *how* — exact files, signatures, dependency graph, per-checkpoint verification, rollback story.

## Refresher

10 commits across one branch (`refactor/doctor-decoupling`) closing #139. Migrates 18 builtin doctor checks out of `src/core/doctor.ts` and into their owner plugins, then collapses the byte-identical `DiagnosticResult` interface into the canonical `HealthCheckResult` from the SDK. End state: `doctor.ts` is ~80 lines (cron + cache + audit + notify + `runPluginHealthChecks` wrapper); every check is plugin-registered.

**State of main on branch creation:**

- `src/core/doctor.ts` is **1762 lines**. 18 builtin `function check[A-Z]` helpers + `applyAllManagedBlocks` + `runDiagnostics` + `runPluginHealthChecks` + cron + result-constructor helpers + `MANAGED_BLOCKS` array (7 entries) + `ORCHESTRATOR_RULES_CONTENT` template + `resolveOrchestratorRules` + `buildWorkflowCatalog`.
- `interface DiagnosticResult` exists at `src/core/doctor.ts:71-76` and (stray) at `plugins/health/components/health-page.tsx:27-32`. Byte-identical to `HealthCheckResult` at `packages/core/src/plugin-types.ts:244-249`.
- The plugin-registration infrastructure is **fully wired**:
  - `PluginContext.registerHealthCheck` exists (`packages/core/src/plugin-types.ts:329`)
  - Implementation at `src/lib/plugin-registry.ts:349-361` — namespaces ids as `{pluginId}.{id}`, captures `state.healthCheckIds[]` for teardown
  - Teardown at `src/lib/plugin-registry.ts:528` calls `unregisterPluginHealthChecks(pluginId)` on remove
  - Orchestrator at `src/core/doctor.ts:42-60` (`runPluginHealthChecks`) iterates the registry with per-check try/catch isolation
- Workflows is the **migration precedent** (`plugins/workflows/index.ts:472-488`):
  ```ts
  ctx.registerHealthCheck({
    id: 'definitions',
    name: 'Workflow definition integrity',
    run: () => checkWorkflowDefinitions(getContentDir()),
  })
  ```
  Tests at `tests/plugins/workflows/health-checks.test.ts` (198 lines) — copy this scaffold for every new plugin test file.
- CLI at `cli/bakin.ts:581-583, 631` direct-imports `applyAllManagedBlocks`, `AGENT_RULES_BLOCK_START/END`, `resolveOrchestratorRules` from `src/core/doctor.ts`. **The CLI subcommand `bakin agent-rules --apply / --apply-all / --check / --check-all` does NOT round-trip through HTTP** — it works when the server is down.
- `cli/bakin.ts` first import at line 575: `// Orchestrator rules block constants and template are owned by src/core/doctor.ts.` — this comment is stale post-migration.
- Health plugin already imports `getLastResults`, `runDiagnostics` at `plugins/health/index.ts:8`. Stays the same after migration (signatures unchanged).
- No plugin currently has a `lib/health-checks.ts` except `workflows`. The new files in C1-C5 are the first ones in their respective plugins.
- `plugins/memory/lib/health-checks.ts` does **not** exist (verified via `ls`). C5 creates it fresh.

**Per-commit verification** runs `bun test --isolate` AND `bunx tsc --noEmit -p tsconfig.app.json` at the end of each commit. CI runs the same; both must be green.

## Critical Files

| # | Path | Role | Rough edit surface |
|---|---|---|---|
| 1 | `plugins/team/lib/health-checks.ts` | **New.** `checkAgentRoster`, `checkPersonas`, `checkAgentAssets` migrated verbatim. Inlined `ok/warn/error/fixed` helpers. Reads `getSettings().doctor.autoFixSkill` for autoFix flag (no parameter). | ~250 lines. |
| 2 | `plugins/tasks/lib/health-checks.ts` | **New.** `checkTaskboard`, `checkTaskConsistency`, `checkTaskPositionIntegrity`. Includes the local `openDoctorDb` helper (move from doctor.ts). | ~280 lines. |
| 3 | `plugins/assets/lib/health-checks.ts` | **New.** `checkAssets`. Note: today's `doctor.ts` does `require('../../plugins/assets/lib/sidecar')` — after migration this becomes a regular `import`. | ~250 lines. |
| 4 | `plugins/schedule/lib/health-checks.ts` | **New.** `checkScheduleSync`. | ~120 lines. |
| 5 | `plugins/memory/lib/health-checks.ts` | **New.** `checkSearchTables`. Today's check imports `'./antfly'` and `'./search-registry'` from core — these stay where they are; the migrated check imports them via `@bakin/core` paths. | ~90 lines. |
| 6 | `plugins/health/lib/system-checks/content-dir.ts` | **New.** `checkContentDir`. Trivial — 25 lines. | ~25 lines. |
| 7 | `plugins/health/lib/system-checks/service.ts` | **New.** `checkService`. macOS-only LaunchAgent plist check. Uses `child_process.execSync` for `launchctl list`. | ~80 lines. |
| 8 | `plugins/health/lib/system-checks/mcporter.ts` | **New.** `checkMcporter`. Reads `getSettings()` for autoFix flag and port. Imports `* as mcporter from '@bakin/core/mcporter'`. | ~55 lines. |
| 9 | `plugins/health/lib/system-checks/runtime.ts` | **New.** `checkRuntime`. Pings via `pingRuntime()`. | ~25 lines. |
| 10 | `plugins/health/lib/system-checks/antfly.ts` | **New.** `checkAntfly`. Imports `installed` from `@bakin/core/antfly-server`. | ~70 lines. |
| 11 | `plugins/health/lib/system-checks/orchestrator-rules.ts` | **New.** `checkOrchestratorRules`. Imports `AGENT_RULES_BLOCK_START/END` and `resolveOrchestratorRules` from sibling `../managed-blocks.ts`. | ~70 lines. |
| 12 | `plugins/health/lib/system-checks/sync-skill.ts` | **New.** `checkAndSyncSkill` + `buildExecToolsBlock` + `renderSyncedSkill` + `EXEC_TOOLS_START/END` constants. Imports `getAllExecTools` from `@/scripts/lib/registry`. | ~110 lines. |
| 13 | `plugins/health/lib/system-checks/plugin-assets.ts` | **New.** `checkPluginAssets`. Imports `pluginAssetsComponent` from `@bakin/core/onboarding/plugin-assets`. | ~25 lines. |
| 14 | `plugins/health/lib/managed-blocks.ts` | **New.** `MANAGED_BLOCKS` array (7 entries — verbatim move), `ManagedBlockDef` interface, `checkManagedBlock` helper, `applyAllManagedBlocks` exported, `ORCHESTRATOR_RULES_CONTENT` template, `resolveOrchestratorRules` exported, `buildWorkflowCatalog` helper, `AGENT_RULES_BLOCK_START/END` exported. **All ~340 lines moved from `src/core/doctor.ts:520-1140`.** | ~340 lines. |
| 15 | `plugins/health/index.ts` | Edit. Add `ctx.registerHealthCheck` calls for 9 system checks (one per file in `lib/system-checks/`) + `lib/managed-blocks.ts`. | +~30 lines. |
| 16 | `plugins/team/index.ts` | Edit. Three `ctx.registerHealthCheck` calls in `activate()`. | +~12 lines. |
| 17 | `plugins/tasks/index.ts` | Edit. Three `ctx.registerHealthCheck` calls. | +~12 lines. |
| 18 | `plugins/assets/index.ts` | Edit. One `ctx.registerHealthCheck` call. | +~5 lines. |
| 19 | `plugins/schedule/index.ts` | Edit. One `ctx.registerHealthCheck` call. | +~5 lines. |
| 20 | `plugins/memory/index.ts` | Edit. One `ctx.registerHealthCheck` call. | +~5 lines. |
| 21 | `plugins/health/components/health-page.tsx` | Edit. Delete local `interface DiagnosticResult` (lines 27-32). Replace usage with `import type { HealthCheckResult } from '@bakin/sdk'`. | -7 lines, +1 import. |
| 22 | `cli/bakin.ts` | Edit. Two `await import('../src/core/doctor')` calls switch to `await import('../plugins/health/lib/managed-blocks')`. Update the line-575 stale comment. | +0 -0 net (3 line changes). |
| 23 | `src/core/doctor.ts` | **Major shrink: 1762 → ~80 lines.** Keeps: `runDiagnostics` (now only calls `runPluginHealthChecks`, audit, notify), `runPluginHealthChecks`, `getLastResults`, `start`, `stop`, `notifyUnfixableIssues`, the doctor cron interval. Deletes: 18 check functions, `applyAllManagedBlocks`, `MANAGED_BLOCKS`, `ManagedBlockDef`, `checkManagedBlock`, `ORCHESTRATOR_RULES_CONTENT`, `resolveOrchestratorRules`, `buildWorkflowCatalog`, `AGENT_RULES_BLOCK_START/END` exports, `interface DiagnosticResult`, `ok/warn/error/fixed` helpers (all unused after C1-C9), `openDoctorDb` (moved to tasks plugin), `EXEC_TOOLS_START/END` (moved to sync-skill), `buildExecToolsBlock`, `renderSyncedSkill`. | -1680 lines net. |
| 24 | `packages/core/src/plugin-types.ts` | Edit one comment block at lines 238-243 — remove the "scheduled to be collapsed" prose; the type stays. | -3 lines. |
| 25 | `tests/plugins/team/health-checks.test.ts` | **New.** Absorbs `tests/core/doctor-agent-assets.test.ts` content (170 lines) + the agent-roster + personas portions of `tests/core/doctor.test.ts`. Plus registration smoke test (1 `it()`). | ~280 lines. |
| 26 | `tests/plugins/tasks/health-checks.test.ts` | **New.** Subset of `tests/core/doctor.test.ts` covering taskboard + task-consistency + task-position-integrity. Plus registration smoke test. | ~220 lines. |
| 27 | `tests/plugins/assets/health-checks.test.ts` | **New.** Subset of `tests/core/doctor.test.ts` covering assets check (lines ~228-358 of the existing test). Plus registration smoke test. | ~200 lines. |
| 28 | `tests/plugins/schedule/health-checks.test.ts` | **New.** Absorbs `tests/core/doctor-schedule.test.ts` content (265 lines). Plus registration smoke test. | ~280 lines. |
| 29 | `tests/plugins/memory/health-checks.test.ts` | **New.** Subset of `tests/core/doctor.test.ts` covering search-tables. Plus registration smoke test. | ~120 lines. |
| 30 | `tests/plugins/health/managed-blocks.test.ts` | **New.** Absorbs `tests/core/doctor-managed-blocks.test.ts` content (249 lines). Imports from `plugins/health/lib/managed-blocks`. Plus registration smoke test for the managed-blocks check. | ~270 lines. |
| 31 | `tests/plugins/health/system-checks.test.ts` | **New.** Subset of `tests/core/doctor.test.ts` covering 8 system checks (content-dir, service, mcporter, runtime, antfly, orchestrator-rules, sync-skill, plugin-assets). Plus 9 registration smoke tests. | ~350 lines. |
| 32 | `tests/core/doctor.test.ts` | **Major shrink: 370 → ~80 lines.** Keeps: orchestration (runDiagnostics calls runPluginHealthChecks + aggregates + notifies + audits), getLastResults cache test, requireOnboard gate test, notifyUnfixableIssues dedup test. Drops: every per-check assertion (those moved to plugin test files). | -290 lines. |
| 33 | `tests/core/doctor-agent-assets.test.ts` | **Delete.** Content moved into `tests/plugins/team/health-checks.test.ts` in C1. | -170 lines. |
| 34 | `tests/core/doctor-schedule.test.ts` | **Delete.** Content moved into `tests/plugins/schedule/health-checks.test.ts` in C4. | -265 lines. |
| 35 | `tests/core/doctor-managed-blocks.test.ts` | **Delete.** Content moved into `tests/plugins/health/managed-blocks.test.ts` in C9. | -249 lines. |
| 36 | `tests/core/doctor-plugin-checks.test.ts` | **Unchanged.** Tests `runPluginHealthChecks` isolation — that orchestrator behavior stays in core. 163 lines. | 0. |
| 37 | `.claude/knowledge/doctor-and-health-checks.md` | **New.** Full architecture doc per spec §6. | ~250 lines. |
| 38 | `.claude/knowledge/repo-architecture.md` | Edit. Directory map note about `plugins/health/lib/{managed-blocks,system-checks/}.ts` and `src/core/doctor.ts` shrinking. | ~10 line addition. |
| 39 | `.claude/knowledge/plugin-system.md` | Edit. Plugin context API list — add `ctx.registerHealthCheck`. | ~5 line addition. |
| 40 | `.claude/knowledge/team-plugin.md` | Edit. One line: owned health checks. | +1-2 lines. |
| 41 | `.claude/knowledge/workflows-plugin.md` | Verify still accurate (no edit unless drifted). | 0. |
| 42 | `CLAUDE.md` | Edit. One-line Key Patterns mention pointing at the new knowledge doc. | +1-2 lines. |
| 43 | `docs/src/content/docs/core/health.md` | Edit. User-facing — describe plugin-registered architecture. | ~20 line addition. |
| 44 | `docs/src/content/docs/extend/plugins/server-contracts.md` | Edit. Add `ctx.registerHealthCheck` API surface with input/output shapes. | ~30 line addition. |
| 45 | `docs/src/content/docs/extend/sdk/overview.md` | Edit. Note `HealthCheckResult` and `PluginHealthCheckInput` are exported. | ~5 line addition. |
| 46 | `docs/public/llms/plugin-authoring.md` | Edit. LLM mirror of the new section. | ~30 line addition. |

**Not touched:**

- `server.ts` — `doctor.start()` / `doctor.stop()` calls unchanged.
- `packages/core/src/agent-packages/managed-blocks.ts` — marker primitives stay; `plugins/health/lib/managed-blocks.ts` imports them.
- `packages/core/src/plugin-types.ts` — `HealthCheckResult` and `PluginHealthCheckInput` types unchanged. Only the comment block at lines 238-243 gets a one-line tidy in C10.
- `src/lib/plugin-types.ts` — re-exports `HealthCheckResult`; unchanged.
- `~/.openclaw/workspaces/{agentId}/AGENTS.md` markers — `<!-- bakin:*:start/end -->` are user state. Untouched.
- `~/.bakin/settings.json` — `doctor.intervalMs`, `autoFixSkill`, `requireOnboard` keys stay where they are.
- `plugins/workflows/lib/health-checks.ts` and `tests/plugins/workflows/health-checks.test.ts` — already migrated under #137; precedent only.
- Other plugin knowledge docs (`tasks-plugin.md` if it exists, `assets-plugin.md`, `schedule-plugin.md`) — only update if the file already exists and has a "doctor" or "health-check" mention.
- `README.md` — the file does not currently mention doctor architecture. Verified during spec phase. No edit.
- `CONTRIBUTING.md` — no doctor mention.

## Pre-flight Checklist

Verify before commit #1:

- [ ] On a fresh branch from `main`: `git checkout -b refactor/doctor-decoupling`
- [ ] `bun install` clean — no peer-dep warnings introduced by current state
- [ ] `bun test --isolate` baseline green — capture pass count to compare against later (`bun test --isolate 2>&1 | tail -5` and save)
- [ ] `bunx tsc --noEmit -p tsconfig.app.json` clean
- [ ] `wc -l src/core/doctor.ts` is 1762 (matches plan baseline; if drifted, re-validate file map)
- [ ] `grep -nE "function check[A-Z]" src/core/doctor.ts` returns **17 lines** (the 18 check functions minus `applyAllManagedBlocks` which doesn't match the regex; we re-verify this at C9 close-out)
- [ ] `grep -n "interface DiagnosticResult" src/core/doctor.ts plugins/health/components/health-page.tsx` returns 2 matches (the two copies that collapse in C10)
- [ ] Audit `plugins/workflows/lib/health-checks.ts` and `plugins/workflows/index.ts:472-488` — bookmark the docblock voice and registration shape for visual matching (this is the precedent every plugin migration mirrors)
- [ ] Audit `tests/plugins/workflows/health-checks.test.ts` — bookmark the test scaffold (env-var-set-before-imports, content-dir + openclaw-home + logger mocks, isolated test dir cleanup)
- [ ] Confirm `~/.bakin/` is writable + healthy on dev machine (test isolation will protect it but a healthy starting state simplifies debugging)
- [ ] Confirm git hooks pass on a no-op commit (`git commit --allow-empty -m "test: hook smoke"` then `git reset --soft HEAD~1`); not strictly required but catches local hook drift early

## Dependency Graph

```
                                (every commit independently lands; order is review-friendly,
                                 not strictly enforced — but C9 must come before C10, and
                                 C1-C9 must come before C10. Within C1-C8 order is flexible.)

C1 (team)                                                   ─▶ C10 (collapse)
C2 (tasks)                                                  ─▶ C10
C3 (assets)                                                 ─▶ C10
C4 (schedule)                                               ─▶ C10
C5 (memory)                                                 ─▶ C10
C6 (health: content-dir + service + mcporter)               ─▶ C10
C7 (health: runtime + antfly)                               ─▶ C10
C8 (health: orchestrator-rules + sync-skill + plugin-assets) ─▶ C9 (relocates managed-blocks deps)
C9 (health: managed-blocks + relocate infra + CLI imports)  ─▶ C10
                                                            
C10 (collapse type + delete inline helpers + docs)          ──┘
```

**Key invariants:**

- **C1-C9 each leave `runDiagnostics()` working**, just with one fewer direct call. The check that moved is now contributed via `runPluginHealthChecks()` instead. Total result count is unchanged across the migration.
- **C10 is the only commit that touches the type system** (`DiagnosticResult` → `HealthCheckResult`). Until C10, both names coexist. The migrated plugin files use `HealthCheckResult` from day one (matches workflows precedent); `doctor.ts`'s own internal references stay as `DiagnosticResult` until C10. CI passes on every commit because the types are byte-identical and assignable in either direction.
- **C8 → C9 ordering** is the only enforced edge. C8's `orchestrator-rules` check and C9's `managed-blocks` check both need `AGENT_RULES_BLOCK_START/END` and `resolveOrchestratorRules` from `plugins/health/lib/managed-blocks.ts`. C8 creates that file path the *first time* the constants are referenced from a plugin home. Two ways to land this:
  - **Option A (chosen):** C8 puts the constants in a small shim file `plugins/health/lib/managed-blocks.ts` containing only the orchestrator-rules constants + `resolveOrchestratorRules`. C9 *expands* the same file with the rest of the managed-block infra.
  - Option B: ship the file fully populated in C8, just register the orchestrator-rules check in C8 and the managed-blocks check in C9. Cleaner but bundles a 340-line file move into C8.
  - Option A is the plan default — keeps each commit's blast radius minimal. C9's diff shows the rest of the file growing in.

## Per-Commit Plan

### C1 — `refactor(team): own agent-roster + personas + agent-assets health checks`

**Scope:** Migrate 3 checks (`agent-roster`, `personas`, `agent-assets`) from `src/core/doctor.ts` into `plugins/team/lib/health-checks.ts`. Wire registration in `plugins/team/index.ts`. Move tests.

**Files touched:**

- **NEW** `plugins/team/lib/health-checks.ts` (~250 lines):
  - Re-implement inline `ok/warn/error/fixed` constructors at top (4 funcs × 3-4 lines each).
  - Move `checkAgentRoster(contentDir: string): HealthCheckResult[]` verbatim. Keeps reading `getOpenClawPath('openclaw.json')` and `getAgentIds()`.
  - Move `checkPersonas(contentDir: string): HealthCheckResult[]` — drop the `autoFix` parameter, read `getSettings().doctor.autoFixSkill` inline (matches workflows precedent).
  - Move `checkAgentAssets(): Promise<HealthCheckResult[]>` — drop the `autoFix` parameter, read `getSettings().doctor.autoFixSkill` inline. Imports `agentAssetsComponent` from `@bakin/core/onboarding/agent-assets`.
- **EDIT** `plugins/team/index.ts:470` — add three `ctx.registerHealthCheck` calls inside `activate()`:
  ```ts
  ctx.registerHealthCheck({
    id: 'agent-roster',
    name: 'Bakin agent roster sync',
    run: () => Promise.resolve(checkAgentRoster(getContentDir())),
  })
  ctx.registerHealthCheck({
    id: 'personas',
    name: 'Persona files',
    autoFix: true,
    run: () => Promise.resolve(checkPersonas(getContentDir())),
  })
  ctx.registerHealthCheck({
    id: 'agent-assets',
    name: 'Agent-package projection drift',
    autoFix: true,
    run: () => checkAgentAssets(),
  })
  ```
  Add the imports for `getContentDir` and the three check functions at the top of the file.
- **EDIT** `src/core/doctor.ts`:
  - Delete `function checkAgentRoster` (~35 lines)
  - Delete `function checkPersonas` (~50 lines)
  - Delete `async function checkAgentAssets` (~35 lines)
  - Delete the three corresponding lines from `runDiagnostics`:
    - `results.push(...checkAgentRoster(contentDir))` (line 1664)
    - `results.push(...checkPersonas(contentDir, autoFix))` (line 1665)
    - The `checkAgentAssets(autoFix)` element from the `Promise.all` at lines 1681-1687
- **NEW** `tests/plugins/team/health-checks.test.ts` (~280 lines):
  - Copy scaffold from `tests/plugins/workflows/health-checks.test.ts` (env-vars-set, mock content-dir, mock openclaw-home, mock logger).
  - Move all assertions about `r.check === 'agent-roster' | 'personas' | 'agent-assets'` from `tests/core/doctor.test.ts` and `tests/core/doctor-agent-assets.test.ts`. **Update assertions** to use namespaced ids: `r.check === 'team.agent-roster'`, etc.
  - Add registration smoke test:
    ```ts
    it('registers all three health checks on activate', async () => {
      const { activatePlugin } = await import('../../test-helpers')
      const ctx = await activatePlugin(teamPlugin)
      expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-roster' }))
      expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'personas' }))
      expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-assets' }))
    })
    ```
- **DELETE** `tests/core/doctor-agent-assets.test.ts` (170 lines moved).
- **EDIT** `tests/core/doctor.test.ts`:
  - Delete the `it('should check ... personas', ...)` test block.
  - Delete agent-roster assertions.
  - Delete the `agent-assets` describe block.

**Verification:**
- `bun test tests/plugins/team/health-checks.test.ts --isolate` — green.
- `bun test tests/core/doctor.test.ts --isolate` — green (slimmed).
- `bun test --isolate` — full suite green; pass count = baseline + N (where N = new registration smoke tests added).
- `bunx tsc --noEmit -p tsconfig.app.json` — green.
- `bun run build` succeeds. Run `./bakin doctor` (against a test home) — expect to see `team.agent-roster`, `team.personas`, `team.agent-assets` in output instead of unprefixed names.
- `wc -l src/core/doctor.ts` — should drop from 1762 to ~1640.

**Rollback:** `git revert <C1>` is sufficient — no shared-state changes, no migrations on disk. Test files are isolated additions/deletions.

### C2 — `refactor(tasks): own taskboard + task-consistency + task-position health checks`

**Scope:** Migrate 3 checks (`taskboard`, `task-consistency`, `tasks.order_integrity`) into `plugins/tasks/lib/health-checks.ts`.

**Note:** the `task-position-integrity` check today emits results with `check: 'tasks.order_integrity'` (already plugin-namespaced — see `src/core/doctor.ts:1502`). After registration via `ctx.registerHealthCheck({ id: 'order-integrity', ... })` it becomes `tasks.order-integrity`. **Mid-migration rename.** Acceptable; audit log will see new ids going forward. Document in commit message.

**Files touched:**

- **NEW** `plugins/tasks/lib/health-checks.ts` (~280 lines):
  - Inline `ok/warn/error/fixed` helpers.
  - Move `openDoctorDb` (currently at `src/core/doctor.ts:206-212`).
  - Move `checkTaskboard(): HealthCheckResult[]` — remove `_contentDir` and `_autoFix` params (both unused).
  - Move `checkTaskConsistency(contentDir: string): Promise<HealthCheckResult[]>` — drop `autoFix` param, read `getSettings().doctor.autoFixSkill` inline.
  - Move `checkTaskPositionIntegrity(): HealthCheckResult[]` — drop `autoFix` param, read settings inline. **Rename emitted check id from `tasks.order_integrity` to `order-integrity`** (the registration namespacing makes it `tasks.order-integrity`).
- **EDIT** `plugins/tasks/index.ts:57` — add three `ctx.registerHealthCheck` calls.
- **EDIT** `src/core/doctor.ts` — delete the three functions + `openDoctorDb` + their three call sites in `runDiagnostics`.
- **NEW** `tests/plugins/tasks/health-checks.test.ts` (~220 lines):
  - Move taskboard assertions from `tests/core/doctor.test.ts:164-178`.
  - Move task-consistency cases (none currently in doctor.test.ts — write fresh from the implementation behavior, covering: in-progress with unknown agent, missing heartbeat, zero log entries, agent-overload, orphaned dependsOn).
  - Move task-position-integrity cases (none currently — write fresh: missing order, duplicate orders, autoFix path).
  - Registration smoke test.
- **EDIT** `tests/core/doctor.test.ts` — delete the taskboard test block.

**Verification:**
- `bun test tests/plugins/tasks/health-checks.test.ts --isolate` green.
- `bun test --isolate` full suite green.
- `bunx tsc --noEmit -p tsconfig.app.json` green.
- `wc -l src/core/doctor.ts` ≈ 1450.
- Run `./bakin doctor` — see `tasks.taskboard`, `tasks.task-consistency`, `tasks.order-integrity` (note: dotted-id was `tasks.order_integrity`; new dotted-id is `tasks.order-integrity` — single underscore-to-hyphen swap).

**Rollback:** `git revert <C2>`.

### C3 — `refactor(assets): own asset-sidecar health check`

**Scope:** Migrate 1 check (`assets`) into `plugins/assets/lib/health-checks.ts`.

**Files touched:**

- **NEW** `plugins/assets/lib/health-checks.ts` (~250 lines):
  - Inline result helpers.
  - Move `checkAssets(contentDir: string): HealthCheckResult[]` verbatim — drop `autoFix` param, read settings inline.
  - **Replace `require('../../plugins/assets/lib/sidecar')` with a normal `import { createStub } from './sidecar'`.** This was a runtime-require in core because of layering; now that the check lives in the plugin, the import is direct. Removes the try/catch fallback that creates a minimal stub when the plugin isn't loaded — that fallback was specifically for the doctor-running-from-core case which no longer exists.
  - **Imports** `walkAssetTree` if such a helper exists; otherwise inline `walkSize` (the local function for disk-usage walking).
- **EDIT** `plugins/assets/index.ts:69` — register the check.
- **EDIT** `src/core/doctor.ts` — delete `checkAssets` and its call site.
- **NEW** `tests/plugins/assets/health-checks.test.ts` (~200 lines):
  - Move assets-related assertions from `tests/core/doctor.test.ts:228-360` (rough range — covers stub creation, mismatched sidecars, orphaned meta, disk usage, trash cleanup).
  - Registration smoke test.
- **EDIT** `tests/core/doctor.test.ts` — delete the assets describe block.

**Verification:** Same shape — green at every gate. `wc -l src/core/doctor.ts` ≈ 1220.

**Rollback:** `git revert <C3>`.

### C4 — `refactor(schedule): own schedule-sync health check`

**Scope:** Migrate 1 check (`schedule-sync`) into `plugins/schedule/lib/health-checks.ts`.

**Files touched:**

- **NEW** `plugins/schedule/lib/health-checks.ts` (~120 lines):
  - Inline result helpers.
  - Move `checkScheduleSync(): HealthCheckResult[]` — drop `autoFix` param, read settings inline.
- **EDIT** `plugins/schedule/index.ts:266` — register the check.
- **EDIT** `src/core/doctor.ts` — delete `checkScheduleSync` and its call site.
- **NEW** `tests/plugins/schedule/health-checks.test.ts` (~280 lines):
  - Absorbs all of `tests/core/doctor-schedule.test.ts` (265 lines).
  - **Update assertions** from `r.check === 'schedule-sync'` to `r.check === 'schedule.schedule-sync'`.
  - Registration smoke test.
- **DELETE** `tests/core/doctor-schedule.test.ts` (265 lines moved).

**Verification:** Same shape. `wc -l src/core/doctor.ts` ≈ 1100.

**Rollback:** `git revert <C4>`.

### C5 — `refactor(memory): own search-tables health check`

**Scope:** Migrate 1 check (`search-tables`) into `plugins/memory/lib/health-checks.ts`.

**Files touched:**

- **NEW** `plugins/memory/lib/health-checks.ts` (~90 lines):
  - Inline result helpers.
  - Move `checkSearchTables(): Promise<HealthCheckResult[]>` — keeps `import('@bakin/core/antfly')` and `import('@bakin/core/search-registry')` (or whatever the equivalent path is in the plugin context).
- **EDIT** `plugins/memory/index.ts:130` — register the check.
- **EDIT** `src/core/doctor.ts` — delete `checkSearchTables` and its call-site element from the `Promise.all`.
- **NEW** `tests/plugins/memory/health-checks.test.ts` (~120 lines):
  - Subset of `tests/core/doctor.test.ts` covering search-tables (look for `r.check === 'search-tables'` assertions; if none exist in the test file today, write fresh based on the implementation's branching: antfly disabled, antfly enabled-but-unavailable, healthy with N tables and M docs, schedule special-case).
  - Registration smoke test.
- **EDIT** `tests/core/doctor.test.ts` — delete any search-tables blocks.

**Verification:** Same shape. `wc -l src/core/doctor.ts` ≈ 1010.

**Rollback:** `git revert <C5>`.

### C6 — `refactor(health): own content-dir + service + mcporter system checks`

**Scope:** Migrate 3 system checks (`content-dir`, `service`, `mcporter`) into `plugins/health/lib/system-checks/`.

**Files touched:**

- **NEW** `plugins/health/lib/system-checks/content-dir.ts` (~25 lines): `checkContentDir`.
- **NEW** `plugins/health/lib/system-checks/service.ts` (~80 lines): `checkService(projectRoot)`. Pass `projectRoot` via the registered closure: `run: () => Promise.resolve(checkService(process.cwd()))`.
- **NEW** `plugins/health/lib/system-checks/mcporter.ts` (~55 lines): `checkMcporter` — read `port` from settings (`Number(process.env.PORT || 3737)` matches today's behavior; preserve verbatim). Drop `autoFix` param.
- **EDIT** `plugins/health/index.ts:62` — register three checks. Health plugin's `activate()` is the natural home — it already imports core utilities.
- **EDIT** `src/core/doctor.ts` — delete the three functions + their call sites.
- **NEW** `tests/plugins/health/system-checks.test.ts` (~200 lines initial size — grows in C7-C9):
  - Test scaffold (mocks for content-dir, openclaw-home, settings, child_process).
  - Cases for content-dir (using bakin-home vs not).
  - Cases for service (plist missing, plist with stale path, service not loaded).
  - Cases for mcporter (not installed, agent entries missing/correct).
  - 3 registration smoke tests (one per check).

**Verification:** Same shape. `wc -l src/core/doctor.ts` ≈ 850.

**Rollback:** `git revert <C6>`.

### C7 — `refactor(health): own runtime + antfly system checks`

**Scope:** Migrate 2 system checks (`runtime`, `antfly`) into `plugins/health/lib/system-checks/`.

**Files touched:**

- **NEW** `plugins/health/lib/system-checks/runtime.ts` (~25 lines): `checkRuntime` — pings `pingRuntime()`.
- **NEW** `plugins/health/lib/system-checks/antfly.ts` (~70 lines): `checkAntfly` — reads `getSettings()`, dynamic-imports `'@bakin/core/antfly-server'` for `installed()`. The dynamic import was preserved in today's check; keep it (avoids loading antfly-server on cold path when the check doesn't run).
- **EDIT** `plugins/health/index.ts` — register two more checks.
- **EDIT** `src/core/doctor.ts` — delete two functions + their `Promise.all` elements.
- **EDIT** `tests/plugins/health/system-checks.test.ts` — add runtime + antfly cases + 2 more registration smoke tests.

**Verification:** Same shape. `wc -l src/core/doctor.ts` ≈ 750.

**Rollback:** `git revert <C7>`.

### C8 — `refactor(health): own orchestrator-rules + sync-skill + plugin-assets system checks`

**Scope:** Migrate 3 system checks. **Creates `plugins/health/lib/managed-blocks.ts`** (small shim version) so `orchestrator-rules` has a home for the `AGENT_RULES_BLOCK_*` constants and `resolveOrchestratorRules`. C9 expands this file.

**Files touched:**

- **NEW** `plugins/health/lib/managed-blocks.ts` (small shim, ~80 lines):
  - `export const AGENT_RULES_BLOCK_START = '<!-- bakin:orchestrator-rules:start -->'`
  - `export const AGENT_RULES_BLOCK_END = '<!-- bakin:orchestrator-rules:end -->'`
  - Move `ORCHESTRATOR_RULES_CONTENT` template (verbatim).
  - Move `buildWorkflowCatalog` helper.
  - Move `resolveOrchestratorRules` exported.
- **NEW** `plugins/health/lib/system-checks/orchestrator-rules.ts` (~70 lines):
  - `checkOrchestratorRules(): Promise<HealthCheckResult[]>` — drop `autoFix` param, read settings inline.
  - Imports `AGENT_RULES_BLOCK_START/END`, `resolveOrchestratorRules` from `../managed-blocks`.
- **NEW** `plugins/health/lib/system-checks/sync-skill.ts` (~110 lines):
  - `EXEC_TOOLS_START/END` constants (move from doctor.ts:229-230).
  - `buildExecToolsBlock`, `renderSyncedSkill` helpers (moved verbatim).
  - `checkAndSyncSkill(projectRoot)`: drop `autoFix` param. `projectRoot` passed via closure.
- **NEW** `plugins/health/lib/system-checks/plugin-assets.ts` (~25 lines):
  - `checkPluginAssets()` — wraps `pluginAssetsComponent.check()`.
- **EDIT** `plugins/health/index.ts` — register three more checks.
- **EDIT** `src/core/doctor.ts` — delete three functions + dependencies (the `EXEC_TOOLS_*`, `buildExecToolsBlock`, `renderSyncedSkill`, `ORCHESTRATOR_RULES_CONTENT`, `buildWorkflowCatalog`, `resolveOrchestratorRules`, `AGENT_RULES_BLOCK_*` exports — NOTE: these aren't fully removed yet because `applyAllManagedBlocks` (still in doctor.ts) and the CLI both still reference `AGENT_RULES_BLOCK_*` and `resolveOrchestratorRules`. **C8 keeps re-exports** in `doctor.ts` to bridge:
  ```ts
  // C8 transitional — until C9 moves applyAllManagedBlocks
  export { AGENT_RULES_BLOCK_START, AGENT_RULES_BLOCK_END, resolveOrchestratorRules } from '../../plugins/health/lib/managed-blocks'
  ```
  This is the **only** transitional re-export in the plan and it lives for one commit. C9 deletes it. *Why this is OK despite the no-shims rule:* it isn't a backward-compat shim for external consumers — it's a one-commit internal bridge; its sole consumer (the CLI) gets repointed in C9. Without it, C8 wouldn't compile. The alternative is folding C8 + C9 into one massive commit, which defeats the rollback-checkpoint goal.
- **EDIT** `tests/plugins/health/system-checks.test.ts` — add orchestrator-rules + sync-skill + plugin-assets cases + 3 registration smoke tests.

**Verification:** Same shape. `wc -l src/core/doctor.ts` ≈ 530 (with `applyAllManagedBlocks` still in place).

**Rollback:** `git revert <C8>`. Slightly more annoying than other reverts because the shim file `managed-blocks.ts` would need to be re-created at C9 size. Acceptable.

### C9 — `refactor(health): own managed-blocks system check + relocate infra`

**Scope:** Move `applyAllManagedBlocks`, `MANAGED_BLOCKS` array, `ManagedBlockDef`, `checkManagedBlock` from `src/core/doctor.ts` into `plugins/health/lib/managed-blocks.ts`. Register the managed-blocks check. Repoint CLI imports. Delete the C8 transitional re-exports.

**Files touched:**

- **EDIT** `plugins/health/lib/managed-blocks.ts` (grows from ~80 to ~340 lines):
  - Add `interface ManagedBlockDef`.
  - Add `function checkManagedBlock(def: ManagedBlockDef, autoFix: boolean): HealthCheckResult[]` — verbatim move.
  - Add `const MANAGED_BLOCKS: ManagedBlockDef[]` — all 7 entries verbatim (mission-control, hard-rules, dependency-pattern, media-delegation, workflow-rules, scheduling-rules, asset-rules). The string content of every entry — bit-identical, including the `bakin:{blockId}:start/end` markers.
  - Add `export function applyAllManagedBlocks(autoFix: boolean): HealthCheckResult[]`.
  - Inline result helpers if not already there.
- **NEW** registered system check inside `plugins/health/index.ts`:
  ```ts
  ctx.registerHealthCheck({
    id: 'managed-blocks',
    name: 'Per-agent managed blocks in AGENTS.md',
    autoFix: true,
    run: () => Promise.resolve(applyAllManagedBlocks(getSettings().doctor.autoFixSkill)),
  })
  ```
  This single registered check produces N rows (one per agent × per block), same as today.
- **EDIT** `src/core/doctor.ts`:
  - Delete `applyAllManagedBlocks`, `MANAGED_BLOCKS`, `ManagedBlockDef`, `checkManagedBlock`.
  - Delete the C8 transitional re-export block.
  - Delete `ok/warn/error/fixed` helpers (now unused — the only caller was `notifyUnfixableIssues` which doesn't construct results).
  - **`runDiagnostics` is now the post-migration shape** — calls only `runPluginHealthChecks`, audits, notifies, caches.
  - The `applyAllManagedBlocks` line in `runDiagnostics` (currently `results.push(...applyAllManagedBlocks(autoFix))`) deletes — managed-blocks is contributed via `runPluginHealthChecks()` instead.
- **EDIT** `cli/bakin.ts`:
  - Line 581-583: `await import('../src/core/doctor')` → `await import('../plugins/health/lib/managed-blocks')`.
  - Line 631: same.
  - Line 575 stale comment: rewrite to "Orchestrator rules block constants and template are owned by plugins/health/lib/managed-blocks.ts."
- **NEW** `tests/plugins/health/managed-blocks.test.ts` (~270 lines):
  - Absorbs all of `tests/core/doctor-managed-blocks.test.ts` (249 lines).
  - Imports `applyAllManagedBlocks` from `'../../../plugins/health/lib/managed-blocks'`.
  - Update `r.check === 'agent-{blockId}'` assertions to `r.check === 'health.managed-blocks'` — the registered check emits all rows under one namespaced id (today they're per-block, e.g. `agent-mission-control`).
  - **Watchout:** the existing test file probably filters by per-block ids. The migrated check returns the same rows but they now share one `health.managed-blocks` id. The test assertions need updating. **Decision (resolves Open Micro-Decision in spec §11):** stick with one registered id producing all rows. The per-block disambiguation moves into the row's `message` field (already includes the block id). This matches how workflows ships — one registered check ID, multiple result rows.
  - Registration smoke test.
- **DELETE** `tests/core/doctor-managed-blocks.test.ts` (249 lines moved).

**Verification:**
- `bun test tests/plugins/health/managed-blocks.test.ts --isolate` green.
- `bun test --isolate` full suite green.
- `bunx tsc --noEmit -p tsconfig.app.json` green.
- `bun run build` succeeds.
- `bakin agent-rules --check` (against test home) — same output shape as before.
- `bakin agent-rules --apply-all` (against test home) — writes managed blocks correctly. Diff `~/.openclaw/workspaces/{agent}/AGENTS.md` before/after migration on a snapshot — must be byte-identical.
- `wc -l src/core/doctor.ts` should be ~150 (still has `runDiagnostics`, `runPluginHealthChecks`, `getLastResults`, `start`, `stop`, `notifyUnfixableIssues` — the type collapse in C10 brings it to ~80).
- `grep -nE "function check[A-Z]" src/core/doctor.ts` returns **zero matches**. **Issue #139's literal trigger condition is now met.**

**Rollback:** `git revert <C9>`. The 340-line file relocation reverts cleanly because git tracks the move via diff. CLI imports revert to their old paths.

### C10 — `refactor(core): collapse DiagnosticResult into HealthCheckResult (#139)`

**Scope:** Type rename. Delete the duplicate interface and stray copy. Update internal references. Land docs.

**Files touched:**

- **EDIT** `src/core/doctor.ts`:
  - Delete `interface DiagnosticResult` (lines 71-76).
  - Replace every internal `DiagnosticResult` reference with `HealthCheckResult`. Add `import { HealthCheckResult } from '@bakin/core/plugin-types'` (or via `src/lib/plugin-types`).
  - Remove the `// ----- Individual checks -----` comment block at line 94 (no checks left).
  - Final line count target: ~80 lines.
  - Final shape:
    ```ts
    /**
     * Bakin Doctor — orchestration only.
     * Cron + cache + audit + notify. Every check is plugin-registered via
     * ctx.registerHealthCheck and contributed through runPluginHealthChecks.
     * See .claude/knowledge/doctor-and-health-checks.md.
     */
    import { ... } from '...'
    
    let doctorTimer: NodeJS.Timeout | null = null
    let lastDiagnosticResults: HealthCheckResult[] | null = null
    let lastDiagnosticTime = 0
    const notifiedIssues = new Set<string>()
    const log = createLogger('doctor')
    
    export async function runPluginHealthChecks(): Promise<HealthCheckResult[]> { /* unchanged */ }
    
    export async function runDiagnostics(contentDir: string, _projectRoot: string): Promise<HealthCheckResult[]> {
      const settings = getSettings()
      if (settings.doctor.requireOnboard && !isOnboarded()) { /* gate result */ }
      const results = await runPluginHealthChecks()
      // summary, audit, notify, cache, return
    }
    
    export function getLastResults() { /* unchanged */ }
    async function notifyUnfixableIssues(results) { /* unchanged */ }
    export function start(contentDir: string, projectRoot: string) { /* unchanged */ }
    export function stop() { /* unchanged */ }
    ```
- **EDIT** `plugins/health/components/health-page.tsx`:
  - Delete `interface DiagnosticResult` (lines 27-32).
  - Replace usage with `import type { HealthCheckResult } from '@bakin/sdk'`.
  - Find `results: DiagnosticResult[]` → `results: HealthCheckResult[]`.
- **EDIT** `packages/core/src/plugin-types.ts:238-243`:
  - Remove the "Shape-identical to ... they will be collapsed into this one name once all builtin checks migrate out of core" prose.
  - Replace with a brief: "Canonical result shape for a single doctor check row."
- **EDIT** `tests/core/doctor.test.ts`:
  - Replace any remaining `DiagnosticResult` references with `HealthCheckResult`.
  - Slim further if anything per-check-specific remains.
- **EDIT** `tests/core/doctor-plugin-checks.test.ts`:
  - Replace `DiagnosticResult` references with `HealthCheckResult`.
- Other test/source files: `grep -rln "DiagnosticResult" .` returns zero matches after this commit. Replace any stragglers.
- **NEW** `.claude/knowledge/doctor-and-health-checks.md` (~250 lines):
  - Architecture overview: cron in core, checks in plugins.
  - Where each of the 18 checks lives (table).
  - Authoring guide: how to add a new check.
  - Managed-blocks subsection: location + 7 block ids + marker syntax.
  - Type contracts: `HealthCheckResult`, `PluginHealthCheckInput`.
  - Audit & notify lifecycle.
- **EDIT** `.claude/knowledge/repo-architecture.md` — directory map note.
- **EDIT** `.claude/knowledge/plugin-system.md` — `ctx.registerHealthCheck` mention.
- **EDIT** `.claude/knowledge/team-plugin.md` — owned-checks one-liner.
- **EDIT** `CLAUDE.md` — Key Patterns line.
- **EDIT** `docs/src/content/docs/core/health.md` — registry architecture.
- **EDIT** `docs/src/content/docs/extend/plugins/server-contracts.md` — `ctx.registerHealthCheck` API.
- **EDIT** `docs/src/content/docs/extend/sdk/overview.md` — type exports note.
- **EDIT** `docs/public/llms/plugin-authoring.md` — LLM mirror.

**Verification:**
- `grep -rn "DiagnosticResult" /Users/dev/go/src/github.com/markhayden/bakin --include="*.ts" --include="*.tsx"` returns zero matches.
- `grep -nE "function check[A-Z]" src/core/doctor.ts` returns zero matches.
- `wc -l src/core/doctor.ts` ≤ 100.
- `bun test --isolate` green.
- `bunx tsc --noEmit -p tsconfig.app.json` green.
- `bun run build` succeeds.
- `./bakin doctor` produces same shape and approximate result count as before (modulo namespaced ids).
- `bakin agent-rules --apply-all --check-all` — both work.
- Health page in browser renders correctly.

**Rollback:** `git revert <C10>` works cleanly — the type rename is a pure renaming operation.

## Verification Across All Commits

Run after every commit:

```bash
bun test --isolate                                # behavioral coverage
bunx tsc --noEmit -p tsconfig.app.json            # type safety
bun run build                                     # binary builds
wc -l src/core/doctor.ts                          # progress indicator
grep -cE "function check[A-Z]" src/core/doctor.ts # checks remaining
```

**Final state acceptance after C10:**
- `wc -l src/core/doctor.ts` ≤ 100
- `grep -cE "function check[A-Z]" src/core/doctor.ts` returns 0
- `grep -rn "interface DiagnosticResult" .` returns 0
- `grep -rn "DiagnosticResult" --include="*.ts" --include="*.tsx" .` returns 0
- `bun test --isolate` passes; pass count = baseline + new registration smoke tests
- `bunx tsc --noEmit -p tsconfig.app.json` passes
- `bun run build` succeeds; `./bakin doctor` runs

## Definition of Done

- [ ] All 10 commits land green on `refactor/doctor-decoupling`.
- [ ] Branch passes CI on PR.
- [ ] PR description summarizes the migration and links #139 (closes) and #172 (sibling, stays open).
- [ ] Docs updates verified by spot-rendering the Astro site (`cd docs && bun run dev`) and confirming the health and plugin-authoring pages are accurate.
- [ ] `.claude/knowledge/doctor-and-health-checks.md` exists and is accurate against the post-migration code.
- [ ] On a test-home instance, `./bakin doctor` produces the same total result count as before (modulo namespaced ids); spot-check `team.agent-roster`, `tasks.taskboard`, `health.runtime`, `health.managed-blocks` are present.
- [ ] Markers in `~/.openclaw/workspaces/{agentId}/AGENTS.md` are byte-identical pre- and post-migration on a snapshot test.
- [ ] Issue #139 closes when the PR merges.

## Rollback Story

**Per-commit rollback** is the primary safety net. Each commit is independent enough that `git revert <Cn>` works for any n in [C1, C5, C6, C7, C10]. C8 + C9 are slightly coupled (C8 introduces a transitional re-export block; C9 removes it); reverting C9 alone is fine, reverting C8 in isolation requires either also reverting C9 or hand-editing back the transitional re-exports.

**Branch rollback** — if the migration goes sideways mid-flight, `git checkout main && git branch -D refactor/doctor-decoupling` discards everything. No durable on-disk artifacts have been created — the migration is pure source code.

**No data migration:** `~/.bakin/`, `~/.openclaw/`, `~/.bakin/audit.jsonl`, and managed-block markers in user files are unchanged by this work. Rollback affects code only.

**Audit-log impact:** between C1 and C10, audit.jsonl entries from `doctor.run` will reference some checks by old id (`taskboard`) and some by new id (`tasks.taskboard`). Rolling back any commit reverts the relevant ids. Single-user installation; acceptable churn in audit log; not a blocking concern.

## Open Micro-Decisions (settle during build)

These were deferred from the spec; resolved or noted below:

- **`tests/plugins/health/system-checks.test.ts` granularity.** Plan default: one file, grows from C6 (~200 lines) → C7 (~280) → C8 (~350). If past ~400 lines, split per system-check into `tests/plugins/health/system-checks/{content-dir,service,...}.test.ts`. Decision deferred to final review of C8.
- **Inline `ok/warn/error/fixed` per file vs shared util.** Plan: stay inline (matches workflows precedent at `plugins/workflows/lib/health-checks.ts:24-32`). 12 lines of duplication × 7 files is cheaper than a shared module across plugin boundaries.
- **Memory plugin's existing `lib/health-checks.ts`?** Verified during plan: file does **not** exist on main (`ls plugins/memory/lib/health-checks.ts` → "No such file or directory"). C5 creates fresh.
- **Managed-blocks: one registered check or seven?** Plan default: **one** (`health.managed-blocks`) emitting N rows. The per-block disambiguation lives in the row's `message` field. Matches workflows pattern (one registered id, multiple rows). Today's implementation already returns N rows (one per agent × block); only the registry id is unified.
- **`tasks.order_integrity` → `tasks.order-integrity` rename.** Underscore-to-hyphen normalization. Documented in C2 commit message. Audit-log churn is acceptable.
- **Comment cleanup at `packages/core/src/plugin-types.ts:238-243`.** The "scheduled to be collapsed" prose becomes one line: "Canonical result shape for a single doctor check row." Saves 3 lines.

## Notes for the Build Phase

- **Run `bun test --isolate` after every file edit.** Don't batch — catches regressions while context is fresh.
- **Use `git diff --stat HEAD` between edits to track scope.** Each commit's stat should match the plan's "rough edit surface" within ~30%.
- **Type-check is non-negotiable.** `bunx tsc --noEmit -p tsconfig.app.json` after each commit. Bun's runtime test runner doesn't catch TS-only errors that CI does.
- **Don't reformat unrelated code.** Mechanical renames + deletions only. Resist the urge to touch comments/imports/whitespace orthogonal to the migration.
- **CLI verification beyond unit tests.** `./bakin agent-rules --check-all` and `./bakin agent-rules --apply-all --apply` run after C9 against a test `OPENCLAW_HOME`. Compare output against pre-migration snapshot.
- **Test isolation is mandatory.** Per `feedback_test_isolation.md` memory + CLAUDE.md: every new test file mocks both `content-dir` shims, provider home paths where applicable, the active runtime boundary, and `logger`. Set `BAKIN_HOME` and provider home env vars BEFORE imports. Verbatim copy the current scaffold from nearby health tests rather than older provider-client mocks.
- **No stylistic drift from workflows precedent.** If something feels different from how workflows did it, default back to the workflows shape — even if the new way feels marginally cleaner. Consistency wins; "marginally cleaner" loses to maintenance friction across 9 plugins.
- **Commit messages.** Conventional commits with scope (per CLAUDE.md):
  - `refactor(team): own agent-roster + personas + agent-assets health checks`
  - `refactor(core): collapse DiagnosticResult into HealthCheckResult (#139)`
  - Body should reference `.claude/specs/doctor-decoupling.md` for context.
- **Docs commit (C10) lands together with the type collapse.** Don't fragment doc updates across earlier commits — the docs describe the end state.
- **Squash discipline.** Each commit ships as-is into the merging PR. **Do not squash** — the per-commit rollback story is the value proposition.
- **PR template.** Open as draft. Self-review the diff. Fix anything flagged. Mark ready when CI is green and `./bakin doctor` works against a test home.
- **After merge.** `git checkout main && git pull && git branch -D refactor/doctor-decoupling`. Verify #139 closed automatically. Confirm #172 still open (separate followup).
