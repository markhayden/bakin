# Evidence: Antfly 0.2.2 Evaluation (repin gate, #843)

## GATE VERDICT: PASS — ADOPT (2026-09-18)

Every rung green, zero code-facing regressions. All three 0.2.0 sharp edges we
filed are fixed: #617 (add-leg wedge → clean progressive backfill, engine
responsive throughout), #618 (inline indexes → honest 400 rejection), #619
(backfill pacing → ~17× faster). The motivating live wedge — forced-rebuild
HTTP starvation — does not reproduce (316 probes / 0 failures / worst 411 ms
across three rebuild cycles, run UNDER a concurrent 20k backfill). No
workaround pins flip: the adapter code needs ZERO changes beyond the pin bump.

Prior gate: `tasks/evidence-antfly-0.2.0.md` (0.2.0 adopted 2026-08-31).
Candidate: v0.2.2 (published 2026-09-14; v0.2.1 2026-09-09 carries the bulk —
~150 PRs incl. HBC cache fill bounding/sharding, enrichment-retry fixes,
table-drop lifecycle, PDF/OCR arc, Metal rerankers/embedders).
Machine: same target M4, macOS 26.6. Eval root: `~/eval-antfly-022/`
(ephemeral data dirs; engine B on 3853/3854 with machine models read-only).
Live 0.2.0 launchd service untouched throughout.

Motivating live evidence on 0.2.0 (2026-09-18, see #843): forced single-table
rebuild starved engine HTTP entirely ~7 min (hbc centroid recompute +
ArtifactRepairRequired retry storm; 44 lifetime wedge-watchdog bounces on the
box), and a resumed migration hit a torn LSM manifest (`lsm backend open
rejected unavailable manifest run` → permanent structural-reconcile retry;
repaired by dropping the green).

## Gate Verdict Table

| Rung | Verdict | Evidence |
|---|---|---|
| T1 binary + checksum | **PASS** | SHA256 `556a0121…` exact vs `v0.2.2/antfly_zig_checksums.txt` |
| T1 version/subcommand | **PASS** | `antfly 0.2.2 (zig runtime)`; `standalone` + all our flags survive; tarball adds `completions/` + THIRD_PARTY_NOTICES (installer tolerates) |
| T1 watchdog byte-grep | **PASS — patterns intact** | `catch-up debt persists` ×1, `StorageReadTemporarilyUnavailable` ×1 present (python byte-count; NOTE: shell `grep -q` false-negatives on this binary) |
| Workaround pin suite | **12/12 PASS — no pins flip** | order_by still 422 (#818 stays), undecodable-media whole-batch poison persists (EMBED_SAFE_RE stays), totals/scan/aknn guards hold |
| search-conformance | **18/18 PASS** | |
| Chaos drills (5) | **ALL PASS** | engine-SIGKILL resume, process-SIGKILL resume, 550-write outage drain, wipe+rebuild, upgrade-under-load |
| #618 inline indexes | **FIXED BY REJECTION** | inline `indexes` at table-create → 400 `invalid create table request` (was: 200 + dead worker). Our per-index path unaffected (201; response now carries `publication_policy: "progressive"` — upstream #558 live by default) |
| #619 backfill pacing | **FIXED — ~17×** | 2k-doc async corpus drains at ~65–70 docs/s sustained (~100/s overall) vs fixed ~4/s on 0.2.0; 20k rebuild ≈ 5 min (was ~83 min) |
| #617 add-leg-to-populated wedge (20k) | **FIXED** | sem2 on a 20k-doc table: `worker_started:true` in 10 s (was never), progressive backfill ~20 docs/s; table reads 200 @ 4 ms, table+engine-wide writes 201 THROUGHOUT — zero probe failures, worst 23 ms (0.2.0: unreadable table, engine-wide write stall, SIGKILL-only durable wedge). Completeness: sem2 converged fully to `ready` ti 20,031/20,031 (all three legs), including WHILE the starvation rung's rebuild cycles ran beside it |
| NEW: reindex-under-load HTTP starvation (2026-09-18 shape) | **PASS** | 3 build/rebuild/drop cycles of the assets shape (55 docs, 15 clipclap media + bge text legs, sync chunks) run WHILE the 20k sem2 backfill drained: 316 status+unrelated-query probes, 0 failures, worst 411 ms. The live 0.2.0 wedge was ~7 min of total HTTP starvation on ONE such rebuild — the 0.2.1 HBC cache-fill bounding (upstream #607/#610) is confirmed effective |
| T1 model compat + pins | **PASS** | clipclap + bge-small both warm and embed on 0.2.2 Metal (pin suite media guards + starvation rung + 20k text backfills); same distributions, file hashes untouched → `model-pins.ts` unchanged |

## Rung Details

**#617 (add leg to populated table):** `wedge617.py`. 20k-doc bge table
(`inline618b`), leg `ready`, then `POST /indexes/sem2` → 201 instantly with
`publication_policy: "progressive"`. Worker started ≤10 s; ti advanced
linearly ~20 docs/s while a 3-probe loop (table read, table write, control-
table write) stayed 200/201 at single-digit ms for the whole observation
window. Note: catch-up on an already-populated table paces slower (~20/s)
than fresh-table backfill (~70/s) — fine for Bakin (we never add legs to
populated tables; this rung exists purely to certify the wedge is gone).

**Starvation rung:** `starve.py`. Sync `full_index` chunks of 10 incl.
`{{remoteMedia url=media_url}}` clipclap docs; DELETE + recreate cycles; probes
every 1 s on `/db/v1/status` + an unrelated table. Total wall 161 s for three
generations. Worst single probe 411 ms (a chunk-0 Metal warmup); no timeouts,
no 5xx.

## Post-Bump Certification (on the repin branch)

- typecheck + lint clean; `tests/integration/antfly` + `search-conformance`
  30/30 against the 0.2.2 binary via `BAKIN_ANTFLY_BIN`.
- Chaos drills 5/5 (run pre-bump against the same binary; no code changed).
- Version guard: WITHOUT the override, the suites now SKIP LOUDLY against the
  machine's 0.2.0 binary ("run `bakin install search`") — upgrade detection
  working in the shipped direction. (Cosmetic: the skip message prints an
  empty detected-version token; behavior correct.)
- Repro scripts: `~/eval-antfly-022/{wedge617.py,starve.py}`; engine B logs
  `~/eval-antfly-022/logs/engine-b.log`.

## Cutover (post-merge, per machine)

1. `bakin install search` — re-provisions the launchd unit, downloads +
   SHA256-verifies 0.2.2, and treats the version change as a REBUILD EVENT
   (derived data dir cleared → repair reindex regenerates; ~5.3k docs at the
   new ~70 docs/s backfill pace ≈ minutes, not the old ~83-min class).
   Bonus: the rebuild wipe clears the 2026-09-18 torn-manifest debris dir
   (`group-2465339552788473605`) and every historical scar.
2. `bakin check search` + `bakin check search-models` green.
3. Doctor search checks green; watch the first reindex converge.

## Release/Wire Notes

- Checksums file now lists FIVE platforms: `Darwin_arm64`, `Linux_arm64`,
  `Linux_x86_64` + NEW `Linux_arm64_gnu`, `Linux_x86_64_gnu` (glibc builds,
  upstream #605/#620). Repin decision: keep the existing (non-gnu) names —
  pin.ts platform map unchanged; note gnu variants for the Docker/CI legs if
  musl issues ever surface.
- Async batch = OMIT `sync_level` (adapter already does); the only accepted
  value remains `full_index` — `none/applied/indexed` are 400s.
- Per-index create body unchanged (`embedder.provider` required — a body
  without it is 400 `invalid_index_request/unsupported index configuration`).
