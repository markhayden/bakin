# Schedule run visibility — plan

Make schedule fires/skips visible. Two user asks: (1) live audit on skipped fires,
(2) ledger-backed per-schedule run history in the job drawer (also fixes a cutover
regression: the drawer's run history reads OpenClaw cron runs, which are now empty
for Bakin-owned schedules).

The skip *reason* is currently discarded — `markCronFireSkipped` flattens every
skip to `disposition='skipped'`. `cron_fires` is the per-fire durable record keyed
by `(jobId, runId)`, so the reason's natural home is a `skip_reason` column there.
That makes the run-history a single clean ledger read.

## Slice A — ledger: persist skip reason + list fires  (commit 1)
- Migration v2: `ALTER TABLE cron_fires ADD COLUMN skip_reason TEXT`.
- `markCronFireSkipped(jobId, runId, reason?)` writes the reason.
- `CronFireRow` gains `skipReason: string | null`.
- New read verb `listCronFires(jobId, limit)` — newest-first by `fired_at`.
- Facade re-exports in `src/core/execution-ledger.ts`.
- **AC:** mark→read round-trips the reason; `listCronFires` returns a job's fires
  newest-first, bounded by limit; migration is idempotent on an existing db.
- **Test:** `tests/core/execution-ledger.test.ts`.

## Slice B — fire path: emit `schedule.fire_skipped` + carry reason  (commit 2)
- `skipFire(jobId, runId, reason)` helper in `plugins/schedule/index.ts`:
  `markCronFireSkipped(jobId, runId, reason)` + `pluginCtx.activity.audit(
  'schedule.fire_skipped', 'system', { jobId, runId, reason })` + return body.
- Replace the 5 skip return sites (paused, skip-count, auto-paused×2, overlap),
  keeping each site's existing `upsertJob(meta)` where present.
- **AC:** a paused fire and an overlap skip each emit one `schedule.fire_skipped`
  with the right `reason`; ledger row carries that reason; no change to create path.
- **Test:** `tests/plugins/schedule/cron-dedup.test.ts` (already captures audit).

## Slice C — run history reads the ledger for Bakin jobs + UI  (commit 3)
- `runs-reader.ts`: `readRuns`/`getLastRun` route by ownership — Bakin job →
  `listCronFires` mapped to `RunEntry` (created→success+taskId, skipped→skipped+
  skippedReason, pending→running); native job → existing `cron.listRuns`.
- Route `/:jobId/runs` + `getLastRun` callers pass the job (not just `cron`).
- `run-history.tsx`: render `skippedReason` next to a skipped badge.
- **AC:** a Bakin job with fires shows them in the drawer (was empty post-cutover);
  skipped rows show the reason; native crons still read the runtime adapter.
- **Test:** `tests/plugins/schedule/routes.test.ts`.

## Verify (before "done")
- `bun run test`, `bun run build`, `bun run docs:check`.
- Update `.claude/knowledge/bakin-owned-scheduler.md` (run-history source + skip
  visibility) and the schedule plugin's `bakin-plugin.json` route docs if needed.
- Gold-standard E2E in the isolated docker rig.

## Commit / rollback
One commit per slice (A→B→C), each independently green. Slice A is additive
(nullable column + new verb) so B/C can land later; B is independent of C. Any
slice can be reverted alone. Branch: `feat/schedule-run-visibility`.
