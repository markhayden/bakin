# Search Chaos Drills — Results Record

Spec T22. Every drill runs against a REAL engine with fully ephemeral state
(temp BAKIN_HOME, temp data dirs, random ports — never `~/.bakin`, never the
live 3737/3738 servers). The engine binary defaults to the pinned machine
install (`~/.antfly/bin/antfly`); `BAKIN_ANTFLY_BIN` overrides.

**Re-run:** `bun scripts/dev/search-chaos-drills.ts` (manually invoked; NOT
part of `bun run test`; exits non-zero on any drill failure).

## Results — 2026-08-31, antfly 0.2.0 final, all five PASS

Re-run on the target M4 against the release binary as part of the 0.2.0
adoption gate (`tasks/evidence-antfly-0.2.0.md`) — post-de-hardening code
(no write gate, sync backfill, per-index leg creation). All five drills
passed in under 30 s total: engine-SIGKILL resume, process-SIGKILL resume,
550-write outage drain with no-op re-enqueue, wipe detection + rebuild
(200 docs), and upgrade-under-load with 68/68 writes landed, 0 pending.

## Results — 2026-07-03 (dev build `6538c0774` + bakin#317 patch), all five PASS

| # | drill | observed |
|---|---|---|
| 1 | SIGKILL the ENGINE mid-blue/green-backfill | in-flight migration threw EngineUnavailable; registry stayed `migrating`; queries stayed on blue throughout; after engine restart on the same data dir, `resumeMigrations` completed the flip; green held all 200 docs |
| 2 | SIGKILL the DRIVING PROCESS mid-migration | child process persisted `migrating/backfilling` then died; a fresh process's `resumeMigrations` (reads only the registry — no filesystem inference) completed the flip; 200/200 docs |
| 3 | 550 writes queued while the engine was DOWN | all 550 journaled (pending=550), drain landed 550/550 after restart, engine doc count exact; re-enqueueing the identical 550 docs was a 100% no-op (acked-hash dedupe, pending stayed 0) |
| 4 | Engine data dir WIPED, Bakin state intact | detection primitive fired (registry `active` + engine `stats(physical) === null` — what the doctor consistency check keys on); forced blue/green rebuild restored a fresh physical with all 200 docs |
| 5 | Upgrade under load (stop → binary swap → start) | 78 writes flowed continuously through the outbox across the stop/swap/start window; 78/78 landed, 0 pending, zero lost |

## Notes

- Drill 2 initially failed for a HARNESS reason worth remembering:
  `getContentDir()` caches on first resolution, so reassigning
  `process.env.BAKIN_HOME` per-drill inside one process silently keeps
  reading the first `search.db`. The drills now share one BAKIN_HOME (set
  before any repo import) with per-drill table names. Any long-lived
  process that changes BAKIN_HOME at runtime has the same hazard.
- Drill 1's kill window is timing-based (1.5s into a ~5s backfill); drill
  2 polls for the persisted `migrating` state before killing — deterministic.
- Drill 5 exercises the stop→swap→start choreography with a direct spawn
  (child mode); the production path adds launchd/systemd `stopService`/
  `startService` around the same swap, covered by service unit tests.
