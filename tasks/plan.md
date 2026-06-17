# Plan: WS5 — refactor/core-splits

Spec: `.claude/specs/audit-2026-06/REPORT.md` + `APPENDIX-cohesion.md`. Branch: `refactor/core-splits`
off `main`. The big core/server/adapter files. One revertable commit per finding/file; every commit
green on `bun run test` + `bun run typecheck` + (for anything in the binary graph) `bun run build`.

## Items (REPORT §WS5)

- **search-registry.ts** (1,134 → 4 modules) + **fix the pluginTables 1:1 wrong-table bug**.
- `dispatch.ts` (2,079 → 11; dedupe dispatchTasks/dispatchSingleTask; singleton placement is the risk).
- `src/lib/plugin-registry.ts` (1,608 → 7; unify dup topo-sorts + activation pipelines; move out of src/lib).
- `server.ts` (837 → declarative route table + boot/recovery modules; dead dispatch-state write already
  removed in the incidental-bugs PR #505).
- `src/core/plugins/upgrade.ts` (926 → 6; delete dead checkUpgradeAvailable; consolidate two dir hashers).
- `packages/adapter-openclaw/src/runtime.ts` (3,069 → 13 capability factories; dedupe deepMerge).

## Sequencing decision

The pluginTables fix is the highest-value correctness item and is **fully unit-testable** (it's purely
about which table name reaches the adapter — a mock adapter verifies routing; Antfly behavior is
irrelevant). So it's done FIRST as a focused, behavior-isolated change, ahead of the mechanical 4-module
split (which is pure relocation and lands next, no behavior change).

The big splits (dispatch singleton, plugin-registry, runtime) are fragile and several want the dockerized
rig to E2E-verify behavior — they're sequenced after the search work and may be split into focused PRs
(mirroring WS4's part-1/part-2 cadence).

## Incidental correctness bug #3 (workflow start-validation) — ☑

The REST `POST /instances/start` path used a weak `validateWorkflowForStart` that only validated the
top-level definition — no nested-workflow recursion or cycle detection — while the hook + exec-tool
paths used a strong recursive validator. So a cyclic/invalid nested workflow could be started via REST.
Upgraded the module-level validator to the strong recursive form (per-def validation + path-tracking
cycle detection) while keeping its explicit assignee-param check (a true superset). Regression test:
REST start with a mutually-nested cycle → 400 "cycle detected". (The local strong copy remains a
pre-existing duplicate — WS6 workflows-split dedup territory; noted there.)

## Status

- **search.fix — ☑ pluginTables wrong-table bug.** Team registers a direct primary (`agents`, indexed
  via `ctx.search.index`) + a file-backed secondary (`agent-lessons`); last-write-wins routed agent docs
  into the lessons table and made `getTableForPlugin('team')` throw (breaking team's `/search` + MCP).
  Fix: a "primary table" model — `registerContentType` records the primary (one direct per plugin,
  enforced; a second throws early), file-backed types register as **secondary** and index/remove/reconcile
  into their **own** table directly (not the primary resolver); `getTableForPlugin` returns the primary
  (no longer throws). No public SearchAPI/SDK type change (internal `registerContentTypeInternal`). Regression
  test added (direct→primary + file-backed→own-table). Chosen over the audit's handle-API option because it
  fixes the real cases with zero API/two-tier churn; the only residual (a hypothetical plugin with two
  DIRECT content types) now errors early instead of silently misrouting.
  - **OPERATIONAL (for Mark):** existing instances have stale agent docs already written to
    `bakin_agent-lessons` (and missing from `bakin_agent`). After deploying, run a one-time
    `bakin reindex` (re-runs generators into the correct tables) and purge the mis-routed rows from
    `bakin_agent-lessons`. The code fix prevents recurrence; it can't retro-move already-written rows.
- search.split — ☑ search-registry.ts (1,154) → 16-line barrel + 4 modules (search-registry-core 444 /
  search-plugin-api 413 / search-reindex 268 / search-query 102). Barrel strategy = every consumer
  import, all 11 test files (incl. the 7 that mock.module the path), and server.ts dynamic-imports
  unchanged; feature modules import core only (no cycle); logger allowlist extended. Verified: 149/0
  across the 11 search test files, full binary build, and an isolated-home boot smoke against real
  Antfly (tables register, team /search resolves the primary table with no throw). The smaller cleanups
  (transform() $inc/$push narrow, pendingReconciles swap idiom, crossTableSearch recursion, getSearchAdapter
  export) remain as follow-ups inside the now-smaller modules.
- upgrade.cleanup — ☑ deleted dead `checkUpgradeAvailable` (zero callers; superseded by `runChecks`;
  stale doc claimed `--check` used it). **Hasher consolidation DEFERRED (behavior-sensitive):** the
  "two directory hashers" — `computeSourceTreeSha` (upgrade.ts: skips node_modules/dist/.git, hashes
  concatenated rel+bytes) and `hashSourceTree` (whiskit/source-hash.ts: skips NON_RUNTIME_DIRS+dotfiles,
  hashes joined rel+filehash lines) — have DIFFERENT skip-sets and formulas, so they produce different
  hashes. Consolidating changes output for one caller and invalidates stored sourceTreeSha values
  (spurious "source changed" on existing installs); needs a deliberate canonical-pick + one-time reset,
  best done with the full upgrade.ts split + a migration step.
- dispatch.split — ◧ **split by RISK, not all at once** (dispatch is the audit's most dangerous file:
  6 module-level singletons where a misplaced one silently breaks the .dispatch-state.json mutex →
  duplicate fires; an import cycle (handleSessionDeath ⇄ dispatchSingleTask) needing DI surgery; a
  cross-package ledger contract on the state file).
  - ☑ Pure module #1: `dispatch-failures.ts` (error classification over RuntimeError/RuntimeTurnError —
    zero state, zero fire-path). dispatch.ts 2,240 → 2,096, re-exports the public classify* surface so
    `@/core/dispatch` consumers + the test are unchanged. typecheck/lint/61-dispatch-tests/full-suite/binary green.
  - ☑ Phase A safe modules: `dispatch-types.ts` (14 shared types — the leaf that unblocks the rest),
    `dispatch-prompts.ts` (pure builders), `dispatch-board.ts` (reads + task-store wrappers),
    `dispatch-context-blocks.ts` (lessonBlockCache sole owner + lesson/asset blocks). dispatch.ts
    2,096 → 1,652; re-exports the public surface so consumers + the 3 mock-the-path tests are unchanged;
    no cycles (modules → dispatch-types only). typecheck/lint/96-tests/full-suite/binary + boot-smoke
    (Dispatch started clean) green. Fire-path/singleton/cycle core untouched.
  - ☑ Phase B fire-core: `dispatch-state.ts` (sole `stateQueue` mutex owner), `dispatch-turns.ts`
    (inFlightTurns/pendingLadderRedispatches/fireDispatchTurn/concurrencyGate/budget), `dispatch-session-death.ts`
    (the recovery ladder; re-dispatches via a LAZY `import('./dispatch-single')` — no barrel-wiring footgun),
    `dispatch-cycle.ts` (dispatching/timer + dispatchTasks), `dispatch-single.ts`, `dispatch-workflow.ts`.
    dispatch.ts → 29-line barrel. Single mutex confirmed (stateQueue only in dispatch-state); each singleton
    in one module; turns↔session-death is a runtime-only cycle. typecheck/lint/full-suite 5106/0/binary +
    docker create-task smoke (fire-core runs, no wiring crash). **LIVE exactly-once gate:** the bare-metal
    OpenClaw stress plan in `tasks/dispatch-phase-b-handoff.md` (burst concurrency / session-death ladder /
    restart recovery / soak, all checked for exactly-once via ledger+audit) is the authoritative sign-off.
  - ☐ **Behavior-touching dedup (separate):** `prepareAndFireRegularDispatch` (the ~120-line
    dispatchTasks/dispatchSingleTask copy-paste) + the `saveDispatchState` atomic-write — own commit,
    re-run the full live hammer after.
- plugin-registry.split — ☐ (high-value sub-item: extract the hook-registry-singleton — breaks a live
  import cycle; the APPENDIX's "highest-value seam")   server.split — ☐   upgrade.split (remaining) — ☐   runtime.split — ☐
