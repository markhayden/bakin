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
  - ☐ Pure module #2/#3: prompts (entangled — buildCorrectiveSection needs SessionDeathState; sharedExecutionToolDocs
    is shared with the workflow builder) and board reads. Doable after the state types are extracted.
  - ☐ **DANGEROUS modules (dedicated effort, heavy rig dispatch-E2E):** state.ts (the stateQueue mutex),
    turns.ts (inFlightTurns/pendingLadderRedispatches/fireDispatchTurn), session-death.ts (the cycle),
    cycle.ts (dispatching/timer + dispatchTasks fire loop), single.ts (dispatchSingleTask). Plus the
    behavior-touching dedup (prepareAndFireRegularDispatch) — separate from the relocation.
- plugin-registry.split — ☐ (high-value sub-item: extract the hook-registry-singleton — breaks a live
  import cycle; the APPENDIX's "highest-value seam")   server.split — ☐   upgrade.split (remaining) — ☐   runtime.split — ☐
