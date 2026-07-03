# Search & Asset Rebuild — Todo

Plan: `tasks/plan-search-rebuild.md` · Spec: `.claude/specs/search-asset-rebuild.md`
Rule: every commit green (`bun run test` + typecheck). Tag `rebuild/pN` at each phase gate.

## P0 — Evidence & foundation
- [x] P0.1 Build dev antfly from antflydb/antfly origin/main (`6538c0774`, worktree `antfly-main`, zig 0.16.0 from ~/toolchains); recipe in tasks/evidence-search-rebuild.md
- [x] P0.2 Live-verified all verdicts (evidence file has the table). Found+patched+filed upstream double-free crasher (antflydb/antfly#317). Headlines: filter_query FIXED incl. semantic lane; findings 8/9 FIXED; order_by NOT supported on Zig engine (Go-only); totals still page-scoped (keep count:true); responses[] wrapper + _id keys + NEUTRAL _index_scores keys (full_text/legname)
- [x] P0.3 npm @antfly/sdk = 0.0.14 (2026-03-19), 77 SDK commits stale vs main → vendor tarball from same commit as dev binary; re-check npm at T23

## P1 — Engine room
- [x] A1 storage/db.ts keyed multi-db + openNamedDb (f0aa5c34)
- [x] A2 Contract additions + mock + conformance skeleton (211c6390)
- [x] A3 outbox in packages/core/src/search/outbox.ts + typed errors (0389fc70) — 12 tests; drain-loop wiring lands with F2
- [x] A4 blue/green migrator in packages/core/src/search/tables.ts (651c8eea) — 8 tests incl. call-spy boot-does-nothing + park-never-flip + crash-resume
- [x] A5 Memory indexer refactor + enumerateAll() (62d0d0b6; 432 memory tests green). ⚠ F4 NOTE: memory reindex() MUST fail loudly when ctx.runtime is unavailable — silent empty yields would let a thin green table converge and flip (agent finding #1)
- [x] A6 New adapter: translate (a16b18a5) + client (7644632c) + service (8b046474). DESIGN CHANGE vs plan: raw-fetch client with hand-written probe-verified wire types — NO @antfly/sdk dependency at all (vendored tarball + npm-skew problem class deleted); conformance suite vs real binaries is the contract check
- [x] A7 Harness (7edae15a) + regression pins (614a7344). Conformance GREEN vs real dev binary. Real-engine finds: semantic leg requires index names (400 otherwise — registry must pass embedding-leg names via adapterOptions.indexes), /lookup needs {} body, batchRemove counts are attempted-counts. Test-env gotcha: happy-dom preload breaks global fetch — use Bun.fetch in integration tests
- [x] F1 Adapter swap (aea79359, +197/−4210): supervision lattice deleted; installer = D3 stop→swap→restart; ANTFLY_PATH override preserved; dead isSearchAdapterRunning removed
- [x] F2 Writes through outbox (a89d4c1b): all ctx.search writes + watcher hooks journal-first; single-flight pump in server.ts; REAL $set/$inc/$push transform semantics; harness batch→per-item spy recording
- [x] F3 Blue/green live (77dd42d4): versioned physicals everywhere, logical→physical at dispatch, dual-write drains, resume-at-boot, search-migration.ts + global SCHEMA_VERSION DELETED, /api/reindex = blue/green rebuild + search.rebuild.* SSE, resetContentType rides rebuild. `bakin reindex` is the rebuild verb (no separate `search rebuild` alias needed — document at T24)
- [x] F4 THE CUT (7e3ae4c0, 55 files +502/−3347): SDK surface final (no whenReady/warm/mtime/fileToDoc-null), contract members required (embedder/getHealth/rebuildIndexes/IndexOpts deleted), 7 registrations on schemaVersion, memory reindex()→enumerateAll + FAILS LOUDLY on runtime-down (parks, never flips thin), reconcile/warmup/cleanup deleted (orphan sweep → search-orphan-sweep.ts for doctor), boot-does-nothing call-spy test, MCP reindex tool → blue/green
- [x] F5 Arch-test identifier ban (4a2197b5; caught the settings-defaults leak, now documented exception) + engine-room docs (agent running)
- [x] GATE P1 DRILL PASS: SIGKILL mid-flight → write queued (transient) → restart same data dir → queued write landed → hybrid query 468ms with IDENTICAL vector scores (t_vis −0.70407 preserved exactly) + neutral leg names. Dense ranks survive kill/restart with zero degraded window (req 5 proven). Tag rebuild/p1 after docs land

## P2 — Assets vertical
- [x] T1 (1df38170) auto-ingest deleted everywhere; classifier+scan+import lib; watcher-fed tracker w/ debounced asset.unmanaged SSE; zero boot cost
- [x] T2 (ff71a0af) /import/scan + /import routes + audits; manifest 2.1.0
- [x] T3 (4b5eef30) Import tab (scan-on-open, type select, Import All) + nav badge. GOTCHA: nav-badge providers need contributes.eager:true (assets added to eager allowlist)
- [x] T4 (7a71f975) CLI bakin assets scan/import + MCP scan_unmanaged/import tools
- [x] T5 (2e241b63) doctor assets.unimported (autoFixable:false by design; doctor sweep doubles as badge reseeder)
- [x] T6 (e7b9cbff) manifest enrichment schema + apply.ts chokepoint + PATCH route (userEdited field-preserved)
- [x] T7 (c3c5814c) idempotency registry → packages/core/src/media
- [x] T8 (18818688) direct-vision-provider (Anthropic/OpenAI/Google; Zod-strict, never fabricates; audio via Gemini; 20MB skip) + catalog + settings. Default model resolves from curated catalog x configured keys, cheapest-first (haiku→gemini-flash→…); no key ⇒ skipped with reason
- [x] T9 (cda6b583) queue (separate from outbox: billed, bounded retries, manifest is the skip guard) + onAssetWritten triggers + /enrich + CLI + stats hook + recordUsage. meterEnrichmentTurn SKIPPED (pricing hook is image-shaped; revisit T21 if per-call cost display wanted)
- [x] T10 (6fbbe472) detail-page enrichment card (edit locks field, tag apply, re-run)
- [x] T11 (7202de40) caption/ocr/tags/transcript/summary in search docs; media_url for raster+AUDIO; assets schemaVersion 1→2 (blue/green); buildTableConfig emits capability LEGS for every table now
- [x] T12 (c1c9af67) doctor assets.enrichment rows (billed backfill = manual by design)
- [x] GATE P2 → tag rebuild/p2. Unit/integration seams all green (5212/0: manifest→watcher→outbox→engine, import drill, caption-in-search-doc). Live end-to-end with REAL captions folds into the P3 browser gate (needs the dev server + a configured vision key — user-visible there). T24 cleanup noted: client manifest type lacks enrichment field

## P3 — Degradation + global search
- [ ] T13 use-search rewrite (status states, 503 contract, SearchUnavailable); delete fallback + use-search-warm
- [ ] T14 Assets grid fallback deletion + unavailable state
- [ ] T15 SDK hitRenderer registry
- [ ] T16 ScoreOverlay → shared neutral-legs SDK component
- [ ] T17 ⌘K overlay + header entry ⚠
- [ ] T18 hitRenderer registrations (assets/tasks/memory/workflows/team)
- [ ] GATE P3: browser pass on dev rig → tag rebuild/p3

## P4 — Doctor & telemetry
- [ ] T19 System checks (service/outbox/count-mismatch/deep-reconcile sweep)
- [ ] T19b Health-page search panel rewrite (versions, leg health, blue/green rebuild buttons, routes test fix)
- [ ] T20 Telemetry instrumentation + /search-telemetry + health-page section
- [ ] GATE P4 → tag rebuild/p4

## P5 — Tuning & chaos
- [ ] T21 Golden-query set; RRF vs RSF; reranker re-benchmark; weights; "why these defaults" doc
- [ ] T22 Chaos drills (kill mid-backfill, kill mid-migration, 2-day replay, wipe→rebuild, upgrade under load)
- [ ] GATE P5: drill log checked in → tag rebuild/p5

## P6 — Ship
- [ ] T23 Pin to newest release tag; suites vs published artifact
- [ ] T24 Docs sweep + delete ANTFLY_SEARCH_*.md + memory-note updates
- [ ] T25 /agent-skills:test coverage pass + /code-review of full branch diff
- [ ] GATE P6 → tag rebuild/p6
