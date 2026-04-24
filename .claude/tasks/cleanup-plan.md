# Bakin Tech-Debt Cleanup — Execution Plan

**Spec:** `SPEC.md` at repo root (the source of truth for every work item referenced here by ID).
**Branch:** `chore/tech-debt-cleanup`
**Date:** 2026-04-23
**Driver:** Main Operator

This plan translates `SPEC.md` into an ordered, parallelizable execution sequence. All work-item IDs (P-1, B-1, S-1, T-1, D-1, K-1, A-1, R-1, M-1, …) refer to `SPEC.md` §2.

---

## 1. Executive Summary

| Dimension | Figure |
|---|---|
| Total commits | 21 |
| Phases | 4 |
| Code files touched | ~40 (Phases 1, 2, 4) |
| Test files touched (vi.* → bun:test) | 227 files import `vitest`; 204 use `vi.mock`; 37 use `vi.hoisted`; 21 use `vi.resetModules` |
| Archival docs deleted | 43 (17 task plans/todos + 16 specs/done/ + ~26 top-level shipped specs; some A-* IDs cover multiple files) |
| Dependencies removed | `better-sqlite3`, `@types/better-sqlite3`, `vitest`, `@vitest/coverage-v8` |
| Dependencies added | `@happy-dom/globalregistrator` |
| Files deleted (code) | 4 (`plugins/tasks/migrations/2.1.0.ts`, `tests/plugins/tasks/migration.test.ts`, `tests/shims/bun-sqlite.ts`, `vitest.config.ts`, `src/lib/taskboard.ts`) — 5 counting the shim deletion |
| Runtime side-effects | `rm ~/.bakin/.dispatch-state.json` (once, before commit 8 lands) + `rm -rf ~/.openclaw/workspace/*/skills/beacon/` (if present) + `rm ~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md` |
| Estimated effort (single operator, end to end) | ~4–6 focused hours |

---

## 2. Dependency Graph (phase-level)

```
Phase 1 — code cleanup (vitest still in place)
    │  commits 1–9 are independent of Phase 2/3/4
    │  commits within Phase 1 have internal ordering: P-1 first (TS error gate), then commits
    │  can mostly run in any order since each touches different files.
    │
    ▼
Phase 2 — test runner migration
    │  commit 10 (bunfig.toml + setup.ts) — dual-runner verification window
    │  commit 11 (mechanical vi.* → bun:test) — must land as one commit
    │  commit 12 (scripts + shims + vitest removal) — point of no return: vitest gone
    │  commit 13 (drop better-sqlite3) — depends on commit 4 (S-3: delete migration.test.ts)
    │                                  + commit 5 (S-4: imitation-crab ported)
    │                                  + commit 12 (T-9: bun-sqlite shim gone)
    │  commit 14 (lint adjustments) — only if lint fails after 10–13
    │
    ▼
Phase 3 — docs + archival cleanup
    │  commits 15–19 are pure doc / deletion work, no code dependencies
    │  commit 15 (knowledge docs) depends on Phase 1 + 2 landing so docs match code
    │  commits 16–18 (archival deletes) are 100% parallel — three scripts
    │  commit 19 (README/CLAUDE/CONTRIBUTING update) depends on commit 12 (scripts now say "bun test")
    │
    ▼
Phase 4 — runtime + memory cleanup
        commit 20 (runtime beacon cleanup) — can happen any time after Phase 1 commit 2
        commit 21 (user memory scrub) — can happen any time; last because low-priority
```

**Critical ordering:**
- `P-1` must be commit 1 — the prior uncommitted doctor.ts edit unblocks `tsc --noEmit` for every subsequent commit.
- `commit 11` (213-file mechanical rewrite) must land atomically. Do not commit partial `vi.*` conversions.
- `commit 13` (remove `better-sqlite3` from package.json) depends on every file that imported it being gone first: commits 4, 5, 12.

---

## 3. Parallelism Map (what can run concurrently)

Commits 1–9 in Phase 1 touch **different files**. The build agent can prepare all of them in parallel after P-1 lands, then commit sequentially (since each commit updates `tsc --noEmit`'s view of the world). Preparation parallelism:

| Commit | Files touched | Safe-to-prepare-in-parallel-with |
|---|---|---|
| 1 (P-1) | `src/core/doctor.ts` | Must be first — gates the rest. |
| 2 (B-1, B-2) | `src/core/antfly.ts`, `tests/core/antfly.test.ts` | 3, 4, 5, 6, 7, 8, 9 |
| 3 (B-3) | `tests/core/search-migration.test.ts` | 2, 4, 5, 6, 7, 8, 9 |
| 4 (S-1, S-2, S-3, D-8, D-10) | `plugins/tasks/migrations/2.1.0.ts` (delete), `plugins/tasks/index.ts`, `tests/plugins/tasks/migration.test.ts` (delete), `plugins/tasks/lib/flow-store.ts` | 2, 3, 5, 6, 7 (different files); **NOT parallel with** 9 (flow-store is touched both places — actually 9 touches `src/lib/taskboard.ts`, not flow-store — parallel OK) |
| 5 (S-4, S-5) | `dev/imitation-crab/seed.ts`, `scripts/build-plugins.ts` | All others |
| 6 (D-1, D-2, D-3, D-4) | `packages/core/src/plugin-types.ts`, `packages/core/src/index.ts`, `packages/sdk/src/types/index.ts`, `src/lib/plugin-types.ts` | All others |
| 7 (D-5, D-6) | `packages/core/src/settings.ts` | All others |
| 8 (D-11, D-12) | `src/core/dispatch.ts` | All others; **runtime side-effect** `rm ~/.bakin/.dispatch-state.json` before commit |
| 9 (D-14) | `src/lib/taskboard.ts` (delete), `src/core/agents.ts`, `src/core/dispatch.ts`, `src/core/continuation.ts` | **NOT parallel with** 8 (both touch `dispatch.ts`). Sequence: 8 lands, then 9. |

**Phase 3 parallelism:**
- **Commit 15** (K-1…K-13 knowledge docs): 13 independent doc files can be edited in parallel by sub-agents.
- **Commit 16** (A-1…A-17 task plans/todos): single `rm` script.
- **Commit 17** (A-18…A-26 specs/done): single `rm -rf .claude/specs/done/` script.
- **Commit 18** (A-27…A-43 top-level specs): single `rm` script.
- Commits 16, 17, 18 can be prepared in parallel (three independent rm lists) and committed back-to-back.

**Phase 4 parallelism:**
- Commits 20 and 21 are independent and can land in either order.
- Within commit 21 (M-1…M-6), the 6 user-memory files can be edited in parallel.

**Agent dispatch plan (for /agent-skills:build):**
- **Wave 1:** prepare commits 2, 3, 4, 5, 6, 7 in parallel (6 independent changesets). Commit serially.
- **Wave 2:** land commit 8 (dispatch.ts changes + rm state file), then commit 9 (taskboard.ts shim removal — touches dispatch.ts).
- **Wave 3:** Phase 2 — land commits 10, 11, 12, 13, 14 in strict sequence (no parallelism possible).
- **Wave 4:** prepare commits 15, 16, 17, 18, 19 in parallel (doc edits + archival delete scripts), commit serially.
- **Wave 5:** commits 20, 21 in either order.

---

## 4. Per-Commit Detail Blocks

Each block specifies: **IDs**, **files**, **pre-flight** (if any), **actions**, **verification**, **commit message**.

### Phase 1 — Code Cleanup

#### Commit 1 — P-1: drop Node fallback in openDoctorDb

- **IDs:** P-1
- **Files:** `src/core/doctor.ts` (already modified in working tree, unstaged)
- **Pre-flight:** none
- **Actions:** stage + commit the already-applied edit
- **Verification:**
  ```bash
  bun x tsc --noEmit           # exit 0
  bunx vitest run tests/core/doctor.test.ts  # green
  ```
- **Commit message:** `fix(doctor): drop Node fallback in openDoctorDb`

#### Commit 2 — B-1 + B-2: remove beacon_* legacy table cleanup

- **IDs:** B-1, B-2
- **Files:**
  - `src/core/antfly.ts` — delete `LEGACY_TABLES` const (lines 42–49), `wipeLegacyTables()` function (lines 130–148), and the call site inside `initialize()` (line 117)
  - `tests/core/antfly.test.ts` — delete the test block at lines 170–176 ("should not have legacy beacon_ table names")
- **Pre-flight:** none (antfly tables verified by user as already wiped)
- **Actions:**
  1. Edit `src/core/antfly.ts` — remove the three chunks noted above
  2. Edit `tests/core/antfly.test.ts` — remove the single test case
- **Verification:**
  ```bash
  grep -in beacon src/core/antfly.ts                          # empty
  grep -in beacon tests/core/antfly.test.ts                   # empty
  bun x tsc --noEmit                                          # exit 0
  bunx vitest run tests/core/antfly.test.ts                   # green
  ```
- **Commit message:** `chore(antfly): remove beacon_* legacy table cleanup`

#### Commit 3 — B-3: rename beacon_legacy fixture

- **IDs:** B-3
- **Files:** `tests/core/search-migration.test.ts` line 127
- **Pre-flight:** none
- **Actions:** rename fixture table `beacon_legacy` → `external_legacy`
- **Verification:**
  ```bash
  grep -in beacon tests/core/search-migration.test.ts         # empty
  bunx vitest run tests/core/search-migration.test.ts         # green
  ```
- **Commit message:** `test: rename beacon_legacy fixture to external_legacy`

#### Commit 4 — S-1 + S-2 + S-3 + D-8 + D-10: delete 2.1.0 migration + confirmed fallback

- **IDs:** S-1, S-2, S-3, D-8, D-10
- **Files:**
  - `plugins/tasks/migrations/2.1.0.ts` — delete (`rm`)
  - `plugins/tasks/migrations/` — `rmdir` if empty after the above
  - `plugins/tasks/index.ts` — **investigate migration runner**. The plugin version `2.1.0` at line 42 is the plugin version, not the migration tag. Find where migrations are run (search `migrations/`, `runMigrations`, `migrate` in `plugins/tasks/index.ts` and `plugins/tasks/lib/`). Remove the registration / loader code that picks up files in `migrations/`.
  - `tests/plugins/tasks/migration.test.ts` — delete
  - `plugins/tasks/lib/flow-store.ts` — delete `@deprecated confirmed?: boolean` field (lines 120–121); change `(state.archived || state.confirmed)` → `state.archived` in `getColumn()` (~line 137)
- **Pre-flight:** Spec D-9 — already run 2026-04-23; both queries returned 0 rows. No action needed.
- **Actions:**
  1. `rm plugins/tasks/migrations/2.1.0.ts`
  2. `rmdir plugins/tasks/migrations/` (it was the only file)
  3. Edit `plugins/tasks/index.ts` — remove migration registration if one exists
  4. `rm tests/plugins/tasks/migration.test.ts`
  5. Edit `plugins/tasks/lib/flow-store.ts` — delete `confirmed` field + the `|| state.confirmed` fallback
- **Verification:**
  ```bash
  grep -rn "2\.1\.0" plugins/tasks/              # only the plugin-version literal at index.ts:42
  grep -rn "confirmed" plugins/tasks/ src/       # no hits in production code
  bun x tsc --noEmit                             # exit 0
  bunx vitest run tests/plugins/tasks/           # green (minus migration.test.ts which is gone)
  ```
- **Commit message:** `chore(tasks): delete 2.1.0 position→order migration + confirmed fallback`

#### Commit 5 — S-4 + S-5: port imitation-crab seed to bun:sqlite

- **IDs:** S-4, S-5
- **Files:**
  - `dev/imitation-crab/seed.ts` — lines 77–88: replace `require('better-sqlite3')` with top-of-file `import { Database } from 'bun:sqlite'`; drop the try/catch fallback
  - `scripts/build-plugins.ts` — line 7: edit doc comment `better-sqlite3` → `bun:sqlite`
- **Pre-flight:** none
- **Actions:**
  1. Edit `dev/imitation-crab/seed.ts` — add `import { Database } from 'bun:sqlite'` at top; rewrite `seedDatabase()` to use it directly; drop the try/catch warning
  2. Edit `scripts/build-plugins.ts` line 7 comment
- **Verification:**
  ```bash
  grep better-sqlite3 dev/imitation-crab/seed.ts scripts/build-plugins.ts   # empty
  bun x tsc --noEmit                                                        # exit 0
  bun run mock:seed --force                                                 # runs clean
  ```
- **Commit message:** `chore(dev): port imitation-crab seed to bun:sqlite`

#### Commit 6 — D-1 + D-2 + D-3 + D-4: drop MCPlugin/MCConfig aliases

- **IDs:** D-1, D-2, D-3, D-4
- **Files:**
  - `packages/core/src/plugin-types.ts` — delete lines 689–691 (`MCPlugin`) + 725–727 (`MCConfig`)
  - `packages/core/src/index.ts` — remove `MCPlugin` + `MCConfig` from the re-export list (lines ~29, ~33)
  - `packages/sdk/src/types/index.ts` — remove `MCPlugin` + `MCConfig` from the re-export list (lines ~22, ~26)
  - `src/lib/plugin-types.ts` — remove `MCPlugin` + `MCConfig` from the re-export list (lines ~26, ~30)
- **Pre-flight:** none
- **Actions:** 4 edits (use `Edit` tool with `replace_all: false` per file, targeting the exact identifier lines)
- **Verification:**
  ```bash
  grep -rn "MCPlugin\|MCConfig" packages/ src/    # empty
  bun x tsc --noEmit                              # exit 0
  ```
- **Commit message:** `refactor(core): drop MCPlugin/MCConfig deprecated aliases`

#### Commit 7 — D-5 + D-6: drop legacy antfly.embedder field

- **IDs:** D-5, D-6
- **Files:** `packages/core/src/settings.ts` — lines 83–91 (type field), 295–307 (migration block in `getSettings()`)
- **Pre-flight:** Spec D-7 — already run 2026-04-23; `antfly.embedder` was `null`. No action needed.
- **Actions:**
  1. Delete the `embedder?:` field from the `BakinSettings.antfly` type
  2. Delete the `legacyEmbedder` migration block in `getSettings()`
- **Verification:**
  ```bash
  grep -n "antfly\.embedder\b\|embedder?:" packages/core/src/settings.ts    # empty
  grep -rn "antfly\.embedder\b" --include='*.ts' .                          # empty
  bun x tsc --noEmit                                                        # exit 0
  bunx vitest run tests/core/settings.test.ts 2>/dev/null                   # green (if exists)
  ```
- **Commit message:** `refactor(settings): drop legacy antfly.embedder field`

#### Commit 8 — D-11 + D-12: drop numeric FailureRecord legacy format

- **IDs:** D-11, D-12
- **Files:** `src/core/dispatch.ts` lines 42, 86–92
- **Pre-flight:** Spec D-13 — already run 2026-04-23; 8 numeric entries exist. **Runtime side-effect:** must `rm ~/.bakin/.dispatch-state.json` before this commit lands (file regenerates on next dispatch).
- **Actions:**
  1. **Shell:** `rm ~/.bakin/.dispatch-state.json`
  2. Edit `src/core/dispatch.ts` line 42 — narrow `failedDispatches: Record<string, FailureRecord | number>` → `Record<string, FailureRecord>`. Drop the `// number = legacy format` comment.
  3. Edit `src/core/dispatch.ts` lines 86–92 — `getFailureRecord(entry: FailureRecord | undefined)`. Remove the `typeof entry === 'number'` branch + "Migrate legacy format" comment.
- **Verification:**
  ```bash
  grep -n "number = legacy format\|typeof entry === 'number'" src/core/dispatch.ts   # empty
  bun x tsc --noEmit                                                                 # exit 0
  bunx vitest run tests/core/dispatch.test.ts                                        # green
  ```
- **Commit message:** `refactor(dispatch): drop legacy numeric FailureRecord format`

#### Commit 9 — D-14: drop src/lib/taskboard.ts re-export shim

- **IDs:** D-14
- **Files:**
  - `src/lib/taskboard.ts` — delete file
  - `src/core/agents.ts` line 10 — static import: `from '../lib/taskboard'` → `from '@bakin/tasks/lib/flow-store'`
  - `src/core/dispatch.ts` lines 142, 316, 872 — three dynamic `await import('../lib/taskboard')` → `await import('@bakin/tasks/lib/flow-store')`
  - `src/core/continuation.ts` line 21 — dynamic import, same rewrite
- **Pre-flight:** `grep -rn "lib/taskboard" --include='*.ts' --include='*.tsx' .` should return exactly the 5 lines above + the self-reference in `src/lib/taskboard.ts:3` (which we're deleting). **Verified 2026-04-23.**
- **Actions:**
  1. Edit `src/core/agents.ts` line 10
  2. Edit `src/core/dispatch.ts` lines 142, 316, 872 (three separate calls)
  3. Edit `src/core/continuation.ts` line 21
  4. `rm src/lib/taskboard.ts`
- **Verification:**
  ```bash
  grep -rn "lib/taskboard" src/ packages/                                            # empty
  test ! -f src/lib/taskboard.ts                                                     # no file
  bun x tsc --noEmit                                                                 # exit 0
  bunx vitest run tests/core/agents.test.ts tests/core/dispatch.test.ts              # green
  bunx vitest run tests/core/continuation.test.ts                                    # green
  ```
- **Commit message:** `refactor(taskboard): drop src/lib/taskboard.ts re-export shim`

### Phase 2 — Test Runner Migration

#### Commit 10 — T-1 + T-2 + T-3: introduce bunfig.toml + happy-dom setup

- **IDs:** T-1, T-2, T-3
- **Files:**
  - `bunfig.toml` (new) at repo root
  - `tests/setup.ts` — rewrite
- **Pre-flight:** `bun add -d @happy-dom/globalregistrator` first (not a commit; dep added in commit 13 anyway, but we need it on disk to write setup.ts). Note: this may run `bun install` and touch `bun.lock`; commit the lockfile change with commit 13.
- **Actions:**
  1. `bun add -d @happy-dom/globalregistrator`
  2. Create `bunfig.toml`:
     ```toml
     [test]
     preload = ["./tests/setup.ts"]

     [test.env]
     NODE_ENV = "test"
     ```
  3. Rewrite `tests/setup.ts`:
     ```typescript
     /**
      * Global bun:test setup.
      * Registers happy-dom so component tests have document/window,
      * and mocks the main-agent module at its canonical path.
      */
     import { GlobalRegistrator } from '@happy-dom/globalregistrator'
     import { mock } from 'bun:test'

     GlobalRegistrator.register()

     const mainAgentMock = {
       getMainAgentId: () => 'main',
       tryGetMainAgentId: () => 'main',
       getMainAgentName: () => 'Main',
     }

     mock.module('@bakin/core/main-agent', () => mainAgentMock)
     ```
     (T-3 dictates dropping the three relative-path duplicates; verify during commit 11 build — if any test fails due to resolve mismatch, re-add one relative-path mock.)
- **Verification:**
  ```bash
  # Dual-runner window: vitest is still the "canonical" runner per package.json scripts
  bunx vitest run tests/core/main-agent.test.ts                                      # green (setup.ts still vitest-compatible? NO — see next bullet)
  # The new setup.ts is bun:test-only. Vitest will error. That's fine for this
  # commit — the purpose here is to have bunfig.toml + setup.ts ready for commit 11.
  # Verification is that bun test *CAN* find the setup file:
  bun test --help                                                                    # bunfig recognised
  ```
  **Note:** at this commit, vitest is broken because setup.ts no longer imports `vi`. Commit 11 must follow immediately. If there's a concern, split: keep setup.ts dual-compatible by importing both `vi` and `mock` guarded by `typeof vi !== 'undefined'`. Recommending **no split** — commit 11 is the very next commit.
- **Commit message:** `chore(test): introduce bunfig.toml + happy-dom setup`

#### Commit 11 — T-4 + T-5 + T-6 + T-7 + T-8: mechanical vi.* → bun:test rewrite

- **IDs:** T-4, T-5, T-6, T-7, T-8
- **Files:** 227 test files importing from `vitest`; ~225 of which are actual `*.test.{ts,tsx}` specs
- **Pre-flight:** see §5 (rewrite table) below; validate the mechanical regex on 3 sample files before scripting the whole pass.
- **Actions:** apply the rewrite rules from §5 to every test file. Preferred tactic: a single Python/Bun script that reads each file, applies the regex substitutions in order, writes back. **No manual edits** — only scripted transforms, then `bun test` to verify.
- **Verification:**
  ```bash
  grep -rn "\bvi\." tests/                                                           # empty
  grep -rln "from ['\"]vitest['\"]" tests/                                           # empty (all migrated to bun:test)
  bun test                                                                           # all green
  bun x tsc --noEmit                                                                 # exit 0
  ```
- **Commit message:** `chore(test): migrate all test files from vi.* to bun:test`
- **Rollback:** `git revert <commit-11-sha>` restores vitest-era files. Commit 10 stays. Commits 12–13 haven't landed yet, so vitest is still on disk.

#### Commit 12 — T-9 + T-11 + T-12 + T-16: drop vitest + shims + switch scripts

- **IDs:** T-9, T-11, T-12, T-16, **(also evaluate T-10 here)**
- **Files:**
  - `tests/shims/bun-sqlite.ts` — delete
  - `vitest.config.ts` — delete
  - `package.json` scripts — replace vitest commands with `bun test`
  - `.github/workflows/ci-pr.yml` line 41, `.github/workflows/ci-main.yml` line 38 — replace `bunx vitest run` with `bun test`
  - `tests/shims/tanstack-router.ts` — **investigate**: run `bun test tests/components/` and see if the import resolves natively. If yes → delete. If no → keep, add a brief comment in the file explaining why bun needs it.
- **Pre-flight:**
  ```bash
  bun test tests/components/kanban-dnd.test.tsx     # smoke test — does @tanstack/react-router resolve?
  ```
- **Actions:**
  1. `rm tests/shims/bun-sqlite.ts`
  2. `rm vitest.config.ts`
  3. Edit `package.json`: `"test": "bun test"`, `"test:watch": "bun test --watch"`, `"test:components": "bun test tests/components"`, `"test:coverage": "bun test --coverage"`
  4. Edit `.github/workflows/ci-pr.yml` line 41 + `ci-main.yml` line 38
  5. T-10 decision: keep or delete `tests/shims/tanstack-router.ts` based on the smoke test above
- **Verification:**
  ```bash
  grep -rln "vitest" package.json .github/ tests/shims/       # empty (or tanstack shim if kept)
  bun test                                                    # all green
  bun run test                                                # same
  bun x tsc --noEmit                                          # exit 0
  ```
- **Commit message:** `chore(test): drop vitest + bun:sqlite shim + switch scripts to bun test`

#### Commit 13 — T-13 + T-14 + T-15: remove vitest + better-sqlite3 deps

- **IDs:** T-13, T-14, T-15
- **Files:** `package.json`, `bun.lock`
- **Pre-flight:** confirm no code still imports `better-sqlite3` or `vitest`:
  ```bash
  grep -rn "better-sqlite3" --include='*.ts' --include='*.tsx' --include='*.js' . | grep -v node_modules
  grep -rn "from ['\"]vitest['\"]" --include='*.ts' --include='*.tsx' . | grep -v node_modules
  ```
  Both should be empty.
- **Actions:**
  1. Edit `package.json`: remove `better-sqlite3`, `@types/better-sqlite3`, `vitest`, `@vitest/coverage-v8`; keep `@happy-dom/globalregistrator` (added in commit 10). Remove the entire `trustedDependencies` array.
  2. `bun install` — regenerates `bun.lock`
- **Verification:**
  ```bash
  grep -n "better-sqlite3\|vitest\|trustedDependencies" package.json   # empty
  bun test                                                             # green
  bun run build                                                        # compiles clean
  ```
- **Commit message:** `chore(deps): remove vitest + better-sqlite3 + trustedDependencies`

#### Commit 14 — T-17: lint adjustments (conditional)

- **IDs:** T-17
- **Files:** `eslint.config.mjs` (only if `bun run lint` fails after commit 13)
- **Pre-flight:** `bun run lint` — if green, skip this commit entirely
- **Actions:** adjust ignores/rules to match `bun:test`-only surface
- **Verification:** `bun run lint` exit 0
- **Commit message:** `chore(lint): update config for bun:test ruleset`

### Phase 3 — Docs + Archival Cleanup

#### Commit 15 — K-1 … K-13: refresh active docs

- **IDs:** K-1 through K-13
- **Files (13 docs, can be edited in parallel by sub-agents):**
  - `.claude/knowledge/search-system.md` (K-1, K-2, K-3)
  - `.claude/knowledge/tasks-plugin.md` (K-4, K-5)
  - `.claude/knowledge/repo-architecture.md` (K-6)
  - `.claude/knowledge/storage-model.md` (K-7)
  - `.claude/knowledge/dev-loop.md` (K-8)
  - `.claude/knowledge/memory-plugin.md`, `workflows-plugin.md`, `messaging-plugin.md`, `agent-system.md`, `assets-plugin.md`, `design-system.md`, `multimodal-search.md`, `plugin-system.md`, `search-api-reference.md`, `search-plugin-guide.md`, `shared-ui-patterns.md`, `team-plugin.md`, `url-state-deep-linking.md`, `workflow-approvals.md` (K-9 — sweep across the lot)
  - `README.md` (K-10 — verification only)
  - `CLAUDE.md` (K-11)
  - `docs/plugin-authoring.md` (K-12)
  - `dev/imitation-crab/README.md` (K-13)
- **Pre-flight:** K-7 needs a code check first — does `packages/core/src/content-dir.ts` still read `CONTENT_DIR`?
  ```bash
  grep -n "CONTENT_DIR" packages/core/src/content-dir.ts
  ```
  - If yes → drop the "legacy compat" label in storage-model.md but keep documenting the env var.
  - If no → remove the env var support from content-dir.ts AND the doc line. (This may add a small code change to the commit.)
- **Actions:** per §2.6 work items. Parallelizable — spawn one sub-agent per doc bucket (search-system, tasks-plugin, knowledge sweep, CLAUDE.md+README.md, etc.) for speed.
- **Verification:**
  ```bash
  grep -riI 'beacon\|better-sqlite3\|MCPlugin\|MCConfig\|antfly\.embedder\b' README.md CLAUDE.md .claude/knowledge/ docs/    # empty
  grep -riI 'vitest\|bunx vitest\|@vitest/coverage-v8' README.md CLAUDE.md CONTRIBUTING.md .claude/knowledge/ docs/            # empty
  ```
- **Commit message:** `docs(knowledge): refresh active docs for removed concepts`

#### Commit 16 — A-1 … A-17: delete merged-issue plan/todo pairs

- **IDs:** A-1 through A-17
- **Files (17 files in `.claude/tasks/`):**
  ```
  issue-73-plan.md, issue-73-todo.md
  issue-115-plan.md, issue-115-todo.md
  issue-118-plan.md, issue-118-todo.md
  issue-125-plan.md, issue-125-todo.md
  issue-129-plan.md, issue-129-todo.md
  issue-137-plan.md, issue-137-todo.md
  issue-147-plan.md, issue-147-todo.md, issue-147-test-triage.md
  plan.md, todo.md
  ```
- **Pre-flight:**
  ```bash
  # Confirm none are referenced by active knowledge docs / README / CLAUDE
  for f in issue-73 issue-115 issue-118 issue-125 issue-129 issue-137 issue-147; do
    grep -rln "\.claude/tasks/$f" .claude/knowledge/ README.md CLAUDE.md docs/ 2>/dev/null
  done
  grep -rln "\.claude/tasks/plan\.md\|\.claude/tasks/todo\.md" .claude/knowledge/ README.md CLAUDE.md docs/ 2>/dev/null
  ```
  Already verified 2026-04-23: empty. If anything appears, fix references in the same commit.
- **Actions:** `rm` the 17 files listed above
- **Verification:**
  ```bash
  ls .claude/tasks/ | grep -E "^issue-|^plan\.md$|^todo\.md$"   # only cleanup-plan.md + cleanup-todo.md survive
  ```
- **Commit message:** `chore(docs): delete merged-issue plan/todo pairs`

#### Commit 17 — A-18 … A-26: delete specs/done/ archive

- **IDs:** A-18 through A-26
- **Files:** everything under `.claude/specs/done/`
- **Pre-flight:**
  ```bash
  grep -rln "specs/done/" .claude/knowledge/ README.md CLAUDE.md docs/    # empty (verified 2026-04-23)
  ```
- **Actions:** `rm -rf .claude/specs/done/`
- **Verification:**
  ```bash
  test ! -d .claude/specs/done/
  ```
- **Commit message:** `chore(docs): delete specs/done/ archive`

#### Commit 18 — A-27 … A-43: delete top-level specs for shipped features

- **IDs:** A-27 through A-43
- **Files (all in `.claude/specs/`):**
  ```
  bun-migration.md
  plugin-client-ui-loader.md
  hmr-dev-loop.md, hmr-dev-loop-PLAN.md
  issue-114-watchdog-dispatch-race.md, issue-114-watchdog-dispatch-race-PLAN.md
  issue-115-dispatch-retry.md
  issue-125-notification-channels-registry.md
  issue-129-models-loading-ux-and-catalog.md
  issue-137-health-checks-registry.md
  issue-67-search-client-abstraction.md, issue-67-search-client-abstraction-PLAN.md
  issue-73-watcher-unlink-hook.md
  issue-90-team-main-agent-canonical.md
  issue-91-discord-approvals.md, issue-91-discord-approvals-PLAN.md
  memory-plugin-rebuild.md, memory-plugin-rebuild-PLAN.md
  health-plugin-overhaul.md
  messaging-refactor.md
  asset-storage-architecture.md, asset-storage-architecture-PLAN.md
  assets-retype-inline-edit.md
  first-run-onboarding.md
  human-readable-activity-feed.md
  reindex-enrichment-observability.md
  workflows-phase-2-plan.md, workflows-phase-2-plugin-nodes-and-canvas.md
  workflows-plugin-architecture.md, workflows-plugin-plan.md
  tasks-kanban-board.md, tasks-ordering-v2.md
  agent-avatars.md, agent-lifecycle-tools.md
  antfly-graph-indexes.md, antfly-search-system.md
  10-calendar-planning-overhaul.md, 07-workflow-editor.md, 07-cli-lifecycle.md, 09-openclaw-mock.md
  03-design-system.md, 05-audit-memory.md, 06-adapter-fresh-install.md, multimodal-search.md
  ```
  Total: ~40 files. After this commit, `.claude/specs/` should be **empty** (directory kept if not otherwise unused; safe to `rmdir` if so).
- **Pre-flight:**
  ```bash
  grep -rln "\.claude/specs/[a-zA-Z0-9_-]*\.md" .claude/knowledge/ README.md CLAUDE.md docs/ 2>/dev/null
  ```
  Already verified 2026-04-23: empty.
- **Actions:** `rm` each file (script to iterate through the list); `rmdir .claude/specs/` if empty
- **Verification:**
  ```bash
  ls .claude/specs/ 2>/dev/null         # empty or dir gone
  ```
- **Commit message:** `chore(docs): delete top-level specs for shipped features`

#### Commit 19 — T-18: update README/CLAUDE/CONTRIBUTING for bun test

- **IDs:** T-18
- **Files:** `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- **Pre-flight:** none
- **Actions:** search + replace:
  - `bunx vitest run` → `bun test`
  - `bunx vitest watch` → `bun test --watch`
  - `bunx vitest` → `bun test`
  - Any mention of `vitest.config.ts` → either drop or reference `bunfig.toml`
  - CLAUDE.md "Testing Rules — CRITICAL" section: keep all rules; only change the runner-reference lines
- **Verification:**
  ```bash
  grep -n 'vitest\|bunx vitest' README.md CLAUDE.md CONTRIBUTING.md    # empty
  bun x tsc --noEmit                                                   # exit 0 (sanity)
  ```
- **Commit message:** `docs: update README/CLAUDE/CONTRIBUTING for bun test runner`

### Phase 4 — Runtime + Memory Cleanup

#### Commit 20 — R-1 + R-2: runtime beacon cleanup

- **IDs:** R-1, R-2
- **Files:** this is **non-repo** runtime data — no commit changes, but we tag the action for traceability with an `--allow-empty` commit.
- **Pre-flight:** none
- **Actions (shell, not code):**
  ```bash
  rm -f ~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md
  find ~/.openclaw/workspace -maxdepth 4 -type d -iname beacon -exec rm -rf {} +
  find ~/.openclaw/skills -maxdepth 2 -type d -iname beacon -exec rm -rf {} +
  ```
- **Verification:**
  ```bash
  ls ~/.bakin/docs/ 2>/dev/null   # no BEACON-MCP-MIGRATION-PLAN.md
  find ~/.openclaw -iname beacon 2>/dev/null   # empty
  ```
- **Commit:** **no commit.** Runtime-only action. Document in PR body instead.

#### Commit 21 — M-1 … M-6: scrub beacon references in user-memory

- **IDs:** M-1 through M-6
- **Files:** `~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/*.md`
- **Pre-flight:** none
- **Actions (file edits, not a git commit — these files are outside the repo):**
  1. **M-2:** `rm project_beacon_skill_rename.md`
  2. **M-3:** replace all `~/.beacon/` with `~/.bakin/` in `project_content_migration.md`; update frontmatter `description` to drop the beacon reference
  3. **M-4:** replace `~/.beacon/` with `~/.bakin/` in `project_assets_plugin.md`
  4. **M-5:** replace `beacon_exec_` with `bakin_exec_` in `project_scripts_architecture.md`
  5. **M-6:** rewrite `feedback_globalthis_sse.md` rationale: "Module-level SSE state must use globalThis-backed storage because Bun's dev HMR re-evaluates modules" (was "Next.js webpack")
  6. **M-1:** update `MEMORY.md` index — drop the `project_beacon_skill_rename.md` entry, update descriptions that mention beacon
- **Verification:**
  ```bash
  grep -rilI beacon ~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/    # empty
  test ! -f ~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/project_beacon_skill_rename.md
  ```
- **Commit:** **no commit.** User-memory is outside the repo. Document in PR body.

---

## 5. Mechanical Rewrite Table for Commit 11

The 213-ish-file mechanical pass. Rules apply top-to-bottom per file; later rules assume earlier rules have already fired.

### 5.1 Import rewrite

**Current** (every test file):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// or some subset
```

**Target:**
```typescript
import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
```

Rule:
1. Replace `'vitest'` with `'bun:test'` in any `import ... from 'vitest'`.
2. In the import list, replace `vi` with `mock, spyOn` (if both are used) or just `mock` / just `spyOn` (if only one is used). If `vi` is the only identifier imported and not used directly as `vi.xxx`, just drop it.
3. If the file uses `vi.stubGlobal` / `vi.unstubAllGlobals`, add import of nothing (these become manual `globalThis` assigns in §5.3).

### 5.2 Direct vi.* renames (mechanical)

| vitest | bun:test | notes |
|---|---|---|
| `vi.mock(path, factory)` | `mock.module(path, factory)` | 204 files. Hoisted by bun loader. Factory preserved verbatim. |
| `vi.fn()` | `mock()` | 182 files. `mock()` from bun:test returns a Jest-compatible mock fn. |
| `vi.fn(impl)` | `mock(impl)` | as above with initial impl |
| `vi.spyOn(obj, key)` | `spyOn(obj, key)` | 13 files |
| `vi.mocked(x)` | `x as Mock<typeof x>` (type cast) | 22 files. Add `import type { Mock } from 'bun:test'` if needed. |
| `vi.clearAllMocks()` | `mock.clearAll()` | 29 files. Bun alias. |
| `vi.restoreAllMocks()` | `mock.restore()` | 15 files. Note: bun's `mock.restore()` restores spies + mocks. |
| `vi.useFakeTimers()` | `mock.module('node:timers', …)` pattern — **each file needs individual review** | 8 files. See §5.4. |
| `vi.useRealTimers()` | paired with useFakeTimers cleanup | same files |
| `vi.setSystemTime(d)` | `setSystemTime(d)` from bun:test | 1 file (`tests/core/audit.test.ts`) — simple import + call-site rewrite |
| `vi.advanceTimersByTime(n)` | see §5.4 | 5 files |
| `vi.advanceTimersByTimeAsync(n)` | see §5.4 | included in the 8 fake-timer files |
| `vi.runAllTimersAsync()` | see §5.4 | 4 files |
| `vi.waitFor(fn)` | `@testing-library`'s `waitFor` (component tests) or hand-rolled polling helper | 3 files |
| `vi.importActual(path)` | `(await import(path))` — drop the vi wrapping | 16 files |
| `vi.hoisted(fn)` | `const X = (() => fn())()` at module top, or move factory inline inside `mock.module(..., () => …)` | 37 files — needs per-file review (some are trivial, some guard against circular-init) |
| `vi.doMock(path, factory)` | `mock.module(path, factory)` + explicit placement inside `beforeAll` or the test body as needed | 3 files |
| `vi.unmock(path)` | `mock.module(path, () => import(path))` — restores real module | 1 file (`tests/core/main-agent.test.ts`) |
| `vi.resetModules()` | `mock.restore()` or re-declare per-scope mocks | 21 files — needs per-file review |
| `vi.stubGlobal(key, val)` | `const orig = globalThis[key]; globalThis[key] = val` + `afterEach(() => globalThis[key] = orig)` | 11 files (pattern below) |
| `vi.unstubAllGlobals()` | reset globals in `afterEach` per above | 7 files |

### 5.3 stubGlobal pattern (for the 11 files)

Before:
```typescript
import { vi, afterEach } from 'vitest'
beforeEach(() => { vi.stubGlobal('fetch', mockFetch) })
afterEach(() => { vi.unstubAllGlobals() })
```

After:
```typescript
import { afterEach, beforeEach } from 'bun:test'
const _originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mockFetch })
afterEach(() => { globalThis.fetch = _originalFetch })
```

### 5.4 Fake-timer pattern (for the 8 files)

bun:test does NOT have `useFakeTimers()`. Options:
- **Preferred:** `setSystemTime(date)` for Date-only control. Works in bun:test.
- **For setTimeout/setInterval control:** mock the timer functions explicitly:
  ```typescript
  const timers: Array<() => void> = []
  mock.module('node:timers', () => ({
    setTimeout: (fn: () => void) => { timers.push(fn); return 0 },
    clearTimeout: () => {},
    setInterval: (fn: () => void) => { timers.push(fn); return 0 },
    clearInterval: () => {},
  }))
  function advance() { const fns = timers.splice(0); fns.forEach(fn => fn()) }
  ```
- **Per-file strategy:** audit each of the 8 `vi.useFakeTimers` files during commit 11 and pick the appropriate pattern. Files:
  - `tests/core/continuation.test.ts`
  - `tests/core/dispatch.test.ts`
  - `tests/core/audit.test.ts`
  - `tests/core/messaging-cron.test.ts`
  - `tests/core/lifecycle.test.ts`
  - `tests/core/watchdog.test.ts`
  - `tests/core/openclaw-client.test.ts`
  - `tests/hooks/use-search.test.ts`

### 5.5 resetModules pattern (for the 21 files)

`vi.resetModules()` is typically used to re-import a module with fresh state between tests. In bun:test, each `mock.module()` call overlays the module; re-mocking replaces the overlay. Strategy:
- If the test uses `resetModules()` to change mock behavior between `it` blocks → call `mock.module()` again inside each `it` block.
- If the test uses it to "clear imports" → bun's `mock.restore()` approximates this but doesn't truly re-evaluate top-level side effects. Tests that rely on re-running module-top effects will need refactoring (usually a small rework).
- Per-file review during commit 11. Files: see grep output above.

### 5.6 Execution plan for commit 11

1. Write `scripts/migrate-vi-to-bun.ts` — a Bun script that:
   - Reads every `tests/**/*.test.{ts,tsx}` + `tests/setup.ts`
   - Applies rules 5.1 + 5.2 (pure text replacements) in order
   - Flags files matching patterns in 5.3, 5.4, 5.5 as "needs manual pass"
   - Writes per-file log to `.cleanup-migration-log.txt`
2. Run the script. Expect ~150 files fully mechanical, ~60 files flagged for manual pass.
3. Handle the flagged files one-by-one (per §5.3, 5.4, 5.5 patterns).
4. `bun test` repeatedly until green. If a file fails, diagnose and fix individually.
5. Delete `scripts/migrate-vi-to-bun.ts` (one-shot tool).
6. `git add -A && git commit -m "chore(test): migrate all test files from vi.* to bun:test"`.

**Expected duration for commit 11 alone:** 2–3 hours for the scripted pass + manual review.

---

## 6. Rollback Plan Per Phase

| Phase | Rollback granularity | Notes |
|---|---|---|
| Phase 1 (commits 1–9) | Per-commit `git revert`. | Each commit touches an independent file set. Reverting commit N leaves commits 1…N-1 intact and stable. |
| Phase 2 (commits 10–14) | Revert the whole phase as a unit. | Commits 10 and 11 are tightly coupled (setup.ts depends on bun:test syntax). Reverting commit 11 alone would leave setup.ts broken. Revert strategy: `git revert <14> <13> <12> <11> <10>`. Then run `bun install` to restore vitest. |
| Phase 3 (commits 15–19) | Per-commit revert. | Pure docs. Safe to selectively undo. |
| Phase 4 (runtime + memory) | Manual restore from `git log @{1.hour.ago}` if accidentally deleted a needed file. | Nothing is committed in Phase 4; rollback = restore the files by hand. |

**Branch-level rollback:** the entire cleanup is on `chore/tech-debt-cleanup`. Worst case: `git checkout main && git branch -D chore/tech-debt-cleanup`.

---

## 7. Phase-Level Effort Estimates

| Phase | Commits | Estimated effort | Parallelism benefit |
|---|---|---|---|
| 1 | 1–9 (9 commits) | 45–75 min | Moderate — prepare changesets in parallel, commit serially |
| 2 | 10–14 (up to 5 commits) | 2.5–4 h | Low — strict ordering; commit 11 is the bulk |
| 3 | 15–19 (5 commits) | 30–60 min | High — 13 knowledge docs + 3 archival deletes all in parallel |
| 4 | 20, 21 (non-git) | 10 min | High — parallel file edits |
| **Total** | **21** | **~4–6 h** | |

---

## 8. Phase 2 Dual-Runner Verification Strategy

Phase 2's commits 10 and 11 are the risk point. Strategy to minimize blast radius:

1. **Commit 10 lands first.** `bunfig.toml` + new `tests/setup.ts`. At this commit vitest is BROKEN (setup.ts no longer imports `vi`). The gap window is single-commit: commit 11 lands next.
2. **Before running the commit-11 mechanical script,** dry-run on 3 files representative of the matrix:
   - `tests/core/main-agent.test.ts` (uses `vi.mock`, `vi.hoisted`, `vi.unmock`, `vi.resetModules`)
   - `tests/components/kanban-dnd.test.tsx` (component test, uses `vi.stubGlobal`, `vi.hoisted`, `vi.importActual`)
   - `tests/core/dispatch.test.ts` (uses `vi.useFakeTimers`, `vi.advanceTimersByTime`)
   Run `bun test <file>` on each converted file. All three must pass before scripting the full pass.
3. **Script runs.** Logs per-file outcome.
4. **`bun test` full run.** Any failure → diagnose + fix that file individually, re-run. Iterate until green.
5. **Only then commit 11.** The commit lands ~225 file changes + the migration script + the log file.
6. **Commit 12** removes the script and the log: `git rm scripts/migrate-vi-to-bun.ts .cleanup-migration-log.txt` if they were committed. (Recommend: **don't commit** the migration script — keep it in working tree, delete after success, exclude via `.gitignore` if needed.)

**Alternative Phase 2 approach (safer, not recommended):** keep `tests/setup.ts` dual-compatible by branching on `typeof vi !== 'undefined'`. Allows vitest to keep working through commit 11. Downside: adds `vi`-style glue code we immediately delete in commit 12. Not worth it for a 15-minute gap.

---

## 9. Verification Gate (PR description content)

After all commits land, run the full acceptance suite from SPEC.md §4. Paste results into the PR body under a `## Verification` heading:

```bash
# §4 item 1
grep -riI 'beacon\|Beacon' --include='*.ts' --include='*.tsx' --include='*.json' \
  --include='*.md' --include='*.yaml' --include='*.yml' --include='*.sh' .
# expected: empty

# §4 item 2
grep -r better-sqlite3 . --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md'
# expected: empty

# §4 item 3
grep -rn "@deprecated" packages/core/src/ packages/sdk/src/ plugins/ src/
# expected: empty

# §4 item 5
grep -rn "\bvi\." tests/
# expected: empty

# §4 item 6
grep -rln "from ['\"]vitest['\"]" .
# expected: empty

# §4 item 7
bun x tsc --noEmit
# expected: exit 0

# §4 item 8
bun run lint
# expected: exit 0

# §4 item 9
bun test
# expected: all green

# §4 item 10
bun test --coverage
# expected: coverage artifacts emitted

# §4 item 11
bun run build
dist/bakin-darwin-arm64 start &
sleep 2
curl -sSf http://localhost:3737/api/version
kill %1

# §4 item 12
test ! -f ~/.bakin/docs/BEACON-MCP-MIGRATION-PLAN.md
find ~/.openclaw -iname beacon 2>/dev/null
# expected: empty

# §4 item 13
grep -rilI beacon ~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/
test ! -f ~/.claude/projects/-Users-main-operator-go-src-github-com-markhayden-bakin/memory/project_beacon_skill_rename.md
# expected: empty / no file

# §4 item 14
test ! -d .claude/specs/done/
# expected: pass

# §4 item 15
ls .claude/tasks/ | grep -E "^issue-|^plan\.md$|^todo\.md$"
# expected: empty
```

Each item gets a ✅/❌ next to it in the PR description.

---

## 10. Open Risks to Monitor During Build

1. **Commit 11 mechanical rewrite edge cases.** Some `vi.hoisted` + `vi.resetModules` + `vi.doMock` combinations may not convert mechanically and require real per-file reasoning. Budget for ~60 minutes of manual fix-up time after the scripted pass.
2. **happy-dom RTL gotchas.** One of the 7 component tests might hit a DOM behavior mismatch. Fallback: swap setup.ts to `jsdom` via `GlobalRegistrator.register()` from `@jsdom/globalregistrator` (add the dep if needed). The component test files themselves don't need to change — only the DOM registrator.
3. **`bun test --coverage` output format differs from `@vitest/coverage-v8`.** If any CI/dashboard consumes coverage artifacts, verify the new format is compatible. CI workflows currently don't consume coverage output, so this is low-risk.
4. **`bunfig.toml` env-merge interaction with NODE_ENV.** If any test relied on vitest's default `NODE_ENV=test`, the bunfig `[test.env] NODE_ENV = "test"` should cover it. Watch for tests that check `process.env.NODE_ENV`.
5. **Dynamic imports in `src/core/dispatch.ts`** (commit 9). These are at runtime paths, not module-top. `tsc --noEmit` won't catch a string-literal typo in an `await import()`. Manual verification: run the dispatch pathway via `bakin dispatch` after commit 9.

---

## 11. What Triggers a Stop

The build agent halts and reports back if:

- `bun x tsc --noEmit` fails after any commit and the failure isn't a clear follow-up to that commit's intended change.
- `bun test` loses more than 3 test files vs. baseline (pre-migration count) without explicit deletion intent.
- A pre-flight check (D-7, D-9, D-13 — all already done) unexpectedly fails on re-run.
- `bun run build` fails after any commit past #5.
- `bakin doctor` starts throwing new errors attributable to this pass.

On stop: revert the last commit, report the specific failure mode, ask for direction. Do NOT attempt a second commit on top of broken state.

---

## 12. Handoff to `/agent-skills:build`

After this plan is approved, `/agent-skills:build` will execute commits 1–21 in the order above, respecting the parallelism map in §3 and the rewrite rules in §5.

**Exit criteria for the build phase:**
- All 21 git commits landed on `chore/tech-debt-cleanup`.
- Verification suite (§9) all ✅.
- PR opened with verification log inlined in the body.
- Runtime cleanup R-1/R-2 performed.
- User-memory edits M-1…M-6 performed.

Then `/agent-skills:test` runs coverage audit: any untested changes get new tests, or the gap is flagged for follow-up.
