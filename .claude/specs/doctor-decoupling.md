# SPEC — Doctor Decoupling & Type Collapse

**Status:** Draft for review (kickoff phase, pre-plan)
**Owner:** @markhayden
**Closes:** [#139](https://github.com/madeinwyo/bakin/issues/139) (collapse `DiagnosticResult` into `HealthCheckResult`)
**Sibling follow-up filed:** [#172](https://github.com/madeinwyo/bakin/issues/172) (unify `bakin agent-rules` with `applyAllManagedBlocks`)
**Companion plan:** `.claude/specs/doctor-decoupling-plan.md` (next phase)

---

## 1. Objective

Complete the architectural shift started in #137: every doctor check belongs to the plugin (or system layer) that owns the data it touches. After this PR, `src/core/doctor.ts` contains zero `function check[A-Z]` helpers. The duplicate `DiagnosticResult` interface — byte-identical to `HealthCheckResult` since #137 — collapses into a single canonical type.

Today:

- **18 builtin checks live in `src/core/doctor.ts`** — 1762 lines of mixed concerns: cron scheduling, audit, notify, the orchestrator, *and* every check's implementation.
- **`DiagnosticResult` and `HealthCheckResult` are byte-identical** but coexist because the interface in `doctor.ts` predates the SDK type and renaming felt premature when only 3 of 18 checks had migrated.
- **A third `interface DiagnosticResult` exists** at `plugins/health/components/health-page.tsx:27` — a stray copy that's neither imported from nor exporting to anything else.
- **The CLI reaches into `src/core/doctor.ts`** (`cli/bakin.ts:581-583, 631`) for `applyAllManagedBlocks`, `AGENT_RULES_BLOCK_START/END`, `resolveOrchestratorRules` — coupling the CLI to a file that should be a thin service.

After this PR:

- **`src/core/doctor.ts` is ~80 lines.** Cron timer, lastResults cache, audit, notify, and a `runDiagnostics` that only invokes `runPluginHealthChecks()`.
- **Every check lives in its owner plugin.** 9 checks distributed to team/tasks/assets/schedule/memory; 9 system-level checks centralized in the health plugin.
- **One canonical type.** `HealthCheckResult` is the only name. `DiagnosticResult` is gone from `doctor.ts` and from `health-page.tsx`.
- **Managed-block infrastructure relocates** to `plugins/health/lib/managed-blocks.ts`. CLI imports from there.
- **`grep "function check[A-Z]" src/core/doctor.ts` returns zero matches** — issue #139's literal trigger condition is met.

**Single user, this machine.** No backwards-compatibility shims (no `DiagnosticResult` type alias, no re-exports through `doctor.ts`). Reduce tech debt is the priority.

---

## 2. Out of Scope (Cut from this PR — follow-up issues filed/exist)

| Cut | Reason | Follow-up |
|-----|--------|-----------|
| Unifying CLI `bakin agent-rules` with `applyAllManagedBlocks` | The CLI duplicates writing-blocks-to-AGENTS.md logic at a smaller scope than the doctor's helper. Pure cleanup, separable. | [#172](https://github.com/madeinwyo/bakin/issues/172) (filed during kickoff) |
| Splitting managed-block ownership across plugins (workflow-rules → workflows, scheduling-rules → schedule, asset-rules → assets) | Would require a new "managed-block contributor" registry hook. Out of scope; the 7 blocks travel together to `plugins/health/lib/managed-blocks.ts`. | New issue: "feat(plugins): managed-block contributor registry" |
| Moving `~/.bakin/settings.json` doctor-* keys to per-plugin settings | Doctor settings live in core today (`settings.doctor.intervalMs`, `autoFixSkill`, `requireOnboard`). Each migrated check reads them via `getSettings()` — same as the workflows precedent. Behavioral move; not a layout move. | None planned |
| Moving the cron itself into the health plugin (delete `src/core/doctor.ts` entirely) | Considered. Rejected: core already owns long-running services (dispatch loop, file watcher); doctor cron fits that pattern. Inconsistent to put one in a plugin. | None planned |

---

## 3. Contracts

### 3.1 The canonical type — `HealthCheckResult`

Already exists at `packages/core/src/plugin-types.ts:244`. Re-exported through `src/lib/plugin-types.ts:45` and `@bakin/sdk` for plugin authors. Unchanged shape:

```ts
export interface HealthCheckResult {
  check: string                                // namespaced id, e.g. "team.agent-roster"
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}
```

`DiagnosticResult` (currently at `src/core/doctor.ts:71-76`) is deleted in commit #10. The stray copy at `plugins/health/components/health-page.tsx:27-32` is also deleted; the page imports `HealthCheckResult` from the SDK instead.

### 3.2 The canonical input shape — `PluginHealthCheckInput`

Already exists at `packages/core/src/plugin-types.ts:257-273`. Plugins register checks via `ctx.registerHealthCheck(input)` in `activate()`. The plugin id auto-namespaces: a plugin with id `team` registering an input id of `agent-roster` produces a check named `team.agent-roster`. Unchanged.

### 3.3 The orchestrator — `src/core/doctor.ts` post-migration

Post-migration surface:

```ts
// Public exports — server.ts, plugins/health/index.ts, cli/bakin.ts, tests
export async function runDiagnostics(contentDir: string, projectRoot: string): Promise<HealthCheckResult[]>
export async function runPluginHealthChecks(): Promise<HealthCheckResult[]>
export function getLastResults(): { results: HealthCheckResult[]; timestamp: number } | null
export function start(contentDir: string, projectRoot: string): void
export function stop(): void

// Removed exports — these all migrate out
// ─── DiagnosticResult                  → deleted (collapsed into HealthCheckResult)
// ─── applyAllManagedBlocks             → plugins/health/lib/managed-blocks.ts
// ─── AGENT_RULES_BLOCK_START/END       → plugins/health/lib/managed-blocks.ts
// ─── resolveOrchestratorRules          → plugins/health/lib/managed-blocks.ts
```

`runDiagnostics` post-migration:

```ts
export async function runDiagnostics(contentDir: string, projectRoot: string): Promise<HealthCheckResult[]> {
  const settings = getSettings()
  if (settings.doctor.requireOnboard && !isOnboarded()) {
    return [{ check: 'onboarded', status: 'error',
      message: 'Bakin is not onboarded on this machine. Run `bakin onboard` to complete first-run setup.',
      autoFixable: false }]
  }

  const results = await runPluginHealthChecks()

  // ─── Summary + audit + notify (unchanged from today) ─────────
  const errors = results.filter(r => r.status === 'error').length
  const warnings = results.filter(r => r.status === 'warn').length
  const fixes = results.filter(r => r.status === 'fixed').length
  if (errors > 0 || warnings > 0) log.warn('Doctor found issues', { errors, warnings, fixes })
  else log.info('Doctor: all checks passed', { fixes })
  appendAudit(contentDir, 'doctor.run', 'system', { total: results.length, errors, warnings, fixes })
  await notifyUnfixableIssues(results)

  lastDiagnosticResults = results
  lastDiagnosticTime = Date.now()
  return results
}
```

The `_projectRoot` parameter stays in the signature (unused at this layer post-migration) so server.ts and the health plugin's call sites don't change. Plugins that need it read `process.cwd()` themselves.

### 3.4 Per-plugin lib layout

Each receiving plugin gets one health-checks file matching the workflows precedent (`plugins/workflows/lib/health-checks.ts`):

| Plugin | New file | Migrated checks |
|---|---|---|
| `team` | `plugins/team/lib/health-checks.ts` | `agent-roster`, `personas`, `agent-assets` |
| `tasks` | `plugins/tasks/lib/health-checks.ts` | `taskboard`, `task-consistency`, `task-position-integrity` |
| `assets` | `plugins/assets/lib/health-checks.ts` | `assets` |
| `schedule` | `plugins/schedule/lib/health-checks.ts` | `schedule-sync` |
| `memory` | `plugins/memory/lib/health-checks.ts` | `search-tables` |

Health plugin layout (the system-check home):

| New file | Migrated checks |
|---|---|
| `plugins/health/lib/system-checks/content-dir.ts` | `content-dir` |
| `plugins/health/lib/system-checks/service.ts` | `service` |
| `plugins/health/lib/system-checks/mcporter.ts` | `mcporter` |
| `plugins/health/lib/system-checks/gateway.ts` | `gateway` |
| `plugins/health/lib/system-checks/antfly.ts` | `antfly` |
| `plugins/health/lib/system-checks/orchestrator-rules.ts` | `orchestrator-rules` |
| `plugins/health/lib/system-checks/sync-skill.ts` | `skill` (Bakin SKILL.md sync) |
| `plugins/health/lib/system-checks/plugin-assets.ts` | `plugin-assets` |
| `plugins/health/lib/managed-blocks.ts` | `MANAGED_BLOCKS` array, `applyAllManagedBlocks`, `checkManagedBlock`, `ORCHESTRATOR_RULES_CONTENT`, `resolveOrchestratorRules`, `AGENT_RULES_BLOCK_START/END`, `buildWorkflowCatalog` — **all of it**, plus the registered-check wrapper |

The 7 inline `MANAGED_BLOCKS` entries (mission-control, hard-rules, dependency-pattern, media-delegation, workflow-rules, scheduling-rules, asset-rules) move verbatim. The marker text `<!-- bakin:{blockId}:start/end -->` is **user state in `~/.openclaw/workspaces/{agentId}/AGENTS.md`** — must not change.

### 3.5 Result-constructor helpers

Today `doctor.ts:78-92` exports four module-private helpers (`ok`, `warn`, `error`, `fixed`). Each migrated file inlines its own copies (3-4 lines each) — same pattern as `plugins/workflows/lib/health-checks.ts:24-32`. Cheaper than a shared utility import for 12 lines of trivial constructors. The originals in `doctor.ts` are removed in commit #10 (nothing in core uses them after the last check leaves).

### 3.6 CLI — `cli/bakin.ts` `agent-rules` subcommand

Today the CLI imports from `src/core/doctor.ts`:

```ts
const { AGENT_RULES_BLOCK_START, AGENT_RULES_BLOCK_END, resolveOrchestratorRules } = await import('../src/core/doctor')
const { applyAllManagedBlocks } = await import('../src/core/doctor')
```

Post-migration:

```ts
const { AGENT_RULES_BLOCK_START, AGENT_RULES_BLOCK_END, resolveOrchestratorRules } = await import('../plugins/health/lib/managed-blocks')
const { applyAllManagedBlocks } = await import('../plugins/health/lib/managed-blocks')
```

Both are bundled into the same single-file binary (`bun build --compile`); the import path change is purely a refactor. Issue [#172](https://github.com/madeinwyo/bakin/issues/172) tracks unifying the CLI's two code paths into one (`applyAllManagedBlocks` everywhere) — out of scope here.

---

## 4. Command Surfaces

No new commands. No new CLI flags. Plugin-author surface gets one new mention in docs (`ctx.registerHealthCheck`) but the API itself already exists post-#137.

`bakin doctor` (and the `bakin_exec_health_doctor` MCP tool) behaves identically. Cached results, fresh runs, summary all unchanged. The only observable difference from a user's perspective is that check ids gain plugin namespacing — `agent-roster` becomes `team.agent-roster`, `taskboard` becomes `tasks.taskboard`, etc. This matches the workflows precedent (`workflows.workflow-skills`, `workflows.workflow-definitions`, `workflows.workflow-instances`).

**Audit-log impact:** the per-check rows that go to `audit.jsonl` and the dashboard now use namespaced ids. Existing audit data isn't rewritten. Acceptable for this single-user installation.

---

## 5. Project Structure

```
src/core/doctor.ts                                   ~80 lines (was 1762)
                                                     — orchestrator only: cron + cache + audit + notify

plugins/team/lib/health-checks.ts                    NEW  ~250 lines
plugins/tasks/lib/health-checks.ts                   NEW  ~280 lines
plugins/assets/lib/health-checks.ts                  NEW  ~250 lines
plugins/schedule/lib/health-checks.ts                NEW  ~120 lines
plugins/memory/lib/health-checks.ts                  NEW  ~90 lines

plugins/health/lib/managed-blocks.ts                 NEW  ~340 lines
                                                     — MANAGED_BLOCKS, apply, resolveOrchestratorRules
plugins/health/lib/system-checks/content-dir.ts      NEW  ~25 lines
plugins/health/lib/system-checks/service.ts          NEW  ~80 lines
plugins/health/lib/system-checks/mcporter.ts         NEW  ~55 lines
plugins/health/lib/system-checks/gateway.ts          NEW  ~25 lines
plugins/health/lib/system-checks/antfly.ts           NEW  ~70 lines
plugins/health/lib/system-checks/orchestrator-rules.ts NEW ~70 lines
plugins/health/lib/system-checks/sync-skill.ts       NEW  ~110 lines
plugins/health/lib/system-checks/plugin-assets.ts    NEW  ~25 lines

plugins/health/index.ts                              EDIT (~+30 lines)
                                                     — registers 9 system checks via ctx.registerHealthCheck
plugins/team/index.ts                                EDIT (~+10 lines) — registers 3 checks
plugins/tasks/index.ts                               EDIT (~+10 lines) — registers 3 checks
plugins/assets/index.ts                              EDIT (~+5 lines) — registers 1 check
plugins/schedule/index.ts                            EDIT (~+5 lines) — registers 1 check
plugins/memory/index.ts                              EDIT (~+5 lines) — registers 1 check

plugins/health/components/health-page.tsx            EDIT (~-7 lines) — delete local DiagnosticResult interface,
                                                     import HealthCheckResult from SDK

cli/bakin.ts                                         EDIT (~+0 -0 lines, 2 import path swaps)
                                                     — agent-rules imports point at plugins/health/lib/managed-blocks

tests/plugins/team/health-checks.test.ts             NEW  (absorbs tests/core/doctor-agent-assets.test.ts content)
tests/plugins/tasks/health-checks.test.ts            NEW  (subset of tests/core/doctor.test.ts)
tests/plugins/assets/health-checks.test.ts           NEW  (subset of tests/core/doctor.test.ts)
tests/plugins/schedule/health-checks.test.ts         NEW  (absorbs tests/core/doctor-schedule.test.ts content)
tests/plugins/memory/health-checks.test.ts           NEW  (subset of tests/core/doctor.test.ts)
tests/plugins/health/managed-blocks.test.ts          NEW  (absorbs tests/core/doctor-managed-blocks.test.ts content)
tests/plugins/health/system-checks.test.ts           NEW  (subset of tests/core/doctor.test.ts — system bucket)

tests/core/doctor.test.ts                            EDIT  ~80 lines (was 370)
                                                     — orchestration, lastResults cache, notifyUnfixableIssues, audit
tests/core/doctor-plugin-checks.test.ts              UNCHANGED — already tests runPluginHealthChecks isolation
tests/core/doctor-agent-assets.test.ts               DELETED (content moved into tests/plugins/team/)
tests/core/doctor-managed-blocks.test.ts             DELETED (content moved into tests/plugins/health/)
tests/core/doctor-schedule.test.ts                   DELETED (content moved into tests/plugins/schedule/)

.claude/knowledge/doctor-and-health-checks.md        NEW
.claude/knowledge/repo-architecture.md               EDIT (directory map)
.claude/knowledge/plugin-system.md                   EDIT (ctx.registerHealthCheck mention)
.claude/knowledge/team-plugin.md                     EDIT (owned checks one-liner)
CLAUDE.md                                            EDIT (Key Patterns line)
docs/src/content/docs/core/health.md                 EDIT (registry architecture, no impl detail)
docs/src/content/docs/extend/plugins/server-contracts.md EDIT (ctx.registerHealthCheck shape)
docs/src/content/docs/extend/sdk/overview.md         EDIT (HealthCheckResult / PluginHealthCheckInput exports)
docs/public/llms/plugin-authoring.md                 EDIT (LLM mirror)

.claude/specs/doctor-decoupling.md                   THIS FILE (created during /agent-skills:spec)
.claude/specs/doctor-decoupling-plan.md              NEW (created during /agent-skills:plan)
```

**Not touched:**

- `packages/core/src/plugin-types.ts` — `HealthCheckResult` and `PluginHealthCheckInput` already canonical here. The "scheduled to be collapsed" comment at line 240-242 gets the staleness removed (one-line edit) but the type stays put.
- `packages/core/src/agent-packages/managed-blocks.ts` — the marker primitives (`extractBlock`, `getBlockState`, `injectBlock`) stay where they are. `plugins/health/lib/managed-blocks.ts` imports them.
- `server.ts` — `doctor.start()` / `doctor.stop()` calls unchanged.
- `~/.openclaw/workspaces/{agentId}/AGENTS.md` markers — `<!-- bakin:*:start/end -->` are user state. No marker rename, no marker rewrite.
- `~/.bakin/settings.json` — `doctor.intervalMs`, `doctor.autoFixSkill`, `doctor.requireOnboard` stay.
- `~/.bakin/audit.jsonl` — schema unchanged. New rows use namespaced check ids; old rows aren't rewritten.

---

## 6. Code Style

Inherit conventions from CLAUDE.md and the workflows precedent (`plugins/workflows/lib/health-checks.ts`):

- **TypeScript strict.** No `any` across module boundaries. `HealthCheckResult` is the public type at every boundary.
- **Inline `ok`/`warn`/`error`/`fixed` constructors per file.** Each migrated file declares its own 3-4 line constructors. No shared utility module — the duplication is cheaper than the indirection.
- **Each check file exports named functions** (`checkAgentRoster`, `checkPersonas`, ...). The plugin's `index.ts` imports them and wraps each with `ctx.registerHealthCheck({ id, name, run: () => checkAgentRoster(getContentDir()) })`.
- **Plugins read settings inline.** Migrated checks call `getSettings()` directly instead of taking `autoFix` as a parameter (matches `plugins/workflows/lib/health-checks.ts:125`). The `runDiagnostics` no longer threads `autoFix` through every call.
- **Imports from core.** Plugins reach into `src/core/*` and `packages/core/src/*` as needed (existing precedent — workflows already does this).
- **Logging.** `const log = createLogger('module-name')` from `@bakin/core`; one logger per file.
- **Per-check try/catch** lives in the orchestrator (`runPluginHealthChecks` in `src/core/doctor.ts`). Plugin-side check functions don't need to catch their own errors — a thrown exception becomes one synthetic error result, never crashes the sweep.
- **No backwards-compat shims.** No `DiagnosticResult` type alias. No re-exports of moved symbols from `doctor.ts`. Direct imports at call sites.

---

## 7. Testing Strategy

Mirror the workflows precedent — `tests/plugins/workflows/health-checks.test.ts` is the template.

**Per-plugin test file** (`tests/plugins/{owner}/health-checks.test.ts`):

1. **Existing behavioral cases preserved verbatim** for each migrated check — drift detection, autoFix paths, error/warn cases. No drop in coverage.
2. **Registration smoke test.** One `it()` per plugin: assert `ctx.registerHealthCheck` was called with each expected id during `activate()`. Catches "I forgot to wire it up" regressions. Pattern:

   ```ts
   it('registers all owned health checks on activate', () => {
     const ctx = makeMockContext()
     teamPlugin.activate(ctx)
     expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-roster' }))
     expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'personas' }))
     expect(ctx.registerHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-assets' }))
   })
   ```

3. **`tests/plugins/test-helpers.ts`** existing helpers (`activatePlugin`, `callRoute`, `callTool`) provide the isolated mock context. Use them.

**Health plugin test files** — split for readability:

- `tests/plugins/health/managed-blocks.test.ts` — absorbs `tests/core/doctor-managed-blocks.test.ts` (249 lines). Imports from `plugins/health/lib/managed-blocks`. Tests cover `applyAllManagedBlocks` against per-agent AGENTS.md fixtures.
- `tests/plugins/health/system-checks.test.ts` — subset of `tests/core/doctor.test.ts` covering the 9 system checks (or split further per file if the test grows past ~400 lines; per-system-check files are also acceptable).

**Core test file** — `tests/core/doctor.test.ts` slims to ~80 lines:

- `runDiagnostics` calls `runPluginHealthChecks` and aggregates results.
- `getLastResults` returns the most recent run.
- `notifyUnfixableIssues` notifies once per unique issue set, dedups by `{check, status}` key.
- `appendAudit` is called with the right summary shape.
- Onboarding gate: `requireOnboard=true` + not onboarded → single `onboarded` error, no other checks run.

**Core test file (kept)** — `tests/core/doctor-plugin-checks.test.ts` already exercises `runPluginHealthChecks` isolation (a bad handler doesn't crash the sweep). Stays as-is.

**Test isolation rules** (CLAUDE.md mandatory):

```ts
// At the top of every new plugin health-check test file:
const testDir = pathJoin(tmpdir(), `bakin-test-${pluginId}-health-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => `${testDir}/openclaw`,
  getOpenClawPath: (...parts: string[]) => [`${testDir}/openclaw`, ...parts].join('/'),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
```

Every test file has `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`.

**Run command:** `bun test --isolate` for the full suite. Per-file: `bun test tests/plugins/team/health-checks.test.ts --isolate`. CI continues to use `--isolate`; commits must pass it.

**TypeScript check:** `bunx tsc --noEmit -p tsconfig.app.json` must be green at every commit (Bun's runtime test runner doesn't catch TS-only errors).

---

## 8. Boundaries

### Always do

- Preserve check **behavior verbatim**. The current implementation is the spec for the migrated implementation. Auto-fix policies, message strings, status mappings — copy, don't redesign.
- Keep marker text (`<!-- bakin:*:start/end -->`) **bit-identical** to today. These markers exist in user files; renaming orphans them.
- Preserve **return-result semantics** including `autoFixable: true` flags on warnings. The dashboard renders these as "fix" buttons.
- Run `bun test --isolate` and `bunx tsc --noEmit` after every commit. CI runs both — if local passes and CI fails, something is wrong with the local setup.
- Update **test isolation mocks** in every new test file. Leaked test data has corrupted `~/.bakin/` and `~/.openclaw/` in past incidents (per `feedback_test_isolation.md` memory).

### Ask first about

- Any change to the **`HealthCheckResult` interface fields**. The shape is consumed by health plugin's React UI, audit log, antfly indexing, and (via SDK) every plugin author. A field addition is small, but worth a checkpoint.
- Behavioral changes to a check that surface during migration (e.g., realizing a check has a bug). File a follow-up issue; do not bundle the fix into this PR.
- **Splitting commit #9** (managed-blocks) if it grows past ~400 LoC of churn. The current commit-strategy plan keeps the relocation + check-registration atomic; split only if review burden demands it.

### Never do

- **Never rename markers in user files.** `<!-- bakin:orchestrator-rules:start -->`, `<!-- bakin:mission-control:start -->`, etc. — these strings are written into `~/.openclaw/workspace/AGENTS.md` and `~/.openclaw/workspaces/{agentId}/AGENTS.md`. Renaming them orphans existing user state.
- **Never add a `DiagnosticResult` type alias** for backwards compatibility. The interface is deleted; every consumer migrates to `HealthCheckResult` in the same commit.
- **Never re-export migrated symbols from `src/core/doctor.ts`.** No `export { applyAllManagedBlocks } from '../../plugins/health/lib/managed-blocks'`. The CLI imports from the new home directly.
- **Never change check ids without considering audit-log impact.** Migrated check ids gain a plugin prefix (`team.agent-roster`, not `agent-roster`). This is one-time. Don't re-rename later.
- **Never migrate a check across two commits** (extract-then-remove). Each migration commit moves one check fully: add new file, register in plugin's `activate()`, remove from `doctor.ts`'s `runDiagnostics()`. If CI is red after the commit, the migration is incomplete.
- **Never bundle the #172 cleanup** (CLI agent-rules unification) into this PR. It's filed as a separate issue and will land independently, after #139 ships.

---

## 9. Commit Checkpoint Sequence

Detailed per-commit plan lives in `.claude/specs/doctor-decoupling-plan.md` (next phase). Refresher only:

| # | Commit message | Migrates |
|---|---|---|
| 1 | `refactor(team): own agent-roster + personas + agent-assets health checks` | 3 checks → team |
| 2 | `refactor(tasks): own taskboard + task-consistency + task-position health checks` | 3 checks → tasks |
| 3 | `refactor(assets): own asset-sidecar health check` | 1 check → assets |
| 4 | `refactor(schedule): own schedule-sync health check` | 1 check → schedule |
| 5 | `refactor(memory): own search-tables health check` | 1 check → memory |
| 6 | `refactor(health): own content-dir + service + mcporter system checks` | 3 system checks |
| 7 | `refactor(health): own gateway + antfly system checks` | 2 system checks |
| 8 | `refactor(health): own orchestrator-rules + sync-skill + plugin-assets system checks` | 3 system checks |
| 9 | `refactor(health): own managed-blocks system check + relocate infra` | 1 check + ~340 lines moved + CLI imports updated |
| 10 | `refactor(core): collapse DiagnosticResult into HealthCheckResult (#139)` | Type rename + delete inline helpers + delete stray health-page.tsx copy + docs |

**Single PR.** Each commit leaves a green build. Per-commit verification: `bun test --isolate` + `bunx tsc --noEmit -p tsconfig.app.json`.

---

## 10. Acceptance

- [ ] `grep -nE "function check[A-Z]" src/core/doctor.ts` returns zero matches.
- [ ] `grep -nE "interface DiagnosticResult" /Users/roscoe/go/src/github.com/madeinwyo/bakin -r --include="*.ts" --include="*.tsx"` returns zero matches.
- [ ] `wc -l src/core/doctor.ts` is ≤ 100.
- [ ] `bun test --isolate` is green.
- [ ] `bunx tsc --noEmit -p tsconfig.app.json` is green.
- [ ] `bun run build` produces a working binary; `./bakin doctor` runs and returns the same shape and approximate result count it does today (modulo namespaced check ids).
- [ ] `bakin agent-rules --apply-all` and `--check-all` continue to work — their imports now point at `plugins/health/lib/managed-blocks`.
- [ ] Health-page UI in the running app renders the doctor dashboard with all 18 check ids visible (now plugin-namespaced).
- [ ] `~/.openclaw/workspaces/{agentId}/AGENTS.md` markers are byte-identical pre- and post-migration on a test instance.
- [ ] `.claude/knowledge/doctor-and-health-checks.md` exists and accurately describes the post-migration architecture.
- [ ] Issue #139 closed by the merging PR. Issue #172 remains open for the follow-up CLI cleanup.

---

## 11. Open Micro-Decisions (settle during build)

These are small enough to not need spec-level interview but worth flagging so the build phase doesn't stall:

- **`tests/plugins/health/system-checks.test.ts` granularity.** Start as one file. If it grows past ~400 lines during migration, split per system-check file (`tests/plugins/health/system-checks/{content-dir,service,...}.test.ts`). Decision deferred to commit #6.
- **Inline `ok`/`warn`/`error`/`fixed` per file vs shared util.** Spec says inline (matches workflows precedent). If the duplication feels wrong during build, consider `plugins/health/lib/result-helpers.ts` exporting them — but this would deviate from the workflows precedent and create a cross-plugin dep. Default: stay inline.
- **`registerHealthCheck` in `activate()`: synchronous call?** Yes. The function is sync (`registerPluginHealthCheck` returns the namespaced id). Each registration is one line per check.
- **Memory plugin: existing health-checks file?** Verify during build. If `plugins/memory/lib/health-checks.ts` already exists from earlier work (memory plugin's own observability), append to it; don't create a sibling.
