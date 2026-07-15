# Bakin-Owned Scheduler

> How Bakin schedules fire. Replaces the old "delegate cron to OpenClaw" model that double-fired every scheduled task.

## Why this exists

Originally a Bakin schedule was stored as an OpenClaw cron job whose payload was an `agentTurn` carrying the string `bakin:schedule:<name>`. At fire time OpenClaw delivered that string to the agent as a real, tool-capable turn — the agent improvised and posted — **and** a separate Bakin path created the "real" scheduled task. One cron fire → two executions → duplicate posts + a delivery/repair loop. The OpenClaw cron was also armed with the agent's full toolset (`--clear-tools` reverts to all tools) and `--no-deliver` does **not** disable the message tool, so the rogue turn could post freely.

The fix: **Bakin owns scheduling for Bakin schedules.** OpenClaw cron is no longer involved in firing a Bakin schedule.

## Model

- **Source of truth:** the schedule store (`plugins/schedule/lib/sidecar.ts`, `~/.bakin/schedule/sidecar.json`). Each `BakinJobMeta` carries the Bakin-owned `schedule` (`{ kind, expr }`), `enabled`, tz, prompt, owner, pause/skip/overlap/failure state. Ids are Bakin-minted (`sch_<uuid>` via `newScheduleId()`).
- **Engine:** `plugins/schedule/lib/scheduler.ts` — a dependency-injected, fake-clock-testable tick. Each tick computes due occurrences in `(now − window, now]` via `cron-eval`, mints a deterministic per-occurrence `runId = ${jobId}:${occurrenceISO}`, claims it in the execution ledger (`claimCronFire`), and on a fresh claim runs the shared post-claim path (`runClaimedFire` → pause/skip/overlap/failure checks → `createTaskWithEffects`). Exactly-once is the ledger's `(job_id, run_id)` PK — re-ticks and a second worker are no-ops.
- **Cron evaluation:** `plugins/schedule/lib/cron-eval.ts` is the ONLY importer of `cron-parser`. Timezone/DST-aware (`nextRun`, `prevRun`, `occurrencesBetween`, `isValidExpr`).
- **Tick cadence + catch-up window:** plugin settings `tickIntervalSeconds` (default 30, floor 5) and `catchUpWindowMinutes` (default 60), both editable in the schedule UI, applied without restart.

## Lifecycle (`activate()`)

1. **Cutover** (`lib/cutover.ts`, idempotent): for each Bakin job still backed by an OpenClaw cron, import its expr/tz/enabled into the store, then `cron.remove` the OpenClaw job. Runs every activate to close the upgrade gap and recover from a prior partial. Shared with the doctor repair via `runScheduleCutover()`.
2. **Startup catch-up** (`runStartupCatchUp`): for each job take the SINGLE most-recent missed occurrence (coalescing a long outage to one task — no stale bursts). Within `catchUpWindowMinutes` → fire into **todo** (dispatches normally); older → create in **blocked** with reason `missed schedule window` (the exported `MISSED_WINDOW_REASON` constant) for the user to triage. The occurrence runId keeps this exactly-once and deduped against the steady tick. **The task is labeled by its occurrence date, not creation time** — a run missed on day *D* and caught up on *D+1* reads as *D*, so staleness is visible instead of masquerading as "today" (`runClaimedFire` derives the title/`{date}` from the threaded `firedAtMs`). The occurrence is an absolute instant, so the date is rendered in the **job's timezone** (`meta.tz`), not UTC — an evening run that crosses UTC midnight still reads as its local day.
3. **Start the tick** (`startScheduler`): `setInterval` → `runSchedulerTick` then `healPendingCronClaims` (recovers a claim stranded by a crash between claim and task creation). `stopScheduler` on shutdown.

## Native OpenClaw crons (read-only)

The crons the runtime/agents create for themselves are surfaced **read-only**. `lib/jobs-reader.ts` unions two sources: runtime crons (`cron.list()`) and store-owned Bakin schedules (synthesized from the stored schedule when they have no runtime cron). Mutating a non-Bakin job (PUT / pause / skip / delete, route + exec tool) is rejected with 403 / `ok:false` and guidance to **adopt** it first. `adopt` copies the expr into a Bakin schedule and removes the native cron; `restore-native` puts it back. The reader never auto-deletes a Bakin record (a read must not mutate the store) — only genuinely-orphaned non-Bakin sidecar entries are swept.

## Run history & skip visibility

The ledger's `cron_fires` table is the durable per-fire record (`(job_id, run_id)` PK, `disposition` ∈ `pending|created|skipped|seeded`, `task_id`, and `skip_reason` — added in migration v2). Because Bakin schedules have no OpenClaw cron runs, the job-drawer run history reads the **ledger**, not the runtime adapter: `lib/runs-reader.ts` routes by ownership — a Bakin job → `listCronFires(jobId, limit)` mapped to `RunEntry` (created→`success`+taskId, skipped→`skipped`+`skippedReason`, pending→`pending`); a native cron → `cron.listRuns`. (Pre-cutover the drawer read `cron.listRuns` for everything, so Bakin jobs showed empty history — this is the fix.)

Skips are **visible**: every `skipFire()` in `runClaimedFire` (overlap / paused / skip-count / auto-paused) records the reason to `cron_fires.skip_reason` *and* emits a `schedule.fire_skipped` activity-audit event, so an overrunning or paused schedule shows up on the feed instead of silently dropping beats. The default `allowOverlap: false` serializes a job (a fire whose prior task is still in an **active** column is skipped, not piled on) — this just makes that serialization observable. Heal-time consume of an orphaned claim records `skip_reason: 'job-removed'` (no feed event).

**`blocked` is NOT an active column for overlap** (`activeColumns = ['todo','inProgress','review']`). A blocked task is awaiting human triage, not running — counting it as overlap silently suppressed the job's next real fire (e.g. a stale catch-up triage block ate the next day's run until hand-moved to `todo`). Excluding `blocked` lets the next occurrence fire normally.

**Triage blocks are not failures.** The outcome check (`runClaimedFire`) records a failure for a blocked last-task ONLY when its `blockedReason` is a genuine dispatch failure (set in `src/core/dispatch.ts`); a `MISSED_WINDOW_REASON` catch-up block never dispatched, so it does not increment `consecutiveFailures` or auto-pause — a slept-through fire must not pause a healthy schedule.

## Migration / repair command

`schedule-cutover` doctor check (`lib/health-checks.ts`): flags any Bakin schedule still backed by an OpenClaw cron job (incomplete cutover → rogue-fire risk). Its repair runs the same idempotent `migrateBakinSchedulesOffOpenClawCron`. It's a plugin-registered health check, so it's surfaced by `bakin doctor --full` and completed by `bakin doctor --fix` (NOT `bakin check`, which only routes the fixed onboarding checks). The cutover also runs automatically on every `activate()`, so this is the explicit verify/repair path for when OpenClaw was unreachable at boot.

`schedule-sync` doctor check (same file, registered since PR1 of the #191 hardening): flags native runtime cron jobs that aren't tracked in the schedule sidecar (e.g. created by an agent directly in the runtime). Detection is read-only; the repair records `requireTriage: true` sidecar entries only — it NEVER writes runtime cron state, which is what got the legacy sync check removed (double-fire risk). Cron-less runtimes (Pi) get an unconditional OK with no repair surface. The registration guard test in `tests/plugins/schedule/health-checks.test.ts` pins this invariant.

## Retention (cron_fires is bounded)

`pruneCronFires` (ledger verb, `packages/core/src/execution/ledger.ts`) bounds fire history: settled rows (`created`/`skipped`/`seeded`) older than **30 days** are pruned, always keeping the **newest 20 per job**; `pending` rows are untouchable (live claims the healer may consume) and nothing newer than `max(catchUpWindowMinutes, 7 days)` is ever deleted, so re-claims inside the dedup horizon still collide with their original row (test-pinned: `tests/core/ledger-retention.test.ts`). The scheduler loop sweeps at most once per 24h (`maybeRunRetentionSweep` in `scheduler-loop.ts`, in-memory cadence cell — restarts re-sweep, idempotent); sweeps that pruned rows emit a `schedule.retention_swept` audit event — history deletion is never silent.

## Prompt danger-zone guard

`lib/prompt-guard.ts` (`checkSchedulePrompt`): flags a schedule prompt that tells the agent to keep a single large message and not split near the channel transport limit (~2000 chars) — the shape that caused "Invalid Form Body" + split/repair loops. Surfaced live in the job form and returned as `warnings` from create/update routes + exec tools.

## What was removed

The cron→task **bridge webhook** + shared secret, the **reconcile-poll** (`reconcileScheduleRuns`), the **legacy main-session-wake repair** cluster, the **sidecar `processedRunIds` seeding**, and the adapter's **Bakin-specific cron payload shaping** (`isBakinCron`, `cronPayloadForCommand`, the bakin branch of `appendCronPayloadArgs`). Generic adapter `cron.create/update/remove/list/listRuns` remain (used for surfacing native crons + the cutover remove).

## Known follow-up

**Recovered/repaired delivery-failure visibility (deferred — [issue #471](https://github.com/markhayden/bakin/issues/471)).** Turn-*killing* delivery failures already surface via dispatch audit. The original incident's *recovered* failures happen when the agent posts via its message tool **inside OpenClaw** and then repairs — not observable at Bakin's `channels.sendMessage` (only the watchdog calls that). Surfacing them needs OpenClaw **trajectory tool-error introspection** in the adapter/session-forensics layer — a separate effort. The prompt-guard attacks the root cause that triggers the loop. Revisit if a repaired-delivery incident recurs with the guard in place.

## Key files

- `plugins/schedule/lib/{cron-eval,scheduler,cutover,prompt-guard,sidecar,jobs-reader,health-checks}.ts`
- `plugins/schedule/index.ts` — routes, exec tools, `activate()` wiring, read-only guards
- Ledger: `packages/core/src/execution/ledger.ts` (`cron_fires` + `skip_reason`, `listCronFires`), facade `src/core/execution-ledger.ts`
- Run history: `plugins/schedule/lib/runs-reader.ts` (ownership routing), `components/run-history.tsx`, client type `src/hooks/use-schedule.ts` (`RunEntry`)
- Tests: `tests/plugins/schedule/*` (engine + catch-up are fake-clock; cutover/health/routes are mocked)

## Cron parity stance + switch-time adoption (pi-parity D5, 2026-07-13)

Bakin schedules ARE the answer on cron-less runtimes — agents self-schedule
via `bakin_exec_schedule_*` (taught in the shipped role context, pinned by
`tests/core/schedule-context-pin.test.ts`); no fake `runtime.cron` exists on
Pi. Leaving a cron-bearing runtime: `bakin runtime use <t> --adopt-cron`
(opt-in) snapshots native jobs pre-teardown and the `schedule.adoptCronJobs`
hook (`plugins/schedule/lib/cron-adoption.ts`) turns each into a Bakin job —
`source: 'adopted'`, `originalRuntimeCron` snapshot preserved, idempotent
per job id, dry-run previewable. Mirrors the per-job REST adopt handler
minus live cron calls (the source runtime is already gone).

**Adopted jobs keep their native timezone.** Adapters hoist the provider
schedule tz into `CronJob.metadata.tz`; both adoption paths prefer it
(`nativeCronTz` in `schedule-util.ts`) over `getSystemTimezone()` — before
this fix an evening job adopted on a UTC-configured box silently shifted
hours.

## Hardening pins (PR1 of #191, 2026-07-15)

- **Switch survival:** `tests/integration/schedule-switch-survival.test.ts`
  runs real `switchRuntime` both directions over temp homes and proves
  schedules keep firing exactly once per occurrence (sidecar + ledger are
  runtime-independent), and that `--adopt-cron` yields a firing Bakin job.
- **Cron conformance:** the runtime-conformance suite pins the optional
  `cron` member — presence-by-declaration (`cron: 'present' | 'absent'`
  suite option; openclaw present, pi + minimal mock absent) and a CRUD
  round-trip run against the REAL OpenClaw adapter over the crab CLI shim.
  `mockCron()` is stateful (Map-backed) and honors the same contract.
  Teeth fixtures prove every new branch bites.
- **Deliberate stances (audited, unchanged):** no retry on the OpenClaw
  cron CLI surface (non-idempotent ops; degrade path is honest), cron stays
  out of `CapabilitySet` (member presence IS the contract), `--adopt-cron`
  stays opt-in. Note: current OpenClaw builds route `cron list` through the
  gateway (credentials required) — CRUD is NOT guaranteed gateway-free;
  `readMergedJobs` degrading to store-owned schedules covers that failure.
