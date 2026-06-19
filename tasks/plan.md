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
  - ☑ Behavior-touching dedup: `prepareRegularDispatch` (the dispatchTasks/dispatchSingleTask
    copy-paste) — done by Mark (#516), live-verified. dispatch.ts split is now COMPLETE end-to-end
    (Phase A #513 + Phase B fire-core #514 + dedup #516).
- plugin-registry.split — ◧ **split by RISK** (boot-critical; the hook-registry-singleton seam was already
  done — WS2/#499). Barrel-preserving: `src/lib/plugin-registry.ts` stays the public module (55 importers +
  ~40 test `mock.module` overlays target that path), pulling extracted helpers from siblings.
  - ☑ Phase A: extracted `plugin-registry-types.ts` (PluginState/FailureState/LoadEntry/CorePluginRegistration),
    `plugin-console-capture.ts` (withCapturedPluginConsole + createPluginScopedLogger), `plugin-activation-audit.ts`
    (logPluginActivation), and **unified the two duplicate topo-sorts** into `plugin-topo-sort.ts` — one Kahn's
    impl parameterized by `{source, failOnMissingDep, logCycle}` (the only 3 ways the core/user copies differed);
    always-filter is a no-op for the user pass (cycle entries already excluded), preserving its behavior exactly.
    plugin-registry.ts 1,512 → ~1,000. Public surface unchanged (re-exports CorePluginRegistration). Verified:
    typecheck/lint/registry-test 52-0/full-suite 5115-0/binary build + isolated-home boot smoke (9 plugins activate
    in correct topo order through the refactored loadPlugin→buildContext path; the 1 failure is schedule's
    openclaw-cron ENOENT, environmental). New direct unit test for the unified sort (6-0).
  - ☐ Phase B (DEFERRED, behavior-touching): unify the two activation pipelines (`loadPlugin` /
    `activateUserPluginEntry` share a ~60-line tail but diverge on import mechanism, console-capture wrapping,
    migrations, core/user id bookkeeping, and logPluginActivation ordering — merging normalizes boot-path
    ordering, so it gets its own commit + boot smoke, mirroring the dispatch dedup cadence). Plus the physical
    **move out of src/lib** (churns 55 importers + 40 mock paths — mechanical, separate).
- server.split — ☐ (router-table + boot.ts; search-startup/recovery already extracted; HOLD until the dispatch
  live-test passes — it stresses the same boot/router surface)   runtime.split — ☐ (adapter, 3,188 lines)

## WS7 — tooling

- docs-generate.split — ◧ IN PROGRESS: `scripts/docs/generate.ts` (2,585) → ~12 lib/ modules + a thin
  invocation-only entry; delete the dead legacy OpenAPI generator (~215 lines). Pure relocation, byte-for-byte
  output preserved (gate: `docs:check` + the post-`docs:generate` diff is date-stamp-only). Escaper-consolidation
  / plugin-list-derivation / CLI-metadata redesigns DEFERRED (output-risk).
- externals + CORE_PLUGINS consolidation — ☑ New `src/lib/core-plugin-ids.ts` is the single canonical
  core-plugin id list; `scripts/build-plugins.ts` + `scripts/dev.ts` import it (the two hand-maintained,
  differently-ordered copies — the source of the dropped-`images` class of bug — are gone). `scripts/dev.ts`
  + `packages/host/build.ts` now import `PLUGIN_CLIENT_EXTERNALS` instead of inlining byte-identical externals
  arrays. A pure-scanner architecture test (`tests/architecture/core-plugin-ids.test.ts`) pins the canonical
  list to BOTH the on-disk `plugins/` dirs AND the `CORE_PLUGIN_IMPORTS` embed-map keys, so the single source
  can't silently drift from the real set. Verified: typecheck/lint/new-test green + full `build-plugins.ts`
  (10 plugins) + host `build.ts` smoke.
- Remaining WS7: shared dir-walker.

## WS6 — plugin god-files

- team/index — ☑ **DONE** (2,312 → 693, a 70% reduction across 5 lib modules over 3 PRs).
  - ☑ Phase A (#520): `lib/runtime-agents.ts` (~270-line runtime-adapter agent wrapper layer, every fn takes
    the adapter explicitly) + `lib/agent-lessons.ts` (agent-package lesson path-parse + fs-read helpers for the
    `bakin_agent-lessons` content type). index 2,312 → 1,914.
  - ☑ Phase B-helpers: `lib/team-settings.ts` (display/teams settings I/O + reportsTo normalize/degrade +
    mergeDisplayDefaults — the most route-referenced group: readTeams ×13, readDisplaySettings ×8) and
    `lib/agent-status.ts` (status resolution + org structure; `staleSettingsCtx` is now a `setStaleSettingsContext`
    setter called from activate). index 1,914 → 1,685. Both are pure/param/store-backed — no plugin-registry
    coupling. Verified: typecheck/lint/team suite 183-0/full-suite/binary build/boot smoke.
  - ☑ Phase B-routes: extracted the ~970-line `populateTeamRoutes` into `lib/team-routes.ts`. Single injected
    dep (`indexAgentStatic`) — the routes' only residual module-scope coupling; `pluginCtx`/`batchIndexAgents`
    turned out to be activate-only, not route-used. index 1,685 → 693. Verified: typecheck/lint/team suite
    183-0/full-suite/binary build/boot smoke (GET /api/plugins/team/ + /teams return 200 through the moved
    handlers). index.ts is now just activate()/onReady/onShutdown + the search-indexing wiring + exec tools.
- tasks/index — ◧ **routes extracted** (1,089 → 539). `lib/routes.ts` (the full declarative route array),
  `lib/task-schemas.ts` (COLUMNS + zod schemas), `lib/edit-guard.ts` (taskEditGuard/guardResponse, optimistic
  versioning + freeze-on-complete), `lib/search-doc.ts` (taskToSearchDoc/indexTask) — the shared helpers now
  imported by both the routes and the still-in-activate exec tools. Behavior-preserving; the optional behavioral
  "redesign opportunities" (REST/MCP guard inconsistency, identifier-fallback dedup, dead .catch noise) are NOT
  taken here — noted for follow-up. Verified: typecheck/lint/tasks suite 206-0/full-suite/binary build/boot smoke.
  DEFERRED: the ~370-line exec-tools block → `lib/exec-tools.ts` (registerTaskExecTools) + `lib/maintenance.ts`,
  which slims activate() to the thin-index shape.
- Remaining: workflows/index (2,146) + lib/runtime (1,633), workflow-canvas-editor (1,803), models-page
  (1,205), health-page (1,155), schedule/index (1,443), asset-service (835) + test splits. Includes the
  workflows validator dedup flagged in #510.
