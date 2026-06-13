# Execution Ledger — Deep Reference

Exactly-once task firing, completion, and audit. SQLite coordination facts
with UNIQUE constraints as the locks: a duplicate fire/claim/completion
doesn't race a flag — it fails an INSERT, is suppressed, and is loudly
audited. Spec: `.claude/specs/execution-safety-ledger.md` (decisions,
user stories, root-cause table for the production double-executions that
motivated this).

## Architecture

- **`packages/core/src/storage/db.ts`** — the SOLE `bun:sqlite` importer in
  the repo (architecture-test enforced: `tests/architecture/
  adapter-boundary.test.ts` sqlite rule allowlists exactly this file). One
  database at `getBakinPaths().db` (`~/.bakin/bakin.db`), WAL mode,
  `busy_timeout=5000`, HMR-safe globalThis singleton (same reason as
  `__bakinBroadcast`), per-module `schema_migrations` table (NOT
  `PRAGMA user_version` — a single global int would collide when a second
  domain module wants its own migration track), `withTx`, `closeDb` (tests).
- **`packages/core/src/execution/ledger.ts`** — first domain module; owns
  its tables and exposes **domain verbs only**. No SQL or sqlite types
  cross the boundary (it consumes the opaque `Db` handle).
- **`src/core/execution-ledger.ts`** — app facade (content-dir pattern).
- **`src/core/boot-id.ts`** — per-process boot generation
  (`crypto.randomUUID()`, globalThis singleton; not pid — pids recycle, not
  time — clocks change). Stamped on claims; drives the startup sweep.

**Ownership rule:** the ledger answers "may this happen / did this happen".
Markdown/JSON owns what a task IS; Antfly owns search. No cross-references.

**Fail closed:** every verb throws `LedgerUnavailableError` when the db is
unreachable. Dispatch, cron firing, and completion REFUSE to proceed —
never fall back to an unguarded path. Doctor's `execution-safety` check
errors loudly in that state. Advisory consumers (heartbeat bumps, task-
deletion purge) catch and log instead.

## Tables

```
runs          run_id PK (== dispatch threadId task:<id>:d<seq>), task_id,
              exec_key, seq, agent, status running|settled|superseded|lost,
              boot_id, started_at, heartbeat_at, settled_at, settle_reason
              UNIQUE(task_id, seq); UNIQUE INDEX runs_one_live_per_key ON
              (exec_key) WHERE status='running'   ← THE dispatch lock
seq_watermarks task_id PK, seq — floors seeded once from the legacy
              .dispatch-state.json#dispatchSeq (v1 migration) so minted
              threadIds never collide with previously used provider sessions
cron_fires    (job_id, run_id) PK ← THE cron lock; fired_at (logical run
              time), claimed_at (insert time — healer staleness keys on
              THIS: startup catch-up may fire an occurrence hours old, and an
              in-flight claim for an old run must not look healable), task_id,
              disposition pending|created|skipped|seeded
completions   task_id PK ← first completion wins; run_id, agent, channel
idempotency   key PK (e.g. the image 9-tuple signature), kind, result_json
              — durable, NO TTL, INSERT OR IGNORE (first write wins).
              result_json is coordination-only: image rows persist asset
              identity + promptHash; prompt text / providerText are stripped
              before write (the caller's first-run result keeps them — only
              the dedup row is content-free)
```

`exec_key` is the live-run lock scope: the task id for regular tasks,
`taskId:stepId` for workflow steps (parallel step agents are legitimate
concurrent runs). `seq` stays per-TASK (shared counter across steps),
exactly preserving legacy threadId semantics.

## Who calls what

| Layer | Caller | Verbs |
|---|---|---|
| Cron dedup | `plugins/schedule` scheduler tick + startup catch-up (claim-first) + heal pass | `claimCronFire`, `attachCronTask`, `markCronFireSkipped`, `findHealableCronClaims`, `getCronFire` |
| Completion gate | `task-service.moveTaskWithEffects` done-branch (`reportComplete` flows through it) + `task-service.syncLedgerForStoreMove` (the workflow engine's ledger-aware store move — `moveTaskInStore` routes ALL workflow moves through it, #482) | `recordCompletion`, `deleteCompletion` (via `reopenIfLeavingDone`), `hasCompletion` |
| Block guard | `task-service.blockTaskWithEffects` — completion row ⇒ `{ alreadyComplete: true }`, no side effects; move route maps it to 409, MCP block to the soft payload (#482) | `hasCompletion` |
| Dispatch claims | `dispatch.ts` all 3 paths via `claimDispatchRun` | `claimNextRun` (atomic mint+claim), `settleRun`, `loseRun`, `currentSeq` |
| Watchdog | supersede-first recovery | `getLiveRun`, `supersedeStaleRun` (transactional; N racing actors → 1 winner) |
| Liveness | `task-service.logProgress` (advisory) | `bumpHeartbeatByTask` |
| Boot | `server.ts` before restart recovery: run sweep, then completion backfill (`backfillMissingCompletionRows` — synthetic rows for done-without-row tasks, idempotent every boot) | `markPriorBootRunsLost(bootId)`, `recordCompletion` |
| Money ops | `plugins/images` `runBilledImageCall` | `getIdempotent`, `putIdempotent` |
| Edit safety | `plugins/tasks` `taskEditGuard` | `hasCompletion` |
| Run history (read-only) | `plugins/tasks` task drawer via `GET /:taskId/runs` (per-task attempts + task outcome: `readTaskOutcome` joins the completions row with the task column — completion wins, else blocked/archived/in_progress; the boot backfill retired the done-without-row legacy branch (#482); the column fallback is gated on dispatch history so unknown ids never trigger the task store's shard walk, #476); `plugins/schedule` job drawer (per-schedule fires) | `listRunsByTask`, `getCompletion`, `listCronFires` |
| Cleanup | `task-store.deleteTask` + `task-store.archiveOldTasks` (both advisory) | `purgeTaskRows` (cron_fires kept — they dedupe the job, not the task) |

## Semantics

- **Cron:** the Bakin scheduler claims each occurrence (runId
  `jobId:occurrenceISO`) BEFORE task creation — rarely-miss, never-duplicate.
  A claim stranded `pending` (crash between claim and create) is healed by the
  scheduler's heal pass (`healPendingCronClaims`) UNDER THE SAME CLAIM after
  5 min, re-evaluating pause/skip at heal time. Manual `run`/`run_now` fires
  mint `manual-<uuid>` — intentional repeats are never blocked. (`seeded` is a
  legacy disposition that may still exist on rows from the old sidecar
  migration; nothing writes it anymore.) See
  `.claude/knowledge/bakin-owned-scheduler.md`.
- **Completion:** first write wins; the winner emits `task.completed` +
  hooks + continuation + orchestrator notify exactly once; losers audit
  `task.completion_suppressed` and surface `{ ok: true, alreadyComplete:
  true }` — an agent retrying a timed-out success must NEVER see an error.
  Reopen (moving a completed task to any active column; archive exempt)
  deletes the row (`task.reopened`) — the only unfreeze path. The invariant
  is biconditional since #482: a completions row ⟺ the task is done. EVERY
  exit from done clears the row — `moveTaskWithEffects` and the workflow
  engine's `syncLedgerForStoreMove` both run `reopenIfLeavingDone` — and
  workflow done-moves record rows symmetrically. The boot backfill
  (`task.completion_backfilled`) healed pre-ledger done tasks once and
  reconverges every start.
- **Block-on-done is rejected, two layers deep.** Service layer:
  `blockTaskWithEffects` returns `{ alreadyComplete: true }` on a row-bearing
  task with zero side effects — channel-independent, so it covers the human
  kanban drag; REST/move map it to 409, MCP to the soft success payload.
  Store layer: `blockTask` enforces `VALID_TRANSITIONS` like `moveTask`
  (human bypass preserved; `blocked→blocked` stays an idempotent reason
  update so retries never error). Parent-block propagation drops the
  caller's channel, so a done parent is never yanked to blocked. Known
  fail-soft edge: the watchdog's step-timeout escalation can attempt
  `review→blocked` if a human moved the task mid-step — rejected into its
  existing catch. Escape hatches that bypass ALL of this (do not use for
  task lifecycle): the packages-store `ctx.tasks.move` plugin API writes
  columns with no validation and no ledger sync; store `updateTask`'s
  `column` patch validates transitions but skips the ledger (covered
  upstream by `taskEditGuard`'s completion 409).
- **Runs:** settle-before-reconcile in the turn handlers so the recovery
  ladder can claim anew; superseded runs that turn out alive may still
  complete (first-completion-wins decides); durable idempotency makes the
  loser's identical money ops $0.
- **Watchdog:** recovery requires superseding the live run (heartbeat
  staleness vs `settings.watchdog.stuckThresholdMs`); a fresh heartbeat
  skips recovery (replaced the old 60s updatedAt guard, issue #114); zero
  live runs = stranded task, recovered as before; ledger error = skip
  (fail closed, no blind recovery).

## Audit events

`schedule.fire_suppressed`, `schedule.fire_healed`, `task.completed`,
`task.completion_suppressed`, `task.completion_backfilled`, `task.reopened`,
`task.dispatch_suppressed`, `task.run_superseded`, `tasks.edit_conflict`. Doctor's `execution-safety`
check (plugins/health) counts the suppression kinds over 24h — green means
no duplicates were even attempted; warn means the guards fired (inspect
audit.jsonl); error means the ledger is unreachable and the guards are
failing closed. No parallel stat recorder — counts come from
`queryAuditEvents`.

## Server singleton

`src/core/server-lock.ts` — `~/.bakin/server.lock` `{pid, port, startedAt,
bootId}` acquired before ANY side effect in `server.ts`; a live holder
(EPERM counts as alive) refuses startup naming the pid; stale/corrupt locks
are swept via exclusive-create retry; released in the lifecycle shutdown.
EADDRINUSE routes through `lifecycle.triggerShutdown` (full graceful chain
— the antfly child is stopped, not orphaned, #459) and exits non-zero.

## Testing

The db path derives from `getBakinPaths().db`, so the standard content-dir
mocks isolate it — but ONLY if the mock provides the `db` key and BOTH
`src/core/content-dir` and `packages/core/src/content-dir` are mocked.
`closeDb()` (from `packages/core/src/storage/db`) in afterEach/afterAll
before `rmSync` — a cached handle over a deleted inode keeps stale claims
alive across tests (SQLITE_IOERR_VNODE is the symptom). Key suites:
`tests/core/execution-ledger.test.ts` (verbs), `dispatch-concurrency`
(claims), `completion-gate`, `watchdog` (supersede), `schedule/cron-dedup`,
`ledger-migration-seq`, `server-singleton`, `images/idempotency-durable`,
`health/execution-safety`.
