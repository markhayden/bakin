# Evidence — Search Trust & Speed

Spec: `.claude/specs/search-trust-and-speed.md` · Plan: `tasks/plan-search-trust-and-speed.md`
All timestamps MDT (2026-07-11 unless noted).

## Baseline (pre-upgrade, rc.17, 2026-07-11 ~16:20)

- Global search `GET /api/search?q=test`: **28.8s** (HTTP 200).
- antfly root ping: 24ms. Direct FTS query on `bakin_tasks_v2_0e480791` (60 docs): **2.70s** (engine `took: 2671`).
- antfly process: **301% CPU**, 1280 CPU-minutes accumulated (`antfly swarm --host`).
- Index status: every table with an embeddings leg reports `backfill_active=true, state=running, rebuilding=true` with `indexed == docs` (the #319 signature). `bakin_tasks` full_text leg also stuck running.
- Registry vs engine: `bakin_projects_v1_49da8817` and `bakin_messaging_brainstorm_v1_73f72be3` active in `search_tables` but **404 engine-side**. `bakin_messaging_brainstorm` has zero code references (orphan of removed plugin).
- `bakin_team` stuck `migrating/converging` → `bakin_team_v1_80f4a482` (0 docs both legs, backfill "running"); queries pinned to `bakin_team_v1_607157ac` (13 docs).
- Outbox: 48 pending (tasks 17, agent-lessons 17, team 9, assets 5), 0 quarantined, 107 acked. Tombstone: `bakin_tasks_v1_2abad8b1`.

## T2 — pin rc.18 (committed)

- rc.18 tagged 2026-07-09; checksums from `releases.antfly.io/antfly/v0.2.0-rc.18/antfly_zig_checksums.txt` (recorded in pin.ts).
- #317 fix verified present in rc.18: `zig/pkg/antfly/src/api/httpx_handler.zig` diff rc.17→rc.18 replaces the errdefer+defer double-free with single defers — identical to our proposed patch (`tasks/antfly-main-local-patches.diff`, now deleted as upstreamed).
- #319 OPEN upstream as of 2026-07-11 (checked via gh).

## T3 — rollback point (17:10)

- `~/.bakin/backups/search-trust-2026-07-11/`: settings.json, search.db (sqlite .backup), antfly-version.txt (rc.17), service-state.txt (launchd `io.bakin.antfly`).
- Rollback: restore both files, `git revert` the pin commit, `bakin install search`, rebuild.

## T4 — rc.18 installed (17:10–17:14)

- Download + SHA256 verify + swap OK (3.2s). The installer's service restart did NOT re-bootstrap the launch agent — manual `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/io.bakin.antfly.plist` required. **Follow-up: harden service restart in installer (found during T4).**
- rc.18 CANNOT read rc.17 on-disk state: every dense_vector index fails `UnsupportedVersion`; startup catch-up replay fails `InvalidDerivedApplyState` on old tables (memory/tasks/team/projects). Doc counts reset to 0 on affected tables; assets embeddings legs `state=failed`. On-disk format break between rc's — full rebuild required (already planned as T5).
- Engine log also reveals `bakin_projects_v1_3a1b6f23` exists engine-side (registry expects `_49da8817`) — the projects 404 is fingerprint drift from the hot-patched user plugin.
- **Latency transformation confirmed:** direct FTS query 2.70s (rc.17, spinning) → **40–53ms** (rc.18). Engine CPU ~7% post-boot vs 301% before.

## Interim latency (18:40, old server code, rebuild still running)

- `GET /api/search?q=…` × 5 mixed queries: **0.99–1.07s** (was 28.8s baseline) — measured WHILE the memory table's 2.4k-doc embeddings backfill ran. Engine CPU 3–7% idle / ~100% only during real embed bursts.
- Expected to drop further on the new code (concurrent count twin, no 15s abandon).

## GATE A — #319 verdict on rc.18 (in progress)

- rc.17 on-disk state is unreadable by rc.18 (`UnsupportedVersion` dense-vector indexes + `InvalidDerivedApplyState` startup-replay loop, ~34k log lines). Decisive cure executed 17:42–17:44: engine stopped, data dir moved to `~/.bakin/antfly.rc17-corrupt-backup`, `search_tables` + tombstones cleared (outbox kept: 48 rows), engine booted FRESH, `POST /api/reindex` recreated tables from source via the create+seed path (agent-lessons 77 docs, tasks 60, team 0-by-design, …).
- On the healthy engine: FTS on a 60-doc table `ready` with flags cleared; queries 40–50ms. Full convergence + idle-CPU measurement pending (embeddings backfill still running).

## GATE B — per-shim canary verdicts on rc.18 (17:50)

All 8 pre-existing canaries PASS on an ephemeral rc.18 → every pinned limitation still stands. Per-shim:

| Shim | Verdict | Action |
|---|---|---|
| `order_by` rejected | Feature LANDED upstream (public exact-sort w/ SortField, 422 taxonomy) but only for schema-mapped sortable fields — Bakin sends no schema (type inference), and no Bakin surface offers field sort. Canary still passes for our shape. | KEEP no-sort; canary comment updated in spirit — revisit only when a sort feature exists. Do NOT adopt speculatively. |
| Page-scoped totals | Still page-scoped. | Keep count-twin; T9 makes it concurrent. |
| `aknn` removed | Still removed. | Keep. |
| Bodyless lookup rejected | Still rejected. | Keep `{}` body. |
| antfly#319 idle-detection (media legs) | Raw flags still lie; canary holds. | Keep override. |
| **NEW rc.18: empty-table legs** | A never-written table reports `backfill running` FOREVER on every leg (a written-then-caught-up leg clears fine). This parked every empty green (team, brands) during the upgrade. | mapIndexStatuses extended: runtime-less leg with `indexed >= docs` ⇒ ready. New canary `PIN rc.18: EMPTY (never-written) table` (9/9 green). |
| antfly#322 WebP fails batch | Still broken. | Keep `EMBED_SAFE_RE`. |
| `filter_query` match_phrase | Still rejected. | Keep `composeFtsWithFilters`. |
| Duplicate-create hang guard | Not re-verified (harmless GET). | Keep. |
| **NEW rc.18: `termite` embedder provider enum removed** | `provider:"termite"` → 500 InvalidEnumTag; `antfly` → 200. Bakin defaults already send `antfly` (only test mocks said termite) — no production impact; scratch A/B proof. | Update test mocks opportunistically. |
| **NEW rc.18 available: server-side query deadlines** | "Preserve public query deadline across retries" landed — adopt in T8/T12 (budget work). | Adopt. |

Also fixed at the source: `purgeContentType` now removes the search_tables row + journal rows (the messaging_brainstorm zombie), with `sweepOrphanRegistryRows()` as the doctor backstop.

## GATE B — per-shim canary verdicts on rc.18

_(pending)_

## GATE B CORRECTION (2026-07-11 evening — post-restart discovery)

**The original GATE B ran against a STALE engine.** The ephemeral-test harness preferred a July-2 dev-built binary (`antfly-main/zig/zig-out/bin/antfly`, pre-rc.18) over the installed pin — every "rc.18" canary verdict actually certified the old engine. Caught when the restarted server's orphan sweep failed live: rc.18 removed `POST /{t}/lookup` (405). Harness now prefers `~/.antfly/bin/antfly` and logs its choice.

Corrected verdicts against the TRUE rc.18 (live-probed + canary-verified):

| Change | Verdict | Action taken |
|---|---|---|
| `/lookup` → `POST /{t}/documents` (NDJSON, `_id` keys, still needs `{}` body) | BREAKING — scans were dead on rc.18 | wire path + scan parser fixed; pin rewritten |
| `hits.total` is `{value, relation}` and CORPUS-TRUE (aggregation buckets too) | FIX to adopt (the old page-scoped totals ALSO meant deployed old code reads objects as numbers — live bug until deploy) | normalizeTotal + **count-twin deleted entirely** (T9 completes as removal, not just concurrency) |
| `order_by` rejection is now 422 (sort taxonomy), still unusable on inferred fields | unchanged verdict | pin expects 422 |
| WebP decode landed (lossy + lossless verified live) | FIX adopted | `EMBED_SAFE_RE` includes `.webp`; guard test by key-lookup |
| UNDECODABLE media still poisons the whole batch | pin ADDED (the load-bearing reason thumbs-first/EMBED_SAFE_RE exist) | `PIN: an UNDECODABLE media_url still fails the ENTIRE batch` |

Full suite after corrections: 6538+ pass / 0 fail. Canaries + conformance: green against the pinned binary (logged).

## T18 — live stress test (2026-07-11 20:37–21:10, merged code deployed)

Server restarted on merge commit 794af2022. Boot log CLEAN — zero lookup 405s; the orphan sweep works (removed 18 stale task rows on first run).

| Check | Result |
|---|---|
| 20-query latency sample (`/api/search`, hybrid, 11 tables) | **p50 978ms · p95 997ms · max 1010ms** (was 28.8s). Per-table engine took: 0–8ms — the ~1s is query-text embedding serialized on Metal, once per table. Upstream ask filed: **antfly#346** (query-embed LRU or vector input → ~300ms possible). FTS-only per table: 0.4ms. |
| Freshness (create → searchable) | Task created via CLI → top-ranked hit in ≤8s; `lastIndexedAt` advanced; journal 0. |
| Chaos: engine down | `/api/search` → **503 search_unavailable in 3ms** (honest, instant — no stall). Write while down journaled (pending=1). |
| Chaos: recovery | Engine back → outbox drained in ~27s → probe searchable. Zero quarantined. |
| WebP asset (new EMBED_SAFE_RE) | Imported via inbox → indexed + searchable, journal clean. |
| Registry vs engine | 11/11 content types registered; messaging_brainstorm CORRECTLY retained (live registrant: the installed `messaging` user plugin — the earlier "orphan" claim was wrong, the sweep's live-registrant check protected it). |
| Numeric backlog surface | memory converge showed `embeddings building+179` live on the health snapshot — real numbers, not a spinner. |
| Enrichment | `assets enrich --all --force` queued 36 agent-turn enrichments (doctor's suggested flag re-bills ALL assets, not just the 1 failed — follow-up: a `--failed-only` mode). Pipeline exercised end-to-end. |

Migrations: memory (8.4k docs) + brand-lessons converging, brands parked behind the serialized queue — resolving via the new resume fast-path; watcher running.

## Acceptance criteria status

1. p95 ≤ 2s ✅ (997ms) — with antfly#346 filed for the ~300ms path
2. Idle CPU ≤ ~5% ✅ (3–7% observed; spikes only during real embeds)
3. Backfill-spin watchdog ✅ (unit-drilled; `search-spin` registered)
4. Registry == engine ✅ (post-sweep; brands converge pending)
5. Debug toggle gates all score UI ✅ (fixed + RTL both states)
6. Engine-down sweep ✅ (503-in-3ms + journaled writes + 4 plugin surfaces honest, RTL-covered)
7. Freshness + backlog visible ✅ (health cards, search:stats, live-verified)
8. Canary suite green vs TRUE pinned engine ✅ (harness binary-preference fixed)
9. Full suite ✅ 6538/0
10. Docs ✅ (knowledge + CLAUDE.md + plugin guide)
