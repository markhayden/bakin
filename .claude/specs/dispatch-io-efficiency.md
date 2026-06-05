# Dispatch & Task-Store IO Efficiency

**Status:** Approved — implements GitHub issue #434 (follow-up to the session-death hardening work, shipped; see `.claude/knowledge/session-forensics.md`)
**Date:** 2026-06-05 (supersedes 2026-06-04 draft)
**Source:** Adapter/dispatch audit (2026-06-04, three parallel reviewers) + final review pass findings from #434. All 11 findings re-verified against `release/v0.0.1-rc.16` on 2026-06-05.

## Objective

Eliminate the O(N)-everything IO patterns in the task store and dispatch cycle, the redundant broadcast/audit traffic they generate, and the unbounded read/cache patterns found in the final review pass. No user-visible behavior changes except: (a) the dispatch asset block starts working again (it is currently silently broken), and (b) external hand-edits to task JSON files no longer broadcast live (store becomes the single writer).

## Design Decisions (interview, 2026-06-05)

1. **Task store is the single writer.** `tasks/` is ignored by the chokidar content watcher; the store's own `emit` is the only broadcast + index source. The in-memory index holds only **id→path + column membership** — never task content — so external content edits are still picked up on read. The index self-heals: `getSync` miss → targeted rescan + repair. External hand-edits (debugging only; no second sanctioned writer exists) require a browser refresh / restart to broadcast.
2. **Asset lookup via `assets.listByTask` RPC hook** backed by an in-memory `taskId → assetIds` index inside the assets plugin (startup scan, maintained on every mutation the plugin already owns). No search dependency (Antfly is optional), O(1) per dispatch, and core stops reaching into plugin-owned storage (fixes an adapter/hook-boundary violation).
3. **Tool catalog: hybrid managed block.** New `execution-tools` managed block (existing infra in `src/core/agent-rules/managed-blocks.ts`) carries the ~1.5KB truly-static catalog + rule prose. Dispatch keeps the taskId-templated tool invocations plus a 2–3 line OUTPUT DISCIPLINE reminder pointing at the AGENTS.md section — the discipline rules are session-death safety machinery and must keep a per-dispatch presence.
4. **Watchdog skips 'manual' tasks while the marker is latest.** Restart-recovery writes a structured `recovery: manual` log entry (bumps activity, visible in task log); the watchdog skips any task whose *latest* log entry is that marker. Subsequent human/agent activity naturally clears the skip.
5. **One branch, ordered commits.** `perf/dispatch-io-efficiency` off `main`, independently-revertible commits in dependency order, single PR closing #434.

## Findings (re-verified 2026-06-05, with current locations)

### 1. Task store: full recursive scan + parse-everything on nearly every operation — SEV-1
`packages/core/src/tasks/store.ts:188-199` (`findTaskPath`), `:251-274` (`listSync`), `:218-222` (`requireTask`).

- `getSync(id)` → `findTaskPath` readdirs the root + every monthly shard.
- `findSync` falls back to full `listSync` (read + JSON.parse **every** task file).
- `moveTaskToInProgress` → `findSync` (full list) + `updateSync`→`getSync` (scan) + `getColumnTaskCount`→`listSync` (full scan again, just for `order` inside `columnPatch`).
- Every `appendLogSync` → `requireTask`→`getSync` → full shard scan per log line. *(Drift note: the draft's "double `requireTask`" no longer exists — it's a single call now — but every log append still full-scans.)*
- One dispatch cycle ≈ O(K·N) file reads for K dispatches over N tasks.

**Fix:** in-memory index (id→path + column buckets, **no content**) inside `createFileBakinTaskStore`, maintained on store writes, self-healing on miss (targeted rescan + repair). `columnPatch` reads counts from the column buckets, never a full scan.

### 2. Asset block: broken sidecar scan per dispatch — SEV-1 (upgraded: correctness bug)
`src/core/dispatch.ts:1483-1506`. Scans `assets/store/<YYYY-MM>/*.meta.json` sidecars — **which no longer exist**. The versioned-assets migration moved to `store/<YYYY-MM>/<assetId>/manifest.json` per-asset dirs. The "Attached Assets" block has been silently empty since; agents are never told about their task's linked assets. Also an architecture violation: core walking plugin-owned storage directly.

**Fix:** assets plugin registers `assets.listByTask` (RPC hook) backed by an in-memory taskId→assets index (startup scan over manifests; updated on every mutation — all mutations already flow through the plugin's serialized manifest writes). Dispatch invokes the hook.

### 3. Lesson retrieval: uncached search per dispatch + silent drops — SEV-2
Call sites: `src/core/dispatch.ts:75-95` (`buildDispatchLessonBlock`), `:1680-1691` (workflow step). Implementation: `src/core/agent-packages/lesson-retrieval.ts:71-139` (`retrieveAgentPackageLessons`), `:141-181` (`formatLessonsForDispatch`).

Every dispatch (including each workflow re-dispatch, per active agent) fires an awaited `crossTableSearch` inline. *(Drift note: worse than the draft said — lessons that can't fit the 120-char minimum are **silently dropped with no marker**, not truncated.)*

**Fix:** cache the formatted lesson block per `(taskId, agentId, stepId)` for the dispatch lifetime (bounded map); skip retrieval on `inProgress` workflow re-dispatch unless the step changed. Skip lessons that can't fit a meaningful minimum (~400 chars) whole; append `(N lessons omitted)` when anything is dropped.

### 4. Double broadcast on every task write + audit spam — SEV-2
- Every task-file write broadcasts twice: store subscription (`packages/core/src/tasks/store.ts:224-229` emit) **and** the chokidar content watcher (`src/core/watcher.ts:131-145` — `shouldIgnoreContentWatcherPath` ignores only `plugins/` + dotfiles; `tasks/**/*.json` matches) → redundant read + SSE ~300ms later (`awaitWriteFinish`).
- `task.moved` is audited on every internal todo→inProgress dispatch transition (`dispatch.ts:1108, 1296, 1660`) in addition to `task.dispatched` (`:1112, 1303, 1707`) — two audit rows per dispatch.

**Fix:** ignore `tasks/` in `shouldIgnoreContentWatcherPath` (store broadcast is authoritative — see decision 1); fold the internal move into `task.dispatched`. Note `tasks/salvage/` (written directly by `dispatch.ts:529`, not store-managed) is also covered by the ignore — salvage files don't need broadcasts.

### 5. Watchdog vs restart-recovery 'manual' conflict — SEV-3
`src/core/restart-recovery.ts:178-189` classifies partially-stale workflow tasks `action: 'manual'`, leaves them `inProgress` with no `updatedAt` bump and no log entry; the watchdog's 60s guard (`src/core/watchdog.ts:152`) reads stale `updatedAt`, so the first tick can auto-recover a task explicitly flagged for manual attention.

**Fix:** per decision 4 — structured `recovery: manual` sentinel log entry + watchdog skip while that marker is the latest log entry.

### 6. Tool-catalog migration out of per-dispatch prompts — SEV-3
`src/core/dispatch.ts:1352-1373` (`sharedExecutionToolDocs`), `:1381-1395` (`outputDisciplineSection`), `:1549-1595` (tool block). ~4KB per dispatch; ~1.5KB truly static, ~2.5KB interpolates `taskId`/agent/task context (~20 interpolation sites) and must stay.

**Fix:** per decision 3 — new `execution-tools` managed block via `src/core/agent-rules/managed-blocks.ts` for the static portion; dispatch keeps templated invocations + short discipline reminder referencing the AGENTS.md section.

### 7. `nextDispatchThreadId`: N+1 dispatch-state writes per cycle — SEV-2 *(new)*
`src/core/dispatch.ts:57-62` — every minted threadId calls `saveDispatchState` (full `.dispatch-state.json` serialize+write) inside the cycle's `withStateLock` (`:966-1132`), which saves the whole state again at cycle end (`:1131`). N dispatches → N+1 full-file writes.

**Fix:** mint seqs in memory during the loop; one `saveDispatchState` **before any turn fires** (persist-before-send preserved — seq durability before send is what prevents threadId reuse after a crash; the gateway `idempotencyKey` at `:1158` keeps re-fires safe). Restructure: collect dispatchable work → mint all seqs → save once → fire turns.

### 8. Trajectory forensics: O(delta²) re-scan — SEV-2 *(new)*
`packages/adapter-openclaw/src/trajectory-forensics.ts:244-300` (`watchTrajectoryForDeath`), `:92-201` (`inspectTrajectoryRun`), `:67-81` (`readFrom`). The 200ms poll re-reads and re-JSON.parses the entire tail from the fixed turn-start offset on every size change — O(delta²) over tool-heavy turns.

**Fix:** incremental scan — advance a parse cursor past complete lines, carry the inspection state machine forward across polls, buffer any trailing partial line. Early-exit once a terminal event is found.

### 9. `queryAuditEvents`: unbounded full-file read — SEV-2 *(new)*
`src/core/audit.ts:24-61` reads + parses the entire `audit.jsonl` (append-only, ISO `ts` per line) even for a 24h-window health check (`plugins/tasks/lib/health-checks.ts`).

**Fix:** when `sinceMs` is set, reverse chunked tail read from EOF, parsing line-by-line backwards and stopping at the first entry older than the cutoff. Preserve existing result ordering and `limit` semantics.

### 10. `sessionStoreCache`: no size bound — SEV-3 *(new)*
`packages/adapter-openclaw/src/runtime.ts:2405-2420` — global `Map` keyed by sessions.json path, each entry holding a fully-parsed session store; eviction only on stat failure.

**Fix:** LRU cap (64 entries — comfortably above realistic agent cardinality; cheap insurance). Mirror the existing manual-cap pattern used by `emittedApprovalResponseKeys`.

### 11. Duplicated file-read utils in the adapter — SEV-4 *(new)*
`trajectory-forensics.ts:40-46` (`safeTrajectoryOffset`) ≡ `runtime.ts:2465-2471` (`safeFileSize`); `trajectory-forensics.ts:67-81` (`readFrom`) ≈ `runtime.ts:2473-2494` (`readFileTail`, identical minus offset-in-return).

**Fix:** one shared util module `packages/adapter-openclaw/src/file-utils.ts` (`safeFileSize`, `readFileFrom` returning `{ text, nextOffset }`); both call sites migrate. No shim/back-compat exports.

## Testing strategy

Standard repo rules (mock **both** content-dir resolvers + OpenClaw home, temp dirs, `afterAll` cleanup, mock logger/watcher/AppServices). Add:

- **Task-store index correctness** under create/move/update/delete + self-heal on index miss (externally-created file found via fallback rescan and repaired into the index).
- **Operation-count regression tests** — spy on fs reads per dispatch cycle; assert O(K), not O(K·N); assert one `.dispatch-state.json` write per cycle.
- **Single-broadcast-per-write** assertion (watcher ignores `tasks/`; store emit fires once).
- **Asset hook:** `assets.listByTask` returns correct assets under the versioned layout; index updates on save/delete; dispatch asset block populated again (regression test for the silent breakage).
- **Lesson cache:** hit on re-dispatch with unchanged step, miss on step change; `(N lessons omitted)` marker on overflow; no lesson body truncated below the 400-char minimum.
- **Watchdog skips recovery-manual tasks** while marker is latest; resumes eligibility after a newer log entry.
- **Trajectory incremental scan:** same verdicts as full re-scan across chunked/partial-line appends; parse-count assertion (each line parsed once).
- **Audit tail read:** equivalence with full read for 24h-window queries on a fixture spanning the cutoff; correct behavior across chunk boundaries and a partial first line.
- **sessionStoreCache LRU:** eviction at cap, mtime invalidation still works.
- **Managed block:** `execution-tools` block projected/repaired by doctor; dispatch message no longer contains the static catalog but retains taskId-templated invocations + discipline reminder.

## Commit strategy

Dependency-ordered; each independently revertible. 1 is the measurement prerequisite for 2–4.

1. `perf(core): in-memory task-store index (id→path + column buckets, self-healing)`
2. `fix(core): single broadcast per task write — ignore tasks/ in content watcher; fold task.moved into task.dispatched`
3. `fix(assets): assets.listByTask hook + taskId index; repair broken dispatch asset block`
4. `perf(core): lesson-retrieval cache + omission marker (fix silent lesson drops)`
5. `perf(core): fold dispatch threadId seq mints into one persist-before-send state save`
6. `fix(core): watchdog respects restart-recovery manual classification`
7. `perf(core): reverse tail read for queryAuditEvents time-window queries`
8. `refactor(adapter-openclaw): shared file-utils (safeFileSize/readFileFrom)`  *(prerequisite for 9)*
9. `perf(adapter-openclaw): incremental trajectory forensics scan`
10. `perf(adapter-openclaw): LRU cap on sessionStoreCache`
11. `refactor(core): execution-tools managed block; slim static tool catalog out of dispatch prompts`

## Docs impact

- `.claude/knowledge/dispatch.md` — single state save per cycle, asset hook, lesson cache, audit folding.
- `.claude/knowledge/session-forensics.md` — incremental trajectory scan.
- `.claude/knowledge/adapter-architecture.md` — note `assets.listByTask` as the sanctioned asset-lookup path from core.
- `.claude/knowledge/plugin-system.md` / hooks listing if one exists — new hook.
- `.claude/knowledge/assets-versioning.md` — dispatch consumption via hook.
- `README.md` — no impact expected (no user-facing surface changes).

## Non-goals

- No backwards compatibility or shims (single-user machine).
- No live broadcast support for external hand-edits to task files (store is the single writer).
- No search-index dependency for the dispatch asset block.
