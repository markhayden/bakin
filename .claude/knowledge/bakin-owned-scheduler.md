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
2. **Startup catch-up** (`runStartupCatchUp`): for each job take the SINGLE most-recent missed occurrence (coalescing a long outage to one task — no stale bursts). Within `catchUpWindowMinutes` → fire into **todo** (dispatches normally); older → create in **blocked** with reason `missed schedule window` for the user to triage. The occurrence runId keeps this exactly-once and deduped against the steady tick.
3. **Start the tick** (`startScheduler`): `setInterval` → `runSchedulerTick` then `healPendingCronClaims` (recovers a claim stranded by a crash between claim and task creation). `stopScheduler` on shutdown.

## Native OpenClaw crons (read-only)

The crons the runtime/agents create for themselves are surfaced **read-only**. `lib/jobs-reader.ts` unions two sources: runtime crons (`cron.list()`) and store-owned Bakin schedules (synthesized from the stored schedule when they have no runtime cron). Mutating a non-Bakin job (PUT / pause / skip / delete, route + exec tool) is rejected with 403 / `ok:false` and guidance to **adopt** it first. `adopt` copies the expr into a Bakin schedule and removes the native cron; `restore-native` puts it back. The reader never auto-deletes a Bakin record (a read must not mutate the store) — only genuinely-orphaned non-Bakin sidecar entries are swept.

## Migration / repair command

`schedule-cutover` doctor check (`lib/health-checks.ts`): flags any Bakin schedule still backed by an OpenClaw cron job (incomplete cutover → rogue-fire risk). Its repair runs the same idempotent `migrateBakinSchedulesOffOpenClawCron`. So `bakin check schedule-cutover` / `bakin install schedule-cutover` is the end-user migration command for when OpenClaw was unreachable at boot.

## Prompt danger-zone guard

`lib/prompt-guard.ts` (`checkSchedulePrompt`): flags a schedule prompt that tells the agent to keep a single large message and not split near the channel transport limit (~2000 chars) — the shape that caused "Invalid Form Body" + split/repair loops. Surfaced live in the job form and returned as `warnings` from create/update routes + exec tools.

## What was removed

The cron→task **bridge webhook** + shared secret, the **reconcile-poll** (`reconcileScheduleRuns`), the **legacy main-session-wake repair** cluster, the **sidecar `processedRunIds` seeding**, and the adapter's **Bakin-specific cron payload shaping** (`isBakinCron`, `cronPayloadForCommand`, the bakin branch of `appendCronPayloadArgs`). Generic adapter `cron.create/update/remove/list/listRuns` remain (used for surfacing native crons + the cutover remove).

## Known follow-up

**Recovered/repaired delivery-failure visibility (deferred).** Turn-*killing* delivery failures already surface via dispatch audit. The original incident's *recovered* failures happen when the agent posts via its message tool **inside OpenClaw** and then repairs — not observable at Bakin's `channels.sendMessage` (only the watchdog calls that). Surfacing them needs OpenClaw **trajectory tool-error introspection** in the adapter/session-forensics layer — a separate effort. The prompt-guard attacks the root cause that triggers the loop.

## Key files

- `plugins/schedule/lib/{cron-eval,scheduler,cutover,prompt-guard,sidecar,jobs-reader,health-checks}.ts`
- `plugins/schedule/index.ts` — routes, exec tools, `activate()` wiring, read-only guards
- Ledger: `packages/core/src/execution/ledger.ts` (`cron_fires`), facade `src/core/execution-ledger.ts`
- Tests: `tests/plugins/schedule/*` (engine + catch-up are fake-clock; cutover/health/routes are mocked)
