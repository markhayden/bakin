# Plan: Dispatch & Task-Store IO Efficiency (#434)

## Context

Issue #434 collects 11 code-verified IO-efficiency findings deliberately split out of the session-death-hardening branch: the task store full-scans every shard on nearly every operation (O(K·N) reads per dispatch cycle), the dispatch asset block is **silently broken** (scans for `.meta.json` sidecars that stopped existing after the versioned-assets migration), lesson retrieval fires an uncached search per dispatch and silently drops lessons, every task write double-broadcasts, dispatch state is written N+1 times per cycle, trajectory forensics re-parses O(delta²), audit queries read the whole unbounded file, and the adapter has an unbounded cache + duplicated file utils. Approved spec: `.claude/specs/dispatch-io-efficiency.md` (all design decisions locked via interview 2026-06-05).

**Delivery:** branch `perf/dispatch-io-efficiency` off `main`, 11 dependency-ordered independently-revertible commits, single PR closing #434. First build step: copy this plan to `.claude/specs/dispatch-io-efficiency-plan.md` (repo convention).

## Verified traps (will bite if ignored)

1. **`buildDispatchMessage` is a sync export** (`dispatch.ts:1459`, test-covered). The async `assets.listByTask` hook invoke cannot go inside it — compute the block at the 3 call sites (~1092, ~1280, workflow ~1680) and pass `assetsBlock` in as a param.
2. **`countRecoveries` (`restart-recovery.ts:91-94`) counts any log message starting with `Restart recovery:`** — the new manual-hold log entry must use different wording (e.g. `Manual recovery hold:`) or manual holds inflate recovery counts and prematurely escalate to `block`.
3. **`nextDispatchThreadId` has 3 call sites** (cycle 1110, `dispatchSingleTask` 1298, `dispatchWorkflowTask` 1705). Only the regular cycle loop gets the collect→save-once→fire restructure; workflow/single paths keep persist-before-send-per-mint (few per cycle, not the hotspot).
4. **Asset block prose must switch filenames → assetIds** (versioned layout opens by assetId via `bakin_exec_assets_open`). Hook returns `{assetId, description, type}`.
5. **Commit 8's shared util must reconcile differing semantics**: `readFrom` (size<offset→null) vs `readFileTail` (size<offset→reset to 0). Write equivalence tests against the old functions before deleting them.
6. **Buffer-level carry for reverse/incremental reads** — multi-byte UTF-8 split at chunk boundaries; split on `\n` bytes, decode after assembly.

## Commits

### 1. `perf(core): in-memory task-store index (id→path + column buckets, self-healing)`
**Files:** `packages/core/src/tasks/store.ts`, `src/core/task-store.ts` (getColumnTaskCount), `tests/core/task-store.test.ts`
- Closure-local in `createFileBakinTaskStore`: `idToPath: Map<string,string>`, `idToColumn: Map<string,string>`, `columnBuckets: Map<string,Set<string>>`, lazy `buildIndex()` on first use (one full walk, content not retained).
- Maintain in `writeTask` (upsert: remove from prior bucket via `idToColumn`, add new) + `removeSync`. `createSync` existence check via index.
- Self-heal: `getSync` index miss → `findTaskPath` fallback walk → repair index; path hit but file gone → `indexRemove` + null. `findTaskPath` demoted to fallback only.
- New `countByColumnSync(column)` on `SyncBakinTaskStore`; `getColumnTaskCount` (`src/core/task-store.ts:159`) uses it — kills the full-scan in `columnPatch`.
- `listSync` keeps full content reads (taskboard needs content) but enumerates paths via index when warm.
- **Tests:** index consistency across create/move/update/delete; self-heal on externally-written file; fs-spy regression — K `appendLogSync` over N tasks doesn't scale reads with N.
- **CHECKPOINT:** full `task-store.test.ts` + all `dispatch*.test.ts` green before building on top.

### 2. `fix(core): single broadcast per task write`
**Files:** `src/core/watcher.ts:131-145`, `src/core/dispatch.ts`, tests
- `shouldIgnoreContentWatcherPath`: add `rel === 'tasks' || rel.startsWith('tasks/')` (also covers `tasks/salvage/` — intentional, spec decision 1).
- Remove the 3 dispatch-internal `task.moved` audits (`dispatch.ts:1108, 1296, 1660`); keep paired `task.dispatched`, add `from/to` to its payload. Grep `task.moved` consumers repo-wide first; watchdog/restart-recovery emit distinct events (`task.auto_recovered` etc.) — untouched.
- **Tests:** ignore-path assertions; one `task.dispatched` + zero `task.moved` per dispatch.

### 3. `fix(assets): assets.listByTask hook + taskId index; repair broken dispatch asset block`
**Files:** `plugins/assets/index.ts`, `plugins/assets/lib/asset-service.ts`, `src/core/dispatch.ts`, `tests/plugins/assets/list-by-task-hook.test.ts` (new), `tests/core/dispatch-assets.test.ts`
- In-plugin index: `taskAssetIndex: Map<taskId, Set<assetId>>` + `assetTaskLink: Map<assetId, taskId|null>`. Startup scan over `store/*/*/manifest.json` in `activate()`.
- Maintenance: synchronous updates in the mutation funcs dispatch cares about (`upsertFromSource`/`createAsset`/`relink`/`deleteAsset`) + existing `onSync`/`onUnlink` handlers as self-heal backstop for external manifest edits (watcher is debounced — sync path needed for next-dispatch correctness).
- Register `assets.listByTask` RPC hook returning `[{assetId, description, type}]`.
- Dispatch: delete broken scan (1482-1506) inside `buildDispatchMessage`; add `assetsBlock` param (builder stays sync); new `buildDispatchAssetBlock(taskId)` helper invoking the hook; compute at the 3 call sites. Workflow prompts get the block too (parity — flag in PR).
- Block prose: list assetIds + descriptions; "open with bakin_exec_assets_open using the assetId".
- **Tests:** hook correctness under versioned layout (create/delete/relink); dispatch message contains assetIds (regression for silent breakage); empty → no block.

### 4. `perf(core): lesson-retrieval cache + omission marker`
**Files:** `src/core/dispatch.ts`, `src/core/agent-packages/lesson-retrieval.ts`, `tests/core/dispatch-lessons-cache.test.ts` (new)
- Bounded cache in dispatch.ts: key `agentId+'\0'+query` (query embeds title/desc/step instructions → step change = natural miss), TTL 5min, cap 200 (Map insertion-order eviction), cache empty blocks too, `agent_pkg.lessons_retrieved` audit only on miss. Test-only `__resetLessonCache()` export.
- `formatLessonsForDispatch`: `MIN_LESSON_CHARS = 400` — skip (never truncate below min) lessons that can't fit whole; count omissions; append `(N lessons omitted)`.
- **Tests:** search spy — once across two same-query dispatches, twice on query change; no body < 400 chars; marker present; cap respected.

### 5. `perf(core): fold dispatch threadId seq mints into one persist-before-send state save`
**Files:** `src/core/dispatch.ts`, `tests/core/dispatch.test.ts`, `dispatch-concurrency.test.ts`
- `nextDispatchThreadId` gains `opts?: { deferSave?: boolean }`.
- Regular cycle loop restructured two-phase: **collect** (per-task: eligibility → move → mint with `deferSave:true` → build message → push intent; per-task try/catch so one failure doesn't lose other seqs) → **single `saveDispatchState`** → **fire** all intents. Save strictly precedes first fire (persist-before-send; gateway idempotencyKey remains the crash net).
- `dispatchSingleTask` + `dispatchWorkflowTask` unchanged (persist-per-mint) — scoped per trap 3.
- **Tests:** fs-spy — exactly 1 state write per K-task cycle; call-order — state write before first `sendDispatchMessage`; seq durability across reload.
- **CHECKPOINT:** all dispatch suites + live multi-task smoke.

### 6. `fix(core): watchdog respects restart-recovery manual classification`
**Files:** `src/core/restart-recovery.ts`, `src/core/watchdog.ts`, both test files
- Manual path (~249-251): `addTaskLog(id, 'system', 'Manual recovery hold: ...', { restartRecovery: 'manual' })` — **NOT** prefixed `Restart recovery:` (trap 2). Bumps updatedAt + visible in UI.
- Watchdog: `latestLogIsManualRecovery(task)` — latest log entry (tie → last-in-array) has `data.restartRecovery === 'manual'` → skip, before stuck/guard checks. Structured match, no message-text matching. Newer activity naturally clears.
- **Tests:** manual candidate writes marker + skipped; watchdog skips marked stale task (no auto_recovered/alert); newer log → eligible again.

### 7. `perf(core): reverse tail read for queryAuditEvents time-window queries`
**Files:** `src/core/audit.ts`, `tests/core/audit-query.test.ts`
- `sinceMs` unset → existing full read. Set → reverse 64KB-chunk read from EOF, Buffer-level carry for split lines (trap 6), parse newest→oldest, stop at first entry older than cutoff (append-only assumption; clock-skew caveat documented), tolerant of malformed lines. Reverse accumulator → oldest-first + `slice(-limit)` — byte-identical semantics to current.
- **Tests:** deep-equal equivalence vs full-read on fixtures spanning cutoff; chunk-boundary partial line; malformed line; limit semantics.

### 8. `refactor(adapter-openclaw): shared file-utils` *(prereq for 9)*
**Files:** new `packages/adapter-openclaw/src/file-utils.ts`; migrate `runtime.ts:2465-2494`, `trajectory-forensics.ts:40-46,67-81`; new `tests/adapter-openclaw/file-utils.test.ts`
- `safeFileSize(path)` + `readFileFrom(path, offset): {text, nextOffset} | null`. Reconcile semantics so BOTH call sites preserve exact current behavior (trap 5) — equivalence tests against old functions written first, then delete originals. No shims.

### 9. `perf(adapter-openclaw): incremental trajectory forensics scan`
**Files:** `packages/adapter-openclaw/src/trajectory-forensics.ts`, its test file
- Extract inspection state machine into an incremental scanner: carried `ScanState` + partial-line buffer + byte cursor (advance by byte length of complete lines only — `Buffer.byteLength`); `watchTrajectoryForDeath` feeds new bytes per tick instead of re-inspecting from turn-start; early-exit on terminal `session.ended`; `inspectTrajectoryRun` becomes a thin one-shot wrapper (existing callers/tests unaffected). `readFileFrom` null (rotation/error) → skip tick, don't corrupt state.
- **Tests:** chunked-feed equivalence vs one-shot (incl. mid-line + multi-byte splits); each line parsed exactly once across polls; `session.started` mid-stream resets evidence.
- **CHECKPOINT:** adapter suites + mock-runtime smoke (`bun run dev:mock`).

### 10. `perf(adapter-openclaw): LRU cap on sessionStoreCache`
**Files:** `packages/adapter-openclaw/src/runtime.ts:2405-2420`, new/extended adapter test
- Cap 64, Map-as-LRU (delete+re-set on hit, evict first key on overflow — mirrors `emittedApprovalResponseKeys` pattern). mtime invalidation unchanged.

### 11. `refactor(core): execution-tools managed block; slim static tool catalog out of dispatch prompts`
**Files:** `src/core/agent-rules/managed-blocks.ts`, `src/core/dispatch.ts`, `tests/core/agent-rules-managed-blocks.test.ts`, `tests/core/dispatch-prompts.test.ts`
- New `MANAGED_BLOCKS` entry `{blockId: 'execution-tools', target: 'subagent', contentFn}` carrying the ~1.5KB static catalog + discipline rationale. Projected via existing doctor/`bakin agent-rules --apply` path.
- Dispatch keeps: taskId-templated invocations + 2-3 line OUTPUT DISCIPLINE reminder (with the templated `assets_save` line) pointing at the AGENTS.md section. Same slimming in `buildWorkflowDispatchMessage`. Corrective/decomposition messages untouched.
- **Operational note for PR:** run `bakin agent-rules --apply` after deploy so agents have the block before prompts rely on it.
- **Tests:** block registered/projected/repaired; prompt lacks static prose, retains templated invocations + reminder; length-reduction assertion. Existing prompt tests asserting moved text get updated.

## Docs pass (with or after commit 11)

- `.claude/knowledge/dispatch.md` — single state save/cycle, asset hook, lesson cache, audit fold, slimmed prompts
- `.claude/knowledge/session-forensics.md` — incremental scan
- `.claude/knowledge/adapter-architecture.md` — `assets.listByTask` sanctioned path
- `.claude/knowledge/assets-versioning.md` — dispatch consumption via hook
- README: no impact (verified — no user-facing surface changes)

## Verification (end-to-end)

1. Per-commit: targeted suites listed above; repo test rules (mock both content-dir resolvers + OpenClaw home, temp dirs, cleanup) on every new test file.
2. Checkpoints after commits 1, 5, 9: full `bun run test` + smoke (`bun run dev:mock`, dispatch a few tasks, watch SSE/audit feeds: one broadcast per write, one audit row per dispatch, asset block present, lessons cached on re-dispatch).
3. Final: full suite, `bun run build`, live smoke on the real instance, `bakin agent-rules --apply`, PR with `Closes #434`.
