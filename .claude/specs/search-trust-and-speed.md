# Search Trust & Speed

**Status:** Draft — pending approval
**Date:** 2026-07-11
**Driver:** Search feels slow and hit-or-miss since the Zig antfly migration. Global search measured at 28.8s live. Expected results missing. This initiative makes search fast, trustworthy, and observable — or it isn't worth having.

## Objective

After this work, on this machine:

1. **Global search answers in ≤ 2s** (warm, healthy engine), with visible progress feedback and honest partial results when a source can't meet its deadline. Never a silent 15–30s stall.
2. **The engine is idle when there is nothing to index.** The antfly#319 spin (backfills running forever at 300% CPU) is empirically resolved by the rc.18 upgrade + clean rebuild, or detected within minutes by a watchdog with a one-click repair.
3. **Every registered content type is actually queryable.** No registry rows pointing at engine-side 404s, no migrations parked forever, no orphaned types.
4. **Indexing is observable:** per-table freshness timestamps, numeric backlog depth, journal state — a user can always answer "did my thing get indexed, and if not, where is it stuck?"
5. **Debug scoring is trustworthy:** the toggle actually gates it, and in debug mode each hit shows per-leg scores AND which fields matched.
6. **No silent degradation anywhere:** all search surfaces (global + memory/tasks/schedule/workflows/assets) implement loading / empty / error / engine-down states per D11.
7. **Every shim whose upstream fix landed in rc.18 is deleted**, verified by the canary tests built for exactly this moment.

## Root-Cause Findings (audit 2026-07-11, live)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | antfly#319 backfill spin: every table reports `backfill_active=true, state=running` with `indexed == docs`; engine at 301% CPU, 1280 CPU-min accumulated | `GET /db/v1/tables/*/indexes` live; `ps` |
| F2 | Pure FTS query on 60-doc table: 2.7s engine-side (`took: 2671`) — starved by F1 | direct curl |
| F3 | Global search 28.8s: `Promise.all` fan-out gated by slowest table; 15s client timeout + hidden FTS retry + sequential count-twin query | `client.ts:44,240-267`, `search-query.ts:128` measured live |
| F4 | `bakin_projects_v1_49da8817` + `bakin_messaging_brainstorm_v1_73f72be3` registered `active` but 404 engine-side. messaging_brainstorm has zero code references (orphan of a removed plugin); projects belongs to the installed user plugin | `search.db` vs `/db/v1/tables` |
| F5 | `bakin_team` stuck `migrating/converging` — new table `80f4a482` has 0 docs in both legs, backfill "running"; queries pinned to old table indefinitely | `search_tables` row |
| F6 | ⌘K debug overlay: `const debug = useDebug()` binds the tuple (always truthy) — score badges render for everyone, toggle inert | `global-search-overlay.tsx:91` |
| F7 | D11 violations: memory shows misleading empty state on engine-down; tasks silently falls back to client-side substring match; schedule/workflows consume only `.results` (no loading/error/unavailable) | UX audit |
| F8 | No freshness timestamps, no numeric per-leg backlog anywhere | `SearchHealthTable` type |
| F9 | Outbox: 48 pending rows, 0 quarantined; tombstone `bakin_tasks_v1_2abad8b1` pending sweep | `search.db` |

## Upstream Facts (verified against antflydb/antfly main @ 2026-07-10)

- **v0.2.0-rc.18** (tagged 2026-07-09) is the latest published release. Checksums fetched from `antfly_zig_checksums.txt`:
  - darwin-arm64 `e2b0df4461d78782d11a4e2740f299844a9a6cfed4df1a167c632a5b9ecdafe1`
  - linux-arm64 `c74b3ea59b3e99f46cb8d3bbc723b9fd672b8a62779ca050ce11de1f5044a1ad`
  - linux-x64 `e3d606d153f7713f389e414b40b855850347c4f67aec8827217e6076cc31a0be`
- **antfly#317** (batch double-free) **fixed in rc.18** — verified in `httpx_handler.zig` diff (errdefer/defer double-free removed). Action: rewrite pin.ts comment; nothing else (no code workaround existed).
- **antfly#319** (backfill never completes) **still OPEN**. Idle-detection workaround + canary stay. Empirical check on rc.18 required; if still broken, file updated repro upstream.
- rc.17→rc.18 delta includes: **public query deadlines** (preserved across read retries), **sort contract** (`order_by` work: public sort field contract, sort tuple validation), **per-item embedding error policy** (#338), better 400 messages for schema/create errors.

## Decisions (user-resolved 2026-07-11)

| D# | Decision |
|----|----------|
| SD1 | Pin rc.18. Never build from main. Keep deterministic checksummed installs. |
| SD2 | ~2s realistic wall budget for `/api/search`, per-table deadlines, honest partials, progress feedback in UI. Budget is a tunable (`settings.search`), not a magic constant. |
| SD3 | Hybrid FTS+semantic stays the default everywhere. Per-query seatbelt: a source that can't answer inside its deadline degrades to FTS-only (or is dropped if even that misses), response labeled `degraded`/`partial`, subtle UI chip, telemetry counter. |
| SD4 | Watchdog on backfill spin: error-level health finding + browser notification + one-click blue/green rebuild repair. No automatic rebuilds. |
| SD5 | Visibility scope: freshness timestamps + numeric backlog depth + matched-reason debug — all three. |
| SD6 | Full green light for live ops on this machine (binary swap, full rebuild, server restarts, stress-testing with real content). Backup settings + `search.db` registry before the upgrade for one-command rollback. |
| SD7 | Tech-debt-first: no back-compat shims. Delete every workaround whose upstream fix is canary-verified in rc.18. |

## Workstreams

### WS1 — Engine upgrade + state repair
- Bump `pin.ts` to rc.18 (+ new checksums, rewritten known-issues comment: #317 fixed, #319 open).
- Backup `~/.bakin/settings.json`, `~/.bakin/search.db`, and note current binary version for rollback.
- `bakin install search` (stop → swap → restart via the OS-service upgrade path).
- Drop the orphaned `bakin_messaging_brainstorm` registry row (add an orphan-content-type sweep to the consistency check so plugin removal can't leak rows again).
- Repair `bakin_projects` (blue/green rebuild recreates the physical table).
- Resolve the stuck `bakin_team` migration (force-restart the migration on the healthy engine).
- Full clean rebuild of every table; confirm: backfills reach `ready`, engine CPU settles ≤ ~5% idle, tombstone swept, outbox drains to 0.
- **Gate:** empirical #319 verdict on rc.18 (converges cleanly vs still spins) — recorded in the spec before WS3 tuning.

### WS2 — Shim removal (canary-driven)
For each workaround, run its canary against rc.18; delete the shim when the canary flips, keep + re-pin when it doesn't:
- `order_by` rejection → if sort landed publicly: implement `Query.sort → order_by`, delete pin.
- Client-side 15s abandon → adopt **server-side query deadlines**; client timeout becomes deadline + small grace. Delete/shrink the semantic-embed-timeout degrade retry if deadlines make it obsolete (the SD3 seatbelt supersedes it).
- Page-scoped totals count-twin (`client.ts:252`) → delete if totals are corpus-true now; otherwise make the twin **concurrent**, never sequential.
- Bodyless lookup `{}` body → delete if legal.
- `filter_query` match_phrase rejection / `composeFtsWithFilters` → delete if fixed.
- WebP `EMBED_SAFE_RE` exclusion (assets) → delete if per-item embedding error policy (#338) covers it.
- Duplicate-create hang guard (`createTableTolerant`) → keep unless verified fixed.
- #319 idle-detection override → keep unless WS1 gate proves convergence.
- Update `workaround-regressions.test.ts` to match the new reality (pins for what remains, deletions for what's gone).

### WS3 — Query path: latency contract
- `settings.search.queryBudgetMs` (default 2000) + per-table deadline derived from it; sent server-side (rc.18 deadlines), enforced client-side with grace.
- `multiQuery`: always parallel; per-table results race their deadline — miss ⇒ that table returns `{ degraded | omitted }` marker, never gates the response.
- Kill the cold `available()` pre-gate cost on the hot path (rely on per-table failure isolation; keep the cached probe for the 503 mapping only when everything fails).
- Response metadata: per-table `tookMs`, `degraded`, `omitted` — feeds telemetry, health, and the UI chip.
- ⌘K progress feedback: staged loading state ("searching N sources…", sources resolve as they land) + partial-results chip when any table degraded/omitted.
- Telemetry: per-table timing histogram → health search-telemetry tiles (slowest table by p50/p95).

### WS4 — Engine-health watchdog
- New health check (health plugin, engine-status–based, adapter-neutral surface): two samples N minutes apart where a leg is `backfill_active` with **zero `total_indexed` progress** and no outbox/enrichment inflow ⇒ error finding + browser notification (notify-once per incident) + repair action = blue/green rebuild of that table.
- Surfaces: doctor, health dashboard search card, `bakin check search`.

### WS5 — Indexing visibility
- Freshness: per-table `lastIndexedAt` (last successful outbox ack per logical table — derivable from `search_acked`/drain bookkeeping) + `lastRebuildAt` (registry). Extend `SearchHealthTable`, health cards, `bakin search:stats`.
- Numeric backlog: per-leg `docs-indexed` deltas, journal pending count, enrichment queue depth — replace the binary rebuilding icon with real numbers/percentages.

### WS6 — Debug & D11 compliance
- Fix F6 (`const [debug] = useDebug()`).
- Matched-reason: in debug mode, request field-level match info and render "matched: title, description" per hit (debug-only cost).
- memory: handle `status === 'unavailable'` → `SearchUnavailable` panel.
- tasks: engine-down ⇒ visible signal on the board (banner/chip: "search degraded — substring filter") instead of silent substring fallback; loading indicator while a search is in flight.
- schedule + workflows: same treatment (loading + unavailable signal).
- Consistency: all surfaces use the same SDK affordances (`SearchUnavailable`, shared chip/banner component).

### WS7 — Live stress test (this machine, real data)
- Seed real content: generate images (assets pipeline + enrichment), create/complete tasks, memories, schedule entries.
- Verify each lands in its index within a bounded window (freshness surface from WS5 is the measuring stick).
- Measure: 20-query latency sample across surfaces (⌘K, per-plugin, CLI) — p50/p95 recorded in the evidence file.
- Chaos drills: kill engine mid-drain (outbox holds + resumes), kill mid-rebuild (parks, never flips thin), engine-down UX sweep across all six surfaces.
- Evidence file: `tasks/evidence-search-trust-and-speed.md` with every measurement.

### WS8 — Docs
- `.claude/knowledge/search-system.md` + `search-plugin-guide.md`: latency contract, deadlines, degrade semantics, watchdog, freshness surfaces, removed shims.
- CLAUDE.md Search bullet: rc.18 pin, updated open-issue list.
- `pin.ts` comment block rewritten (it is load-bearing documentation).
- README if user-visible behavior changes warrant it.

## Acceptance Criteria

1. `curl /api/search?q=…` p95 ≤ 2s across a 20-query mixed sample, all tables healthy (evidence file).
2. antfly idle CPU ≤ ~5% with empty outbox and no enrichment (measured ≥ 10 min after rebuild).
3. Zero tables with `backfill_active=true` at steady state, or the watchdog fires within its window (drill-tested by simulating a stuck status).
4. `search_tables` registry rows == engine tables (no 404 rows, no orphans, no parked migrations, no tombstones).
5. Debug toggle: OFF ⇒ zero score UI anywhere; ON ⇒ scores + matched-fields on every search surface.
6. Engine-down sweep: all six surfaces show the honest unavailable/degraded state; nothing silently substitutes.
7. Freshness + backlog numbers visible on Health cards and `bakin search:stats`.
8. Every deleted shim has its canary deleted/updated; every kept shim has a live pin; `workaround-regressions.test.ts` green.
9. Full suite `bun run test` green; new behavior covered (budget/degrade unit tests, watchdog check tests, D11 component tests).
10. Docs updated per WS8.

## Commit Strategy (rollback checkpoints)

Branch `feat/search-trust-and-speed` in a **worktree** (main checkout stays untouched). Conventional commits, each a working checkpoint:

1. `fix(host): gate ⌘K score overlay on the debug toggle` — independent, ships first.
2. `chore(search): pin antfly v0.2.0-rc.18` — pin + comment rewrite only.
3. `fix(search): sweep orphaned content-type registry rows` — messaging_brainstorm cleanup + consistency-check coverage.
4. `refactor(adapter-antfly): remove rc.18-fixed workarounds` — one commit per shim family (sort, deadlines, count-twin, lookup, filters, webp) so any single removal can be reverted alone.
5. `feat(search): per-table query budget with honest degrade` — WS3 server side.
6. `feat(host): global search progress + partial-results feedback` — WS3 client side.
7. `feat(health): backfill-spin watchdog with rebuild repair` — WS4.
8. `feat(search): freshness timestamps + numeric backlog` — WS5.
9. `fix(plugins): honest engine-down states in memory/tasks/schedule/workflows` — WS6.
10. `feat(search): matched-field debug explanations` — WS6.
11. `docs(knowledge): search latency contract + rc.18 upgrade notes` — WS8.

Live-ops steps (binary swap, rebuild) are not commits but are recorded in the evidence file with timestamps; rollback = restore settings/search.db backup + `pin.ts` revert + `bakin install search`.

## Boundaries

- **Always:** keep D17 (no antfly identifiers upstream of the adapter); boot performs zero engine calls; outbox rows are never lost; totals/counts honest or absent — never fabricated; all tests mock content-dir + OpenClaw home per CLAUDE.md.
- **Ask first:** any change that would drop indexed data outside the planned clean rebuild; any new runtime dependency; touching the Pi/OpenClaw adapters.
- **Never:** build antfly from source for production use; parallel spend/stat systems; silent client-side search substitutes; auto-rebuild without a user click (SD4).

## Open Verifications (resolved during WS1/WS2, recorded here)

- [ ] Does rc.18 converge backfills on a clean rebuild? (#319 empirical)
- [ ] Did `order_by`/sort land in rc.18's public query API?
- [ ] Are totals corpus-true in rc.18?
- [ ] Does the per-item embedding error policy cover WebP (#322)?
- [ ] Is bodyless lookup legal / `filter_query` match_phrase accepted in rc.18?
- [ ] What field-match/highlight info can rc.18 return for matched-reason debug?
