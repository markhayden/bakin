# Dispatch & Task-Store IO Efficiency

**Status:** Backlog — follow-up to `.claude/specs/session-death-hardening.md`
**Date:** 2026-06-04
**Source:** Adapter/dispatch audit (2026-06-04), three parallel reviewers, all findings code-verified. This spec captures the independent IO-efficiency cluster deliberately excluded from the session-death work to keep that branch focused.

## Objective

Eliminate the O(N)-everything IO patterns in the task store and dispatch cycle, and the redundant broadcast/audit traffic they generate. No behavior changes — same outputs, dramatically less filesystem churn.

## Findings (verified, with locations)

### 1. Task store: full recursive scan + parse-everything on nearly every operation — SEV-1
`packages/core/src/tasks/store.ts:208-219` (`findTaskPath`), `:271-294` (`listSync`).

- `getSync(id)` → `findTaskPath` readdirs the root + every monthly shard until it finds `task-<id>.json`.
- `findSync` falls back to full `listSync` (read + JSON.parse **every** task file).
- `moveTaskToInProgress` triggers `findSync` (full list) + `updateSync`→`getSync` (scan) + `getColumnTaskCount`→`listSync` (full scan again, just to compute `order` inside `columnPatch`).
- every `addTaskLog` → `requireTask`→`getSync` (scan), then `appendLogSync`→`requireTask`→`getSync` (scan **again**).
- One dispatch cycle ≈ O(K·N) file reads for K dispatches over N tasks. Dominant cost on a months-old install.

**Fix:** in-memory index (id→path + column buckets) inside `createFileBakinTaskStore`, invalidated on `emit`. Kill the double `requireTask` in the log path; `columnPatch` must not full-scan for a count.

### 2. Asset block: all-sidecar scan per dispatch — SEV-2
`src/core/dispatch.ts:859-883`. Walks every `assets/store/YYYY-MM/` dir and JSON.parses **every** sidecar to find assets whose `taskId` matches — O(total assets) per dispatch, usually for an empty block.

**Fix:** query the existing search index (one row per asset, has `taskId`) or maintain a taskId→filenames index.

### 3. Lesson retrieval: uncached search per dispatch + truncation cliff — SEV-2
`src/core/dispatch.ts:636, 782, 1062` → `retrieveAgentPackageLessons` (`lesson-retrieval.ts`). For any agent owning a package with lessons enabled, every dispatch (including each workflow re-dispatch, per active agent) fires a `crossTableSearch`, awaited serially inline.

Also `formatLessonsForDispatch` (`lesson-retrieval.ts:171-177`): the last fitting lesson can be truncated to ~120 chars of body, remaining lessons silently dropped, no elision marker.

**Fix:** cache lesson block per (taskId, agentId, stepId) for the dispatch lifetime; skip retrieval on `inProgress` workflow re-dispatch unless the step changed. Skip lessons that can't fit a meaningful minimum (~400 chars) whole; append "(N lessons omitted)".

### 4. Double broadcast on every task write + audit spam — SEV-2
- Every task-file write broadcasts twice: store subscription (`src/core/task-store.ts:87`) **and** the chokidar content watcher (`src/core/watcher.ts:178` matches `tasks/**/*.json`; nothing ignores `tasks/`) → redundant read + SSE ~300ms later (`awaitWriteFinish`). Progress-log-heavy turns double SSE traffic.
- `task.moved` is audited on every internal todo→inProgress dispatch transition (`dispatch.ts:650, 796, 1042`) in addition to `task.dispatched` — two audit rows per dispatch.

**Fix:** add `tasks/` to `shouldIgnoreContentWatcherPath` (store broadcast is authoritative); fold the internal move into `task.dispatched`.

### 5. Watchdog vs restart-recovery 'manual' conflict — SEV-3
`restart-recovery.ts:178-190` classifies partially-stale workflow tasks `action: 'manual'` and leaves them in `inProgress` with **no `updatedAt` bump** — the watchdog's 60s guard (`watchdog.ts:152`) doesn't apply, so the first watchdog tick can auto-recover a task recovery explicitly flagged for manual attention.

**Fix:** manual-classified tasks get a sentinel log entry (bumps last-activity) or the watchdog skips tasks whose latest log is a recovery-manual marker.

### 6. Tool-catalog migration out of per-dispatch prompts — SEV-3
After the session-death spec's shared tool-doc helper lands, ~3.7KB of static tool documentation still ships in every dispatch message. Move the static catalog into persistent agent context (MCP tool descriptions / AGENTS.md managed block) and keep only task-specific content in dispatch messages.

## Testing strategy

Standard repo rules (mock both content-dir resolvers + OpenClaw home, temp dirs, cleanup). Add:
- Task-store index correctness under create/move/update/delete/external-edit (watcher-driven invalidation).
- Operation-count regression tests (spy on fs reads per dispatch cycle; assert O(K) not O(K·N)).
- Single-broadcast-per-write assertion.
- Lesson cache hit on re-dispatch; elision marker on overflow.
- Watchdog skips recovery-manual tasks.

## Commit strategy

1. `perf(core): in-memory task-store index (id→path + column buckets)`
2. `perf(core): asset block via search index lookup`
3. `perf(core): lesson-retrieval cache + truncation elision fix`
4. `fix(core): single broadcast per task write (ignore tasks/ in content watcher) + fold task.moved audit`
5. `fix(core): watchdog respects restart-recovery manual classification`
6. `refactor(core): move static tool catalog to persistent agent context`

Each independently revertible; 1 is the prerequisite for measuring 2-3 honestly.
