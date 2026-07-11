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

## GATE A — #319 verdict on rc.18

_(pending)_

## GATE B — per-shim canary verdicts on rc.18

_(pending)_
