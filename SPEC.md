# Bakin Tech-Debt Cleanup Pass — Spec

**Date:** 2026-04-23
**Driver:** Main Operator
**Decisions confirmed:**
- **Scope A = A2** — full `vitest` → `bun test` migration; `better-sqlite3` eliminated from all deps.
- **Scope B = tiers 1 + 2 + 3** — active code, active docs, and archival records all get the sweep.

**Context:** Bakin has not been distributed — this machine is the only installation. No backwards compatibility concerns. No shims. No legacy fallbacks. Kill everything that is not earning its keep.

This spec enumerates every concrete cleanup item. The follow-on plan (`.claude/tasks/cleanup-plan.md`, written by `/agent-skills:plan`) will translate this into ordered commits with verification gates.

---

## 1. Objective

Produce a codebase where:

1. Every reference to the old "beacon" name is gone — code, tests, docs, knowledge, runtime files, and user-memory files.
2. `better-sqlite3` is removed from both `dependencies` and `devDependencies`; the binary uses `bun:sqlite` natively, tests run under `bun test` (which also resolves `bun:sqlite` natively), nothing in the repo imports `better-sqlite3`.
3. The vitest test runner is replaced with Bun's built-in test runner (`bun test`). `vitest.config.ts`, `@vitest/coverage-v8`, `vitest`, `vi.*` APIs, test shims that exist only because vitest couldn't resolve `bun:` protocol — all gone.
4. Every `@deprecated` alias, legacy-format migration branch, and "kept for backward compat" code path in first-party source is deleted.
5. Stale one-shot migrations that already ran on this machine are deleted, not dormant.
6. Archival `.claude/specs/done/*` and `.claude/tasks/issue-*-{plan,todo,test-triage}.md` files for already-merged issues are deleted.
7. Active `.claude/knowledge/*.md`, `README.md`, `CLAUDE.md`, `docs/plugin-authoring.md`, and user-memory files accurately reflect the cleaned-up code.
8. `bun x tsc --noEmit`, `bun run lint`, and `bun test` all pass.
9. `bun run build` produces a working binary end-to-end; `bakin doctor` reports cleanly on boot.

Non-goals:

- Relocating `src/components/*` into `packages/sdk/src/components/`. `@bakin/sdk/components` is already a re-export barrel; the split is intentional architecture, not debt.
- Touching the `cli/bakin.ts` ↔ `src/core/cli.ts` structure. CLAUDE.md documents this as current design.
- Migrating live data under `~/.bakin/` beyond one stale doc file.

---

## 2. Work Items (enumerated)

IDs group the work into logical chunks. Commit strategy in §3 orders them. Verification in §4.

### 2.1 Pre-flight (existing uncommitted work)

| ID | Location | Change | Acceptance |
|---|---|---|---|
| P-1 | `src/core/doctor.ts` | Commit the already-applied `openDoctorDb` Bun-only rewrite. | `git diff src/core/doctor.ts` clean; `bun x tsc --noEmit` exit 0. |

### 2.2 Beacon reference elimination (code)

| ID | Location | Change | Acceptance |
|---|---|---|---|
| B-1 | `src/core/antfly.ts` lines 42–49, 116–148 | Delete `LEGACY_TABLES` const, `wipeLegacyTables()` function, and the call site in `initialize()`. | `grep -in beacon src/core/antfly.ts` empty. |
| B-2 | `tests/core/antfly.test.ts` lines 170–176 | Delete the "no legacy beacon_ tables" test case — the assertion becomes trivially true once the code is gone. | File contains no `beacon` string. |
| B-3 | `tests/core/search-migration.test.ts` line 127 | Rename fixture `beacon_legacy` → `external_legacy`. Purpose ("non-bakin table, leave alone") preserved. | No `beacon` in file. |

### 2.3 `better-sqlite3` removal (runtime side)

| ID | Location | Change | Acceptance |
|---|---|---|---|
| S-1 | `plugins/tasks/migrations/2.1.0.ts` | Delete the file. The migration already ran on this machine; all rows carry `order`, none carry `position`. Pre-flight D-9 verifies no orphans exist. | File absent. |
| S-2 | `plugins/tasks/index.ts` (or wherever migrations are registered) | Remove the 2.1.0 registration + any associated migration-list entry. | `grep -rn "2\.1\.0" plugins/tasks/` returns only CHANGELOG/archived refs. |
| S-3 | `tests/plugins/tasks/migration.test.ts` | Delete (tests only the removed migration). | File absent. |
| S-4 | `dev/imitation-crab/seed.ts` lines 77–88 | Replace `require('better-sqlite3')` with `import { Database } from 'bun:sqlite'` at the top; drop the try/catch "might not be available" fallback (seed runs under Bun). | `grep better-sqlite3 dev/imitation-crab/seed.ts` empty; `bun run mock:seed --force` completes without errors. |
| S-5 | `scripts/build-plugins.ts` line 7 | Edit the doc comment referencing `better-sqlite3` to read `bun:sqlite`. | Comment reflects current state. |

### 2.4 Vitest → Bun test migration

**Summary of surface (verified before spec):**
- 225 test files total; 213 use `vi.*` in some form.
- 20 distinct `vi.*` APIs in use: `vi.advanceTimersByTime`, `vi.advanceTimersByTimeAsync`, `vi.clearAllMocks`, `vi.doMock`, `vi.fn`, `vi.hoisted`, `vi.importActual`, `vi.mock`, `vi.mocked`, `vi.resetModules`, `vi.restoreAllMocks`, `vi.runAllTimersAsync`, `vi.setSystemTime`, `vi.spyOn`, `vi.stubGlobal`, `vi.unmock`, `vi.unstubAllGlobals`, `vi.useFakeTimers`, `vi.useRealTimers`, `vi.waitFor`.
- 7 `tests/components/*.test.tsx` files use `@testing-library/react` and need a DOM environment.
- `vitest.config.ts` has 25 path aliases.

**Bun test equivalents:**
- `vi.mock(path, factory)` → `mock.module(path, factory)` (hoisted by bun-loader; same semantics).
- `vi.fn()` → `mock()` from `"bun:test"`.
- `vi.spyOn(obj, key)` → `spyOn(obj, key)` from `"bun:test"`.
- `vi.useFakeTimers()` / `vi.useRealTimers()` / `vi.setSystemTime()` → Bun's `setSystemTime()` + `mock.module('timers', …)` pattern; verify per-test-file where fake-timer semantics matter.
- `vi.hoisted(fn)` → `const _ = (() => fn())()` at module top, or rely on `mock.module` hoisting.
- `vi.importActual(path)` → `await import(path)` (Bun doesn't need the aliased actual-module lookup because `mock.module` overlays rather than replaces the loader).
- `vi.doMock` / `vi.unmock` / `vi.resetModules` → not directly available; each call site needs manual factoring. Typically replaced with scoped `mock.module` inside specific blocks.
- `vi.stubGlobal` / `vi.unstubAllGlobals` → assignment to `globalThis` + teardown in `afterEach`.
- `vi.waitFor` → `@testing-library`'s own `waitFor` (which works under Bun) or a small polling helper.
- `vi.mocked(fn)` → type cast (`fn as Mock<typeof fn>` or `ReturnType<typeof mock>`).

**DOM environment:** `bun test` supports `happy-dom` and `jsdom` via `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]` + `environment = "jsdom"` or using `@happy-dom/globalregistrator` in the setup file). Default choice: **happy-dom** — faster than jsdom, better Bun integration, ~all RTL features we use.

**Coverage:** Bun has native `--coverage` flag with `lcov` / `text-summary` outputs. Replaces `@vitest/coverage-v8`.

| ID | Location | Change | Acceptance |
|---|---|---|---|
| T-1 | `bunfig.toml` (new file at repo root) | Create with `[test]` section: `preload = ["./tests/setup.ts"]`, `env = { NODE_ENV = "test" }`, path-alias table mirrored from `tsconfig.json` (Bun picks up tsconfig paths automatically but we add explicit `@bakin/*` workspace paths for belt-and-suspenders). | File exists; `bun test --help` accepts the config. |
| T-2 | `tests/setup.ts` | Rewrite: replace `import { vi } from 'vitest'` + the four `vi.mock()` calls with `import { mock } from 'bun:test'` + `mock.module(...)` equivalents. Add `import { GlobalRegistrator } from '@happy-dom/globalregistrator'; GlobalRegistrator.register()` so every test has `document`/`window`. | File imports only `bun:test` + `@happy-dom/globalregistrator`. |
| T-3 | `tests/setup.ts` (same file, additional section) | The file currently mocks `@bakin/core/main-agent` at **four** path variants to catch every import style. With bun, `mock.module('@bakin/core/main-agent', …)` is canonical. Drop the three relative-path duplicates unless `bun test` cannot resolve them (verify empirically on first run; keep only what's needed). | One canonical mock per symbol. |
| T-4 | All test files using `vi.mock(path, factory)` (213 files) | Replace with `mock.module(path, factory)` + ensure the factory is still hoisted. Most factories are already plain object returns; the mechanical rewrite is a sed-scope search-and-replace followed by a per-file typecheck pass. | No `vi.mock` calls remain; `bun test` collects all specs. |
| T-5 | All test files using `vi.fn()` / `vi.spyOn()` | Replace with `mock()` / `spyOn()` from `"bun:test"`. Add the import at top if absent. | No `vi.fn` / `vi.spyOn` calls. |
| T-6 | All test files using `vi.mocked(x)` | Replace with type casts. Bun's `mock()` return type already includes mock metadata — `(fn as Mock<typeof fn>)` works. | No `vi.mocked` references. |
| T-7 | Fake-timer tests (~12 files, `grep -l vi.useFakeTimers tests/`) | Replace with `setSystemTime` / `mock.module('timers', …)` pattern; verify timer semantics test-by-test (some may need rewrites, not mechanical). | Each fake-timer test still exercises its original behavior. |
| T-8 | `vi.hoisted`, `vi.doMock`, `vi.unmock`, `vi.resetModules` usages | Audit each (`grep -rn "vi\.\(hoisted\|doMock\|unmock\|resetModules\)" tests/`). Usually ~<20 sites. Rewrite to `mock.module` top-of-file or scoped-block idioms. | No matches for these four APIs. |
| T-9 | `tests/shims/bun-sqlite.ts` | Delete. `bun test` resolves `bun:sqlite` natively from Bun's builtin. | File absent. |
| T-10 | `tests/shims/tanstack-router.ts` | Evaluate: Bun may or may not need this shim. Keep if `bun test` fails to resolve `@tanstack/react-router` server-side; delete otherwise. Decision made during build phase, not during planning. | Resolved one way or the other, with comment in `tests/shims/README.md` if kept. |
| T-11 | `vitest.config.ts` | Delete. | File absent. |
| T-12 | `package.json` — `scripts` | Replace `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:components": "vitest run tests/components"`, `"test:coverage": "vitest run --coverage"` with `"test": "bun test"`, `"test:watch": "bun test --watch"`, `"test:components": "bun test tests/components"`, `"test:coverage": "bun test --coverage"`. | Scripts reflect bun test. |
| T-13 | `package.json` — `devDependencies` | Remove `vitest`, `@vitest/coverage-v8`. Add `@happy-dom/globalregistrator` (DOM env for RTL). | `grep vitest package.json` empty; happy-dom present. |
| T-14 | `package.json` — `devDependencies` | Remove `better-sqlite3`, `@types/better-sqlite3`. | `grep better-sqlite3 package.json` empty. |
| T-15 | `package.json` — `trustedDependencies` | Remove the field entirely (only better-sqlite3 was listed). | No `trustedDependencies` key. |
| T-16 | `.github/workflows/*.yml` | Replace any `vitest run` / `npx vitest` invocation with `bun test`. Replace `@vitest/coverage-v8` artifacts with Bun's coverage paths. | CI workflows point at `bun test`. |
| T-17 | `eslint.config.mjs` | If vitest-specific rules/ignores exist, convert or remove. | Lint still clean. |
| T-18 | `CONTRIBUTING.md`, `CLAUDE.md` — testing rules section | Rewrite to reference `bun test` as the runner. Update `bunx vitest run` and `bunx vitest watch` mentions. **IMPORTANT:** CLAUDE.md's "Testing Rules — CRITICAL" section must still enforce content-dir mocking — the *rule* is runner-agnostic. | Docs reference `bun test`. |

### 2.5 Dead shim / deprecated-type elimination (tier-1)

| ID | Location | Change | Acceptance |
|---|---|---|---|
| D-1 | `packages/core/src/plugin-types.ts` lines 689–691, 725–727 | Delete `MCPlugin = BakinPlugin` and `MCConfig = BakinConfig` type aliases. | `grep -rn "MCPlugin\|MCConfig" packages/ src/` empty. |
| D-2 | `packages/core/src/index.ts` lines ~29, ~33 | Drop `MCPlugin` + `MCConfig` from the re-export list. | Empty grep. |
| D-3 | `packages/sdk/src/types/index.ts` lines ~22, ~26 | Drop `MCPlugin` + `MCConfig` from the re-export list. | Empty grep. |
| D-4 | `src/lib/plugin-types.ts` lines ~26, ~30 | Drop `MCPlugin` + `MCConfig` from the re-export list. | Empty grep. |
| D-5 | `packages/core/src/settings.ts` lines 83–91 | Delete the legacy `embedder?:` field from the `BakinSettings.antfly` type. | Type declaration lacks `embedder?`. |
| D-6 | `packages/core/src/settings.ts` lines 295–307 | Delete the `legacyEmbedder` migration block in `getSettings()`. | Function body shorter; no "embedder is deprecated" log. |
| D-7 | Pre-flight — `jq` | **Check ran 2026-04-23: returned `null`.** Safe to delete. | Verified. |
| D-8 | `plugins/tasks/lib/flow-store.ts` lines 120–121 | Delete `@deprecated confirmed?: boolean` field from state type. | No `confirmed` field in type. |
| D-9 | Pre-flight — SQL | **Check ran 2026-04-23: both queries returned 0.** `confirmed`-without-`archived` rows = 0; `position`-field rows = 0. Safe to delete both fallbacks. | Verified. |
| D-10 | `plugins/tasks/lib/flow-store.ts` `getColumn()` ~line 137 | Change `(state.archived \|\| state.confirmed)` to `state.archived`. | Function reads only `archived`. |
| D-11 | `src/core/dispatch.ts` line 42 | Narrow `failedDispatches: Record<string, FailureRecord \| number>` to `Record<string, FailureRecord>`. Drop the `// number = legacy format` comment. | Type is clean. |
| D-12 | `src/core/dispatch.ts` lines 86–92 | Simplify `getFailureRecord` to accept only `FailureRecord \| undefined`; remove the `typeof entry === 'number'` branch and its comments. | No numeric branch. |
| D-13 | Pre-flight — `jq` | **Check ran 2026-04-23: 8 numeric entries exist.** Mitigation: the D-11/D-12 commit must `rm ~/.bakin/.dispatch-state.json` before landing; the file regenerates on next dispatch with zero data loss (cooldown timestamps only). | State file deleted before code change; first dispatch after boot recreates it in the new format. |
| D-14 | `src/lib/taskboard.ts` | Delete this re-export shim. Update all importers to reach directly into `@bakin/tasks/lib/flow-store`. Current importers: `src/core/dispatch.ts` (line 142), potentially `src/core/task-service.ts`, `src/core/continuation.ts`. Audit via `grep -rln "from '../lib/taskboard'\|from '@/lib/taskboard'" src/`. | File absent; all importers updated; `tsc --noEmit` green. |

### 2.6 Doc refresh — active docs (tier-2)

| ID | Location | Change | Acceptance |
|---|---|---|---|
| K-1 | `.claude/knowledge/search-system.md` line 123 | Delete paragraph "On startup, any `beacon_*` tables are wiped automatically." | No `beacon` in file. |
| K-2 | `.claude/knowledge/search-system.md` line 133 | Rephrase "legacy single-index path" — describe it as the default path when `indexes[]` isn't declared, not as legacy. | Neutral language. |
| K-3 | `.claude/knowledge/search-system.md` line 288 | Delete the entire paragraph about `settings.antfly.embedder` being "still read on load" — after D-5/D-6 it isn't. | Paragraph gone. |
| K-4 | `.claude/knowledge/tasks-plugin.md` line 201 | Rewrite the "pre-migration" sentence: describe `bun:sqlite` as the current runtime, drop the "`better-sqlite3` had the same surface" historical detail. | No `better-sqlite3` in file. |
| K-5 | `.claude/knowledge/tasks-plugin.md` | Sweep for `position` references describing the old field. Rewrite to describe only `order`. | `grep -n position` returns only tests-scoped content. |
| K-6 | `.claude/knowledge/repo-architecture.md` line 45 | Rewrite "thin legacy CLI wrapper" — the design is current. Say "thin CLI wrapper delegated to by the binary dispatcher for HTTP-backed commands." | No "legacy" where the design is active. |
| K-7 | `.claude/knowledge/storage-model.md` line 12 | If `CONTENT_DIR` env var is no longer read by `packages/core/src/content-dir.ts`, delete both the env var support and the doc line. If still read, drop the "legacy compat" label. | Code + doc agree. |
| K-8 | `.claude/knowledge/dev-loop.md` line 115 | "unowned entries (test registrations, pre-v2 legacy) survive" — drop the `pre-v2 legacy` parenthetical since pre-v2 doesn't exist anymore. | Parenthetical gone. |
| K-9 | `.claude/knowledge/memory-plugin.md`, `workflows-plugin.md`, `messaging-plugin.md`, etc. | Sweep for `better-sqlite3`, `MCPlugin`, `MCConfig`, `antfly.embedder` (singular), `beacon`. Fix any hit. | Clean grep. |
| K-10 | `README.md` | Already clean on read (no `better-sqlite3`, no `beacon`, says `bun:sqlite`). Verify after other changes. No edits expected. | Verified. |
| K-11 | `CLAUDE.md` | Sweep for `beacon`, `better-sqlite3`, `MCPlugin`, `MCConfig`, `antfly.embedder`, `bunx vitest`. Update the "Testing Rules — CRITICAL" block to say `bun test` instead of `bunx vitest run`. | Clean; matches new runner. |
| K-12 | `docs/plugin-authoring.md` | Sweep same terms as K-11. Plugin-author guidance references `@bakin/sdk` (already canonical) and should not mention `MCPlugin`. | Clean. |
| K-13 | `dev/imitation-crab/README.md` (if present) | Sweep same terms. Reference `bun:sqlite` consistent with S-4. | Consistent with code. |

### 2.7 Archival doc cleanup (tier-3)

For each archival doc, the choice is **delete** (if the document records an already-merged issue with no remaining audit value) or **rewrite** (if it's still referenced as context).

#### 2.7.1 Delete — merged-issue plan/todo pairs

All the following are plan/todo pairs for PRs that have already landed on `main`:

| ID | Path | Reason |
|---|---|---|
| A-1 | `.claude/tasks/issue-73-plan.md` | Issue merged (watcher unlink hook). |
| A-2 | `.claude/tasks/issue-73-todo.md` | Pair with A-1. |
| A-3 | `.claude/tasks/issue-115-plan.md` | Issue merged (dispatch retry). |
| A-4 | `.claude/tasks/issue-115-todo.md` | Pair with A-3. |
| A-5 | `.claude/tasks/issue-118-plan.md` | Issue merged. |
| A-6 | `.claude/tasks/issue-118-todo.md` | Pair with A-5. |
| A-7 | `.claude/tasks/issue-125-plan.md` | Issue merged (notification channels registry). |
| A-8 | `.claude/tasks/issue-125-todo.md` | Pair with A-7. |
| A-9 | `.claude/tasks/issue-129-plan.md` | Issue merged (models loading UX). |
| A-10 | `.claude/tasks/issue-129-todo.md` | Pair with A-9. |
| A-11 | `.claude/tasks/issue-137-plan.md` | Issue merged (health checks registry). |
| A-12 | `.claude/tasks/issue-137-todo.md` | Pair with A-11. |
| A-13 | `.claude/tasks/issue-147-plan.md` | Issue merged (Bun migration). |
| A-14 | `.claude/tasks/issue-147-todo.md` | Pair with A-13. |
| A-15 | `.claude/tasks/issue-147-test-triage.md` | Pair with A-13. References better-sqlite3 test shim — irrelevant after this cleanup. |
| A-16 | `.claude/tasks/plan.md` | Antfly search system plan — feature shipped; references `beacon_*`, `wipeBeaconTables()`. |
| A-17 | `.claude/tasks/todo.md` | Pair with A-16. |

#### 2.7.2 Delete — merged-spec done files

`.claude/specs/done/` is flagged "archival" by path. Per the user's "no residual bullshit": delete the directory.

| ID | Path | Reason |
|---|---|---|
| A-18 | `.claude/specs/done/00-core-variables.md` | Archival. |
| A-19 | `.claude/specs/done/01-claude-directory.md` | Archival. |
| A-20 | `.claude/specs/done/02-repo-structure.md` | Archival. |
| A-21 | `.claude/specs/done/04-plugin-architecture.md` | Archival. |
| A-22 | `.claude/specs/done/05-audit-*.md` (7 files) | Archival per-plugin audits — all completed. Current audit → live `.claude/knowledge/` docs. |
| A-23 | `.claude/specs/done/06-routing-refactor.md` | Archival. |
| A-24 | `.claude/specs/done/08-taskflow-migration.md` | Archival; references `better-sqlite3` — this cleanup pass moots it. |
| A-25 | `.claude/specs/done/bakin-hardening-plan.md` | Archival. |
| A-26 | `.claude/specs/done/` | Remove the (empty) directory itself. |

#### 2.7.3 Delete or consolidate — top-level `.claude/specs/*.md` for shipped features

| ID | Path | Disposition |
|---|---|---|
| A-27 | `.claude/specs/bun-migration.md` | Shipped. Value was in driving the migration. Delete — knowledge/dev-loop.md + CLAUDE.md contain the live record. |
| A-28 | `.claude/specs/plugin-client-ui-loader.md` | Shipped (Phase F of bun-migration). Delete. |
| A-29 | `.claude/specs/hmr-dev-loop.md`, `hmr-dev-loop-PLAN.md` | Shipped (issue #149). Delete — `.claude/knowledge/dev-loop.md` is the live record. |
| A-30 | `.claude/specs/issue-*.md` + matching `*-PLAN.md` files (issues 114, 115, 125, 129, 137, 67, 73, 90, 91) | Shipped. Delete. |
| A-31 | `.claude/specs/memory-plugin-rebuild.md` + `-PLAN.md` | Shipped. Delete. |
| A-32 | `.claude/specs/health-plugin-overhaul.md` | Shipped. Delete. |
| A-33 | `.claude/specs/messaging-refactor.md` | Shipped. Delete. |
| A-34 | `.claude/specs/asset-storage-architecture.md` + `-PLAN.md` | Shipped. Delete. |
| A-35 | `.claude/specs/assets-retype-inline-edit.md` | Shipped. Delete. |
| A-36 | `.claude/specs/first-run-onboarding.md` | Shipped. Delete. |
| A-37 | `.claude/specs/human-readable-activity-feed.md` | Shipped. Delete. |
| A-38 | `.claude/specs/reindex-enrichment-observability.md` | Shipped. Delete. |
| A-39 | `.claude/specs/workflows-phase-2-plan.md`, `workflows-phase-2-plugin-nodes-and-canvas.md`, `workflows-plugin-architecture.md`, `workflows-plugin-plan.md` | Shipped. Delete. |
| A-40 | `.claude/specs/tasks-kanban-board.md`, `tasks-ordering-v2.md` | Shipped. Delete. |
| A-41 | `.claude/specs/agent-avatars.md`, `agent-lifecycle-tools.md` | Shipped. Delete. |
| A-42 | `.claude/specs/antfly-graph-indexes.md`, `antfly-search-system.md` | Shipped. Delete — `.claude/knowledge/search-system.md` is the live record. |
| A-43 | `.claude/specs/10-calendar-planning-overhaul.md`, `07-workflow-editor.md`, `07-cli-lifecycle.md`, `09-openclaw-mock.md`, `03-design-system.md`, `05-audit-memory.md`, `06-adapter-fresh-install.md`, `multimodal-search.md` | All shipped. Delete — live records live in `.claude/knowledge/*.md`. |

**Safeguard:** before deleting each archival file, verify it isn't referenced by an active `.claude/knowledge/*.md`, `README.md`, or `CLAUDE.md`. If it is, delete the reference too (replace with a link to the live knowledge doc).

### 2.8 Runtime data cleanup

| ID | Location | Change |
|---|---|---|
| R-1 | `~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md` | Delete file. |
| R-2 | `~/.openclaw/workspace/*/skills/beacon/` | If present, delete — doctor/`bakin install plugin-assets` re-installs the `bakin/` skill. Memory entry `project_beacon_skill_rename.md` becomes resolved. |

### 2.9 User-memory refresh

The auto-memory at `~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/` persists across Claude sessions. Stale `beacon` / `~/.beacon/` references will silently poison future sessions.

| ID | File | Change |
|---|---|---|
| M-1 | `MEMORY.md` (index) | Update one-line descriptions for any renamed memory; drop `project_beacon_skill_rename.md` entry. |
| M-2 | `project_beacon_skill_rename.md` | Delete — resolved by R-2. |
| M-3 | `project_content_migration.md` | Replace all `~/.beacon/` with `~/.bakin/`; update frontmatter `description`. |
| M-4 | `project_assets_plugin.md` | Replace `~/.beacon/` with `~/.bakin/`. |
| M-5 | `project_scripts_architecture.md` | Replace `beacon_exec_` with `bakin_exec_`. |
| M-6 | `feedback_globalthis_sse.md` | Rewrite rationale: "Module-level SSE state must use globalThis-backed storage because Bun's dev HMR re-evaluates modules" (was "Next.js webpack"). |

---

## 3. Commit Strategy

Each commit is individually revertable. Every commit must pass `bun x tsc --noEmit` + `bun test` (or `bunx vitest run` pre-migration) + `bun run lint`. Order chosen so earlier commits don't break later ones.

### Phase 1 — Pre-flight + code-level cleanup (pre-test-runner migration)

1. `fix(doctor): drop Node fallback in openDoctorDb` — **P-1**. Clears the TS error that's been blocking the branch.
2. `chore(antfly): remove beacon_* legacy table cleanup` — **B-1, B-2**.
3. `test: rename beacon_legacy fixture to external_legacy` — **B-3**.
4. `chore(tasks): delete 2.1.0 position→order migration` — **S-1, S-2, S-3, D-8, D-10**. Pre-flight: D-9 SQL check.
5. `chore(dev): port imitation-crab seed to bun:sqlite` — **S-4, S-5**.
6. `refactor(core): drop MCPlugin/MCConfig deprecated aliases` — **D-1, D-2, D-3, D-4**.
7. `refactor(settings): drop legacy antfly.embedder field` — **D-5, D-6**. Pre-flight: D-7 jq check.
8. `refactor(dispatch): drop legacy numeric FailureRecord format` — **D-11, D-12**. Pre-flight: D-13 jq check.
9. `refactor(taskboard): drop src/lib/taskboard.ts re-export shim` — **D-14**.

### Phase 2 — Test runner migration

Commits 10–14 land together as a short sequence because `bun test` and `vitest` cannot both work simultaneously.

10. `chore(test): introduce bunfig.toml + happy-dom setup` — **T-1, T-2, T-3**. New file; `tests/setup.ts` rewritten but still compatible with vitest on old `package.json` scripts (dual-runs possible). Verify locally before next commit.
11. `chore(test): migrate all test files from vi.* to bun:test` — **T-4, T-5, T-6, T-7, T-8**. Mechanical pass (213 files). Large diff. Land as one commit for atomicity (reverting mid-migration is worse than reverting the whole pass).
12. `chore(test): drop vitest + bun:sqlite shim + switch scripts to bun test` — **T-9, T-11, T-12, T-13, T-16**. Also decide on T-10 (tanstack-router shim) based on first `bun test` run.
13. `chore(deps): remove better-sqlite3 + trustedDependencies` — **T-14, T-15**.
14. `chore(lint): update eslint config for bun test ruleset` — **T-17** (if needed).

### Phase 3 — Doc + archival cleanup

15. `docs(knowledge): refresh active docs for removed concepts` — **K-1…K-13**.
16. `chore(docs): delete merged-issue plan/todo pairs` — **A-1…A-17**.
17. `chore(docs): delete specs/done/ archive` — **A-18…A-26**.
18. `chore(docs): delete top-level specs for shipped features` — **A-27…A-43**.
19. `docs: update README/CLAUDE.md/CONTRIBUTING.md for bun test` — **T-18** (deferred from Phase 2 to consolidate doc changes).

### Phase 4 — Runtime + memory cleanup

20. `chore(runtime): delete stale beacon refs in ~/.bakin/ + openclaw workspace` — **R-1, R-2**.
21. `chore(memory): scrub beacon references in user-memory` — **M-1…M-6**.

### Phase 5 — Verification (no commit)

Verification is the final PR-description block, not a separate commit. Run all §4 acceptance criteria; paste results into the PR body.

**Total: 21 commits** across 4 phases + a verification gate. Rollback granularity: Phase 1 reverts are trivial; Phase 2 reverts require reverting commits 10–14 as a unit; Phase 3–4 are per-commit revertable.

**Branch strategy:** single branch `chore/tech-debt-cleanup`. If the Phase 2 test migration hits unexpected fires, pause and carve out a sub-branch for the failing conversion surface rather than mid-phase committing broken state.

---

## 4. Acceptance Criteria (verification)

The pass is **done** when all of the following hold:

1. `grep -riI 'beacon\|Beacon' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='*.yml' --include='*.sh' .` returns **zero** hits.
2. `grep -r better-sqlite3 . --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md'` returns **zero** hits (no runtime dep, no devDep, no test shim, no doc reference).
3. `grep -rn "@deprecated" packages/core/src/ packages/sdk/src/ plugins/ src/` returns zero hits.
4. `grep -rn "\blegacy\b\|\bLegacy\b" --include='*.ts' --include='*.tsx' src/core/ packages/core/src/ plugins/` returns zero hits outside of comments describing why a *current-still-live* behavior exists (none expected after cleanup).
5. `grep -rn "\bvi\." tests/` returns zero hits.
6. `grep -rn "vitest" .` returns zero hits outside `package-lock.json` / `bun.lock`.
7. `bun x tsc --noEmit` exit 0.
8. `bun run lint` exit 0.
9. `bun test` passes; test count matches pre-migration count minus the explicitly deleted tests (S-3, B-2).
10. `bun test --coverage` runs and emits coverage artifacts (proves coverage pipeline works end-to-end).
11. `bun run build` produces a working `dist/bakin-darwin-arm64`. Booting it on port 3737 serves the dashboard; `bakin doctor` passes or warns only on known external conditions (not on changes from this pass).
12. `~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md` and any `~/.openclaw/workspace/*/skills/beacon/` dirs are absent.
13. `~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/` has no `beacon` references; `project_beacon_skill_rename.md` is absent.
14. `.claude/specs/done/` does not exist.
15. `.claude/tasks/issue-*-{plan,todo,test-triage}.md` files are absent.
16. `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/plugin-authoring.md`, and `.claude/knowledge/*.md` contain no references to removed concepts (`MCPlugin`, `MCConfig`, `antfly.embedder` singular, `vitest`, `@vitest/coverage-v8`).

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `bun test` behavior differs from vitest for a corner case (e.g., `vi.hoisted`, fake timers, dynamic `vi.doMock`). | T-7 and T-8 flag these explicitly. Migration is per-file; we verify each converted file passes before moving to the next batch. Phase 2 commits 10–14 sit on a branch until the full suite is green. |
| `happy-dom` behaves differently from `jsdom` for an RTL edge case. | Start with happy-dom. If any of the 7 component tests fails, swap to `jsdom` globally (flip the preload import) or scope jsdom to those specific files. Either fallback is cheap. |
| Deleting `src/lib/taskboard.ts` strands an importer we missed. | D-14 includes a repo-wide grep before deletion; `tsc --noEmit` catches any straggler. |
| Deleting the 2.1.0 task migration breaks a hypothetical rollback path. | User confirmed this machine is the only install; migration already ran. Pre-flight D-9 SQL check verifies no remaining `position`-only rows. |
| Deleting `state.confirmed` fallback strands old rows. | Pre-flight D-9 SQL check. If nonzero rows, backfill in the same commit before deleting the fallback. |
| Deleting `failedDispatches: number` legacy branch strands old records. | Pre-flight D-13 jq check; worst case, delete `~/.bakin/.dispatch-state.json` (regenerates). |
| Deleting all `.claude/specs/*` and `.claude/tasks/issue-*` loses historical audit trail. | The audit trail is `git log` + `gh pr view <n>`. Knowledge docs capture live facts. User explicitly chose tier-3 deletion. |
| User-memory edits affect future Claude sessions. | Explicit per-file list (M-1…M-6); each edit preserves intent, corrects only stale details. |

---

## 6. Decisions Locked (2026-04-23)

1. **happy-dom** is the default DOM env; flip to jsdom only if a specific component test requires it.
2. **Phase 2 commit 11** (the `vi.*` → `bun:test` conversion) lands as **one** commit across all 213 files.
3. **Archival deletion** confirmed: `.claude/specs/done/` + all `.claude/tasks/issue-*` + all top-level `.claude/specs/*.md` for shipped features (A-1…A-43).
4. **No verification commit.** Verification runs inline and is reported in the PR description.
5. **Pre-flight checks ran 2026-04-23.** Results inlined into D-7, D-9, D-13 above. D-13 triggered the mitigation: the D-11/D-12 commit must `rm ~/.bakin/.dispatch-state.json` before landing.

---

## 7. Handoff to `/agent-skills:plan`

Next step: invoke `/agent-skills:plan` with this spec as input. The plan skill will:

1. Confirm answers to §6 open questions.
2. Expand the 22-commit strategy into ordered tasks with file paths, verification commands, and per-phase entry/exit criteria.
3. Produce `.claude/tasks/cleanup-plan.md` and `.claude/tasks/cleanup-todo.md`.

After plan approval: `/agent-skills:build` executes; `/agent-skills:test` audits coverage.
