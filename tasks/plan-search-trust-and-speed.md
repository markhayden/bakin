# Plan — Search Trust & Speed

**Spec:** `.claude/specs/search-trust-and-speed.md` (approved 2026-07-11)
**Branch:** `feat/search-trust-and-speed` in a dedicated worktree (`../bakin-wt-search`) — main checkout never flips branches.
**Evidence file:** `tasks/evidence-search-trust-and-speed.md` — every live measurement, gate verdict, and ops action with timestamps.
**Working checklist:** `tasks/todo.md`

## Dependency graph

```
P0 T1 (debug-toggle bug)            — independent, ships first
P1 T2→T3→T4→T5 (pin → backup → install → rebuild+repairs) → GATE A (#319 verdict)
P2 T6 (canary sweep on rc.18) → GATE B (per-shim verdicts) → T7–T11 (per-shim removals)
P3 T12→T13 (server budget/degrade → client progress UI)     [needs GATE B deadline verdict]
P4 T14 (watchdog)  T15 (freshness+backlog)                  [parallel, need healthy engine]
P5 T16 (D11 fixes) T17 (matched-reason debug)               [parallel, UI-level]
P6 T18 (stress test + chaos drills) → T19 (docs) → T20 (PR + deploy to live worktree)
```

Phases P4 and P5 can interleave; everything else is ordered. Checkpoints = the commit strategy in the spec §Commit Strategy (one commit per task unless noted).

---

## P0 — Independent trust fix

### T1 — Fix ⌘K debug-toggle bug
- Change `packages/host/src/components/search/global-search-overlay.tsx:91` to `const [debug] = useDebug()`.
- Add a component test: toggle OFF ⇒ no `ScoreOverlay` rendered; ON ⇒ rendered (RTL, per CLAUDE.md test rules incl. `rtl-settle`).
- **Accept:** test proves both states; manual check in browser.
- **Commit:** `fix(host): gate ⌘K score overlay on the debug toggle`

## P1 — Engine upgrade + state repair (live ops)

### T2 — Pin rc.18
- `pin.ts`: version `0.2.0-rc.18`, three new checksums, comment rewritten (#317 fixed in rc.18 — delete `tasks/antfly-main-local-patches.diff`, it landed verbatim; #319 open).
- **Accept:** `bun test` unit tests touching pin pass; checksums match `antfly_zig_checksums.txt` (recorded in evidence).
- **Commit:** `chore(search): pin antfly v0.2.0-rc.18`

### T3 — Backup + rollback point (ops, no commit)
- Copy `~/.bakin/settings.json`, `~/.bakin/search.db`, record `antfly --version` + service unit state into evidence file.
- **Accept:** documented one-command rollback (restore files, revert pin, `bakin install search`).

### T4 — Install rc.18 (ops, no commit)
- `bakin install search` (stop → swap → restart). Verify binary version, service healthy, `/db/v1/status` OK.
- **Accept:** engine up on rc.18; existing tables still queryable (blue/green means old tables survive binary swap).

### T5 — State repair + full clean rebuild (ops + small code, one commit)
- Code: orphaned-registry-row sweep — drop rows whose content type has no live registrant (kills `bakin_messaging_brainstorm`); wire into `search-consistency` check + repair so plugin removal can't leak again.
- Ops: force-restart the parked `bakin_team` migration; rebuild `bakin_projects` (recreates 404'd physical); `bakin reindex --rebuild` all tables; confirm tombstone sweep; outbox drains to 0.
- **Accept (GATE A):** all legs `state=ready, backfill_active=false`; antfly idle CPU ≤ ~5% sustained 10 min; registry rows == engine tables. **Record the #319 verdict** — if rc.18 still spins, keep idle-detection workaround + file updated upstream repro; if it converges, schedule workaround removal in T6.
- **Commit:** `fix(search): sweep orphaned content-type registry rows`

## P2 — Shim removal (canary-driven)

### T6 — Canary sweep against rc.18 (GATE B)
- Run `tests/integration/antfly/workaround-regressions.test.ts` + targeted probes against live rc.18. Record per-shim verdict in evidence: sort/order_by, corpus-true totals, bodyless lookup, filter_query match_phrase, per-item embedding errors (WebP #322), duplicate-create hang, #319 idle-detection, query deadlines (new — probe the deadline param shape from upstream openapi/docs in the antfly repo).
- **Accept:** every Open Verification in the spec has a written verdict.

### T7–T11 — Per-shim removals (one commit each, only where GATE B says fixed)
- T7 sort: `Query.sort → order_by` in translate.ts, delete no-sort pin. (If landed.)
- T8 deadlines: send server-side deadline; client timeout = budget + grace; delete semantic-embed-timeout retry if obsolete.
- T9 totals: delete count-twin, or make it concurrent if still needed.
- T10 lookup body / filter_query / `composeFtsWithFilters`: delete what flipped.
- T11 WebP `EMBED_SAFE_RE`: delete if #338 policy covers it; verify a real .webp asset indexes.
- Each: update `workaround-regressions.test.ts` (delete pin or keep canary), full adapter test file green.
- **Commits:** `refactor(adapter-antfly): remove rc.18-fixed workaround — <shim>`

## P3 — Latency contract

### T12 — Per-table budget + honest degrade (server)
- `settings.search.queryBudgetMs` (default 2000, zod-validated, settings UI via existing schema path).
- `multiQuery`: per-table deadline race; miss ⇒ degrade to FTS-only attempt if time remains, else omit with marker. Response metadata per table: `tookMs`, `degraded`, `omitted`. Remove blocking cold `available()` from the hot path.
- Telemetry: per-table timings into the existing search-telemetry surface (no parallel stat system — extends `recordUsage`/search telemetry already there).
- Unit tests: budget enforcement, degrade ordering, omission markers, metadata shape (mock adapter).
- **Accept:** simulated slow table (mock) never gates the response; metadata correct.
- **Commit:** `feat(search): per-table query budget with honest degrade`

### T13 — ⌘K progress + partial-results UI
- `useSearch` exposes per-source progress + `partial`/`degraded` metadata; overlay shows staged progress ("searching…" resolving per source) and a subtle partial-results chip with tooltip naming the slow/omitted source. Same chip available to plugin surfaces via SDK.
- RTL tests for chip + progress states.
- **Accept:** visible in browser with a throttled mock; tests green.
- **Commit:** `feat(host): global search progress + partial-results feedback`

## P4 — Observability

### T14 — Backfill-spin watchdog
- Health-plugin check: two samples ≥ N min apart, leg `backfill_active` with zero `total_indexed` progress and empty outbox inflow ⇒ error finding + notify-once + repair handler = blue/green rebuild of that table.
- Tests: simulated stuck status fixtures; repair invokes rebuild engine (mocked).
- **Accept:** drill — freeze a mock status, watchdog fires within window, repair path runs.
- **Commit:** `feat(health): backfill-spin watchdog with rebuild repair`

### T15 — Freshness + numeric backlog
- `lastIndexedAt` per logical table (drain-ack bookkeeping in `search.db`), `lastRebuildAt` (registry). Extend `SearchHealthTable` type, health cards, `bakin search:stats`; replace binary leg icon with numeric backlog (per-leg pending, journal depth, enrichment depth).
- **Accept:** create a task/asset ⇒ freshness timestamp advances within seconds on the health card and CLI.
- **Commit:** `feat(search): freshness timestamps + numeric backlog`

## P5 — Surface trust

### T16 — D11 engine-down compliance (memory/tasks/schedule/workflows)
- memory: render `SearchUnavailable` on `status==='unavailable'`.
- tasks: visible "search degraded — substring filter" banner when falling back; loading indicator during in-flight search.
- schedule + workflows: loading + unavailable signals (shared SDK affordance).
- RTL tests per surface (unavailable + loading states).
- **Commit:** `fix(plugins): honest engine-down states in memory/tasks/schedule/workflows`

### T17 — Matched-reason debug
- Debug-mode-only: request field-match info (shape per GATE B probe — highlight/fields support in rc.18), render "matched: title, description" beside leg scores in `ScoreOverlay` consumers.
- **Accept:** debug ON shows matched fields on ⌘K + plugin surfaces; OFF shows nothing; no extra query cost when OFF.
- **Commit:** `feat(search): matched-field debug explanations`

## P6 — Prove it, document it, ship it

### T18 — Live stress test + chaos drills
- Seed: generate ≥3 images (enrichment pipeline), ≥10 tasks, memories, schedule entries; verify each indexed within bounded window (T15 freshness = measuring stick).
- Latency: 20-query mixed sample via `/api/search`, plugin routes, CLI — p50/p95 into evidence. Target: p95 ≤ 2s.
- Chaos: kill engine mid-drain (outbox holds, resumes); kill mid-rebuild (parks, never flips thin); engine-down UX sweep across all six surfaces (screenshots via Playwright).
- **Accept:** spec acceptance criteria 1–7 all evidenced.

### T19 — Docs
- `.claude/knowledge/search-system.md`, `search-plugin-guide.md`, CLAUDE.md search bullet, pin comment (done in T2), README if warranted.
- **Commit:** `docs(knowledge): search latency contract + rc.18 upgrade notes`

### T20 — PR + deploy
- Full suite `bun run test` green in the worktree. PR → merge to main. Update the live worktree (`../bakin-wt-pi`), restart 3737, re-verify ⌘K live, kill any stray dev instances (ports clean).
- **Accept:** live server on merged code; final latency spot-check recorded.

---

## Risks / contingencies

- **rc.18 does not fix #319 (likely — issue open):** keep workaround; the watchdog (T14) + budget (T12) still deliver the user-facing goals; file updated upstream repro with our evidence. The initiative does NOT depend on upstream fixing it.
- **rc.18 regresses something rc.17 did:** GATE A catches it before any shim removal; rollback = T3 backup (one command).
- **Query deadlines not actually exposed in rc.18's public API:** T8 falls back to client-side-only budget enforcement (T12 design works either way).
- **Rebuild churns long on 2.4k memory docs:** blue/green keeps search available; run overnight-style, measure, record.
