# Plan: Search & Asset Management Rebuild

**Spec:** `.claude/specs/search-asset-rebuild.md` (approved — 17 locked decisions D1–D17)
**Branch:** `feat/antfly-zig-migration` (everything on it is malleable)
**Flow:** this plan → `/agent-skills:build` per phase → `/agent-skills:test` coverage pass → ship gate.
On approval, this plan is also saved to `tasks/plan.md` + `tasks/todo.md` in the repo (per planning skill).

## Context

Search + assets have been in a patch-test-patch loop for weeks. Root cause (validated by deep exploration of both Bakin and upstream antfly source): index state is *inferred from filesystem state at boot* (mtime reconcile, orphan detection, adoption sidecars, dedupe-caches-guarding-caches), the adapter carries seven rc.9-era workarounds — several already fixed upstream — plus a 739-line process-supervision lattice, and images have zero derived text (no captioning anywhere). The rebuild: record-keeping instead of inference (durable outbox), antfly as an OS-supervised service behind an adapter-neutral contract, blue/green table migrations (no degraded windows), vision-LLM enrichment written to manifests, explicit import for manual files, and a ⌘K global search UI.

**Load-bearing facts** (verified this session): upstream main is 142 commits past our rc.9 pin (tags → rc.17, artifacts published); `order_by`, rebuilding-flag convergence, CLIP text embed all fixed on main; `sync_level:'aknn'` REMOVED (breaking); `@antfly/sdk` now npm-published; no table aliases (blue/green = client-side pointer, as designed); `antfly swarm` argv verified on main so the service unit reuses today's flags; `cmdk` + `CommandDialog` already in-repo for ⌘K; the runtime adapter is text-only so enrichment needs a direct-vision transport in `packages/core/src/media/` (sibling of `direct-image-provider.ts`, same secret-store); the execution ledger forbids content so the manifest itself is the enrichment idempotency record; `packages/core/src/storage/db.ts` is the sole `bun:sqlite` importer and needs a keyed multi-db export before the outbox can exist.

## Phase map & checkpoint tags

| Tag | Phase | Contents |
|---|---|---|
| `rebuild/p0` | P0 Evidence & foundation | dev binary build recipe, workaround verification, SDK freshness |
| `rebuild/p1` | P1 Engine room | contract, outbox, blue/green, adapter+service rewrite, staged flip F1–F4, arch test |
| `rebuild/p2` | P2 Assets vertical | import flow, enrichment pipeline, audio wiring |
| `rebuild/p3` | P3 Degradation + global search | useSearch rewrite, ⌘K overlay, hitRenderers, ScoreOverlay extraction |
| `rebuild/p4` | P4 Doctor & telemetry | health checks, deep-reconcile sweep, telemetry panel |
| `rebuild/p5` | P5 Tuning & chaos | golden queries, RRF/RSF/reranker/weights, kill-restart drills |
| `rebuild/p6` | P6 Ship | pin to release tag, artifact revalidation, docs sweep, root-doc deletion |

## Commit & rollback strategy

- Conventional commits with scope; **every commit compiles + `bun run test` green + typecheck clean**. Additive modules land with their own tests before anything depends on them.
- **Staged flip, not big-bang:** four separable green cut-points (F1 adapter swap, F2 writes→outbox, F3 blue/green, F4 SDK-surface cut). Each is one revertable commit; reverting F4 alone restores the old registration surface, reverting F1 restores the old adapter. What cannot be additive-first is only F4 (the SDK type change forces all 7 registrations + registry + type to move together — but by then it's pure deletion + mechanical migration; all new *mechanisms* landed tested in Phase A).
- **Contract coexistence via transient optionality:** new `SearchAdapter` members land optional so old adapter compiles until F1/F4 make them required and delete old members. Scaffolding only — gone by F4, no shipped shims.
- Phase checkpoints = annotated tags `rebuild/pN` after the phase gate (suite + build + boot + phase acceptance demonstrated). Docs ride the phase they describe, before the tag.
- Never commit the build-mutated generated-version file; never `git add -A` after a local build.

---

## P0 — Evidence & foundation (S–M)

1. **P0.1** Build dev antfly from `/Users/roscoe/go/src/github.com/antflydb/antfly` origin/main (Zig build; capture exact invocation — it stamps the integration-harness header). AC: binary serves `/readyz`; recipe documented.
2. **P0.2** Verify against the dev binary with OUR query shapes: `filter_query` (zeroing fixed?), image enrichment embedder acceptance (PR #283/#301), `--health-port` readyz semantics, semantic-totals behavior. AC: D2 verdict table updated with live evidence; feeds which workarounds die.
3. **P0.3** Check npm `@antfly/sdk` freshness vs main; if the published version lags the API we need, rebuild the vendored tarball from the SAME commit as the dev binary (never a different one). AC: dependency decision recorded; `aknn`→`full_index` noted for translation work.

## P1 — Engine room

**Phase A (additive, each commit self-tested):**

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| A1 | `storage/db.ts` keyed multi-db refactor + `openNamedDb(path)`; per-file migration ledger | S | ledger tests green; arch test still passes (sole bun:sqlite importer); new multi-db test |
| A2 | Contract additions in `packages/core/src/adapters/search/` — optional `capabilities()`, `mappingFingerprint()`, `TableConfig.legs` (capability model: full-text / text-embedding / media-embedding), `tables.health()` per-leg, generic `scoreBreakdown: Record<legName,number>`; mock adapter updated; conformance-suite skeleton green vs mock | M | old adapter compiles untouched |
| A3 | `src/core/search-store.ts` (`~/.bakin/search.db`) + `search-outbox.ts`: UNIQUE(table,key) coalescing LWW rows, payload-in-row, transform-merge into pending payloads, `search_acked` hash dedupe (replaces team content-hash scan + memory indexed-cache), transient-vs-permanent classification, backoff 1s→30m, quarantine after 5 permanent failures, enqueue-nudged drain + 30s safety tick, inflight crash-reset, dual-write awareness | M | all semantics unit-tested vs temp SQLite + mock adapter |
| A4 | `src/core/search-tables.ts`: `search_tables` registry (logical→physical `{name}_v{schemaVersion}_{fp8}`, fingerprint = content-type schemaVersion + adapter `mappingFingerprint()`), migrator state machine create→dual-write→backfill→converge(stats+leg-health)→flip(tx)→drop, crash-resume from persisted state, `ensure(def)` = zero adapter calls when row matches | M | state machine incl. crash-resume + fingerprint-trigger tested vs mock |
| A5 | Memory indexer prep: row-emitting refactor + true `enumerateAll()` generator (today's `reindex()` yields nothing and mutates offsets — breaks blue/green backfill) | M | existing memory tests green; enumerator output identical to write path. **RISK: subtlest existing code** |
| A6 | New adapter modules alongside old: `client.ts` (thin HTTP, implements full contract), `translate.ts` (main behavior: `full_index`, order_by first-class, filter placement per P0.2 evidence), `service.ts` (launchd plist / systemd user unit / strict-child; mode detection env→platform; `ensureProvisioned` = byte-compare unit file, rewrite+restart on drift — the unit file IS the fingerprint; upgrade = stop→swap→start) + npm SDK swap | L | translation goldens, unit-file goldens, mode-detection tests; old path untouched |
| A7 | Integration harness (ephemeral antfly: port-0 allocation, mkdtemp data/models dirs, model symlink gating, skip-loud when absent) + conformance suite vs real dev binary + D2 workaround-regression pins (each FAILS when upstream fixes) | L | green on this machine; clean skip elsewhere. **RISK: first contact with main's real behavior — surprises surface here by design** |

**Phase F (staged flip, each commit green):**

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| F1 | Adapter swap: factory → new client/service; delete `server.ts` (739), old `search.ts` (955), `legacy-cleanup.ts`, old translation; onboarding provisions the OS service | L | suite green; live smoke: `kill antfly` → launchd restarts → queries recover, zero Bakin involvement; upgrade flow works. **RISK: launchd bootstrap-vs-load edge cases** |
| F2 | Writes through outbox (identity mapping; old boot machinery still present): `buildSearchAPI.index/remove/transform` + file-backed watcher hooks enqueue; drainer starts in `server.ts` | M | watcher-sync + registry tests assert enqueue+drain; kill-antfly-mid-writes integration test: rows wait, drain on recovery |
| F3 | Blue/green live: registrations ensure version rows; queries + drain resolve physical at use time; delete `search-migration.ts`/global `SCHEMA_VERSION`; `schemaVersion` added to all 7 defs; `/api/reindex` → migrator rebuild; `bakin search rebuild`; migrator emits `search.rebuild.{start,progress,complete}` SSE (from `backfill_done` updates) replacing the old `reindex.*` events so the health page's live progress keeps working (event rename + health-page handler update in the same commit) | M | schemaVersion bump → full migration with queries served from blue throughout (integration test); crash mid-backfill resumes; health-page progress renders during a rebuild. **RISK: converge-check vs real leg-health** |
| F4 | THE CUT: SDK surface final (capability legs, no `whenReady`/`mtimeMs`/`fileToDoc`-null/`preserveVirtualDocuments`; keep `reindex()`+`verifyExists`+trimmed maintenance); registry final form; `server.ts:137-143` boot lines deleted; all 7 registrations migrated (tasks, schedule, memory→tailer-feeds-outbox + delete `indexed-cache.ts`/`memory-migration.ts`/boot backfill, team minus scan-dedupe, assets minus hack, agent-lessons, workflows); delete `search-reconcile/startup/warmup/cleanup` (+orphan-sweep body → `runOrphanSweep()` export for doctor), `MTIME_FIELD`, warm plumbing (`/api/search/warm`, `use-search-warm`, SDK export, mechanical warm-field removal from health-page/search-status — full panel rewrite waits for T19b), permission-map updates; contract members required, dead members deleted | L | **boot performs zero adapter calls when state matches (adapter call-spy test)**; grep proves `whenReady\|MTIME_FIELD\|reconcile\|warm` gone; full suite green |
| F5 | Arch-test extension: antfly-identifier ban (`antfly\|clipclap\|bge-` etc.) across core/sdk/src/plugins (factory + settings keys excepted) + engine-room knowledge docs (`search-system`, `adapter-architecture`, `repo-architecture`) | S | planted violation fails the test |

**P1 gate:** conformance green vs dev binary; boot does nothing; kill/restart drill passes; VIS scores intact across antfly restart.

## P2 — Assets vertical

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| T1 | `lib/import-unmanaged.ts` (classifier `isUnmanagedAssetPath`, readdir-only `scanUnmanaged()`, `importUnmanagedFile` lifted from ingest-inbox) + `lib/unmanaged-tracker.ts` (in-memory set, watcher-fed, debounced `asset.unmanaged` SSE); DELETE `ingest-inbox.ts`, activation drain, onSync inbox branch, `assets/inbox` from `sweepOfflineDrops` (content-root `inbox/*.json` half untouched) | M | drop into `assets/inbox/` while running → NO asset, badge count emits; classifier/scan/import unit-tested in temp dirs |
| T2 | Routes `GET /import/scan`, `POST /import {paths?\|all?}` + audit events | S | scan lists inbox leftovers + legacy flat files, never store-managed/trashed; import-all empties list |
| T3 | Import tab in `VersionedAssetGrid` VIEW_OPTIONS (mirror trash-view fetch pattern) + `ImportView.tsx` (per-row type select seeded from suggestion, Import / Import All) + sidebar badge via `nav-badge-providers` slot (health-badge pattern) | M | badge live on drop; imported assets appear in grid without refresh |
| T4 | CLI `bakin assets import [--all\|<path>] [--type]` + MCP tools `bakin_exec_assets_scan_unmanaged`/`_import` | S | CLI round-trips vs running server |
| T5 | Doctor `assets.unimported` check (warn + count + hint; NOT auto-fixable — explicit import is the point) | S | count matches scan; ok at zero |
| T6 | Manifest `AssetEnrichmentSchema` (status/caption/ocrText/suggestedTags/summary/transcript/model/at/forVersion/error/userEdited) + `lib/enrichment/apply.ts` (asset-lock + atomic write chokepoint) + `PATCH .../enrichment` (sets userEdited) | S | old manifests parse; round-trip; userEdited honored |
| T7 | Lift `createIdempotencyRegistry` from `plugins/images/lib/idempotency.ts` → `packages/core/src/media/idempotency.ts`; images re-exports (avoids plugin→plugin import cycle) | S | images tests green unchanged |
| T8 | `packages/core/src/media/direct-vision-provider.ts` (multimodal chat per provider: OpenAI/Google/Anthropic; structured JSON out, Zod-validated, loud rejection — mirrors `assertShimCanHonor`; key resolution via existing `resolveProviderApiKeySource`) + `lib/enrichment/providers.ts` capability catalog (`vision`, `audioInput`, cost tier) + assets settingsSchema fields (enabled/provider/model) | L | mocked-provider tests per provider; invalid JSON ⇒ `failed`, never fabricated; default model resolved against live catalog at build time. **RISK: three provider payload shapes** |
| T9 | Enrichment queue (in-process single-concurrency worker; manifest IS the durable record — status/forVersion skip guard; capped retries then `failed`) + `onAssetWritten` choke-point trigger in asset-core/mutations + backfill route/CLI `bakin assets enrich [--all] [--force]` + `assets.enrichmentStats` hook + `meterEnrichmentTurn` + `recordUsage('assets.enrich')` | M | create/addVersion enqueue; failure never blocks creation; concurrent dupes bill once; done+forVersion skips; --force re-runs |
| T10 | Detail-UI enrichment card (caption/OCR-collapsed/suggested-tag chips with apply/summary/transcript; edit → PATCH; re-run; failed → error+retry) | M | component tests |
| T11 | Search-doc + declaration: caption/ocr_text/suggested_tags/transcript into doc + text-leg template; `image_url`→`media_url` populated for raster AND audio via `buildAssetFileUrl`; audio MIME set; skipped-status for unsupported audio models (blue/green makes the schema change free) | S | image searchable by caption via BM25 in conformance rig; audio row carries media_url |
| T12 | Doctor unenriched/failed-enrichment check + repair=enqueue backfill (manual tier — billed) | S | counts from manifests; repair confirms first |

**P2 gate:** MCP-created asset → enriched manifest → findable by caption text; manual drop → badge → import → searchable; nothing auto-ingests anywhere.

## P3 — Degradation + global search UI

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| T13 | `use-search.ts` rewrite: `status: idle/loading/ok/unavailable/error`, DELETE fallback option + `meta.source:'fallback'`; `/api/search` + plugin routes return `503 search_unavailable` when adapter down; `SearchUnavailable` shared component (doctor link + retry); delete `use-search-warm` | M | hook tests for all five states; `fallback` symbol gone repo-wide |
| T14 | `VersionedAssetGrid`: delete client-side fallback (:208-222) + redundant local debounce; render `SearchUnavailable` when down; browse/filter/tags/trash untouched | S | engine stopped ⇒ explicit panel, browsing works |
| T15 | SDK hitRenderer registry: `registerPlugin({ search: { hitRenderers } })` — plain data-mapping fns `(hit) => { title, subtitle?, href, thumbnailUrl?, icon? }`; ClientRegistry snapshot/subscribe/teardown/HMR-hydration (nav-badge pattern) | M | register/unregister/HMR tests in tests/sdk |
| T16 | Extract `ScoreOverlay` → shared SDK component rendering neutral `scoreBreakdown` legs (kills `bleve\|full_text` sniffing; leg-kind hint from adapter for similarity normalization); grid consumes shared | S | grid badges unchanged visually; neutral-legs path tested |
| T17 | ⌘K overlay in `packages/host/src/components/search/`: `CommandDialog` reuse, hotkey hook (skip inputs), single `useSearch()` vs `/api/search?types=`, grouped by type via renderer registry + default renderer for unknown types, type-filter chips, keyboard nav + Enter deep-link, debug badges, `SearchUnavailable` state; header search button + ⌘K hint; mount in `__root.tsx` inside PluginHost | L | component tests (open/type/navigate/unknown-type/engine-down); browser pass on dev rig. **RISK: cmdk focus interplay in shell** |
| T18 | hitRenderer registrations: assets (thumb `/api/assets/<id>/thumb`, href `/assets/<id>`, subtitle caption), tasks, memory, workflows, team (~10 lines each) | S | each type renders + navigates in overlay |

**P3 gate:** ⌘K over live data returns grouped assets/tasks/memory with working deep links; debug ON shows per-leg scores; antfly stopped shows honest state everywhere.

## P4 — Doctor & telemetry

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| T19 | System checks (health plugin): service provisioned+healthy (rewrite `system-checks/search.ts`), outbox depth/oldest/quarantined, count-mismatch → destructive-tier `rebuild` repair, deep-reconcile sweep (`runOrphanSweep` + memory size-vs-offset stat check) scheduled by the EXISTING doctor interval loop | M | stopped service ⇒ error row; queued-while-down ⇒ depth surfaced; wiped index ⇒ mismatch + rebuild offer |
| T19b | Health-page search panel rewrite: `/search-status` route returns the new shape (per logical table: physical name, schemaVersion, state active/migrating + phase, doc count, per-leg health; plus outbox depth) — `warm` field gone; rebuild buttons stay, now driving blue/green rebuilds with copy reflecting that search stays available during rebuild; progress via the F3 `search.rebuild.*` events; update `tests/plugins/health/routes.test.ts` (incl. the known-failing :317 case) | M | panel shows table versions + leg health; rebuild button runs a live migration with progress while queries keep answering |
| T20 | Telemetry: `recordUsage('search.query')` at query path (+ drain ticks) → `GET /api/plugins/health/search-telemetry` (usage feed + outbox stats + enrichment hook + doctor rows) → health-page "Search" section reusing UsageBarsPanel composition | M | panel renders latency/error/outbox/enrichment series from the usage recorder ONLY (no parallel store) |

## P5 — Tuning & chaos

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| T21 | Golden-query relevance set (checked in, re-runnable) → measure RRF vs RSF, re-benchmark reranker on main, set per-leg weights from data; write "why these defaults" record (knowledge doc) | M | defaults justified by recorded numbers; reranker stays off unless data says otherwise |
| T22 | Chaos drills (scripted, results documented): kill antfly mid-backfill; kill Bakin mid-migration; 2-day-down outbox replay; index wipe → doctor rebuild; upgrade stop-swap-start under load | M | each drill's observed behavior matches spec promises (no degraded window, no lost writes) |

## P6 — Ship

| # | Task | Size | Acceptance criteria |
|---|---|---|---|
| T23 | Pin bump to newest published release tag + checksums; SDK aligned to same tag; **full conformance + antfly suites vs the published artifact** (D1 skew catch) | M | suites green on the pinned artifact, not just dev builds |
| T24 | Docs sweep: knowledge docs (search-system, search-plugin-guide, search-api-reference, multimodal-search, assets-versioning, assets-plugin, memory-plugin, doctor-and-health-checks, images-plugin, usage-recording, shared-ui-patterns, dev-loop if touched), CLAUDE.md blocks (Search, Search Indexing, Versioned Assets, CLI, onboarding), docs-site pages, README verify-pass; DELETE `ANTFLY_SEARCH_REMEDIATION_PLAN.md` + `ANTFLY_SEARCH_FOLLOWUP_REVIEW.md`; update stale memory notes (antfly-rc9-validation, antfly-pr457-parked) | M | grep for dead concepts (`ingest-inbox`, `registerFileBackedContentType` old shape, `useSearchWarm`, `source:'fallback'`, mtime reconcile) returns nothing in docs |
| T25 | Final `/agent-skills:test` coverage pass + `/code-review` of the full branch diff | M | coverage gaps closed; review findings addressed |

## Verification (end-to-end, per gate)

- **P1:** conformance vs ephemeral dev antfly; adapter call-spy proves boot-does-nothing; kill antfly → outbox queues → OS restarts service → drain empties → hybrid queries return with vector legs scored.
- **P2:** full asset lifecycle drill via MCP + UI + CLI; import drill; enrichment visible in manifest + detail UI + search hits.
- **P3:** browser pass (dev rig): ⌘K, chips, deep links, debug badges, unavailable states.
- **P5:** chaos-drill log checked in.
- **P6:** everything green against the shipped artifact; docs greps clean.

## Riskiest items (watch list)

1. **A7/F1** — first live contact with antfly main + launchd session quirks (bootstrap vs load fallback built in).
2. **A5** — memory indexer generator refactor (subtlest existing code).
3. **F3** — converge-check against real leg-health semantics (park-and-surface on timeout, never flip early).
4. **T8** — three vision-provider payload shapes + structured output validation.
5. **T17** — cmdk focus/keyboard interplay inside the shell.

## Explicitly deleted (the point of the exercise)

`server.ts` supervision lattice (739), old `search.ts` (955), `legacy-cleanup.ts`, `search-reconcile.ts` (383), `search-startup.ts` (250), `search-warmup.ts`, `search-cleanup.ts` (timer), `search-migration.ts` + global SCHEMA_VERSION, memory `indexed-cache.ts` + `memory-migration.ts` + boot backfill, team scan-dedupe, assets `fileToDoc:null` hack + `ingest-inbox.ts` auto-triggers, warm plumbing end-to-end, `MTIME_FIELD`, client-side search fallback, vendored rc.2 SDK tarball, both root ANTFLY_SEARCH_*.md docs.
