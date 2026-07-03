# SPEC: Search & Asset Management Rebuild

**Status:** Draft — awaiting approval
**Date:** 2026-07-02
**Branch:** `feat/antfly-zig-migration` (all prior branch content is malleable; nothing on it is sacred)
**Supersedes:** `ANTFLY_SEARCH_REMEDIATION_PLAN.md`, `ANTFLY_SEARCH_FOLLOWUP_REVIEW.md` (both deleted when this lands)
**Priority:** Reduce tech debt. Single-user machine. Zero backwards compatibility, zero shims.

---

## 1. Objective

End the patch-test-patch cycle on search and assets permanently. Ship a bulletproof:

1. **Antfly adapter** — validated against upstream main, carrying zero unexplained workarounds.
2. **Asset pipeline** — every Bakin-created asset automatically indexed, embedded, and enriched with real derived metadata (captions, OCR, tags) so search finds assets by *what they are*, not just their filenames.
3. **Import flow** — manually-dropped files are never auto-touched; they're surfaced and imported explicitly.
4. **Global search** — ⌘K takeover overlay returning assets, tasks, memory, workflows — everything — grouped, filterable by type, with debug scores.
5. **Boot that does nothing** — no scans, no reconcile, no warming rituals. Kill/start Bakin or antfly at any time with no degraded window.

### Root-cause thesis (validated by code exploration)

The bug farm is one design choice: **inferring index state from filesystem state at boot** (mtime reconcile, orphan detection, add-storms, dedupe caches guarding caches, adoption sidecars). The rebuild replaces inference with **record-keeping**: writes are journaled durably at write time, and boot merely resumes a drain.

### Design principle: Antfly is only the default adapter

Every piece of this rebuild lives behind the `SearchAdapter` contract. Other search adapters will be added later, so **nothing antfly-specific exists upstream of `packages/adapter-antfly/`** — not in core, not in the SDK, not in plugins, not in the UI. See D17 for the concrete implications.

---

## 2. Locked Decisions

Each decision below was interviewed and locked. These are not up for silent re-litigation during build.

### D1. Antfly foundation: main during dev, tag at ship
- Develop and validate against **local builds of `antflydb/antfly` main** (checkout: `/Users/roscoe/go/src/github.com/antflydb/antfly`). Zig engine only (`antfly-zig-*` artifacts) — the v0.2 enrichment/inference feature set does not exist in the Go server.
- Ship pinned to **the newest published release tag at finish** (tags currently through `v0.2.0-rc.17`; artifacts publish continuously to `releases.antfly.io`). The `pin.ts` pattern (version + per-platform SHA256, verify-then-commit install) is retained — it's good.
- **Mandatory final phase: re-validate the entire integration suite against the shipped tag's published artifact** to catch dev-vs-ship skew.
- SDK: drop `vendor/antfly-sdk-0.2.0-rc.2.tgz`. Use npm-published `@antfly/sdk` (upstream now has OIDC trusted publishing) matching the shipped tag; if the npm tag lags, rebuild the vendored tarball from the same tag — never from a different commit than the binary.
- **Breaking change to absorb immediately:** `sync_level: "aknn"` was removed upstream → use `full_index`.

### D2. Workaround policy: zero unexplained workarounds
Every rc.9 workaround is re-tested against main. Upstream fix evidence already found:

| Workaround | Status on main | Action |
|---|---|---|
| `order_by` rejected | Fixed (first-class + `_sort` cursors) | Delete workaround |
| `rebuilding=true` never finalizes | Fixed (dense-replay convergence, `58c582ba4` et al.) | Delete readiness heuristic |
| CLIP text embed `InputArityMismatch` | Fixed (PR #280) | Delete skip logic |
| Image enrichment rejects embedders | Addressed (PR #283, #301) | Verify + delete |
| `filter_query` zeroes hits | Likely fixed (restructured) | Verify with our query shapes; delete filter-in-AST if confirmed |
| Page-scoped totals | Partially fixed (FTS exact; semantic still candidate-bounded) | Keep `count:true` companion **only** for semantic totals, documented |
| No server-side query cancellation | Not fixed (Zig) | Keep abandon-on-timeout, documented |

Rule: **any surviving workaround must have (a) a comment naming the upstream issue, (b) a pinned regression test that FAILS when upstream fixes it** — so dead workarounds announce themselves. Anything found broken on main that blocks us gets an upstream issue filed (we have full source access to bisect).

### D3. Lifecycle: OS-supervised service, Bakin as pure client
- `bakin install search` (and boot-time self-heal) provisions a **launchd LaunchAgent (macOS) or systemd user unit (Linux)** running `antfly swarm` on `127.0.0.1:3738`, data under `~/.bakin/antfly/`, `KeepAlive`/`Restart=always`. The OS owns start, keep-alive, and crash-restart. Fully automated — the user never manages antfly.
- **Fallback mode** (no service manager: Docker rig, CI, tests): strict child — spawn on boot, kill on exit, no adoption, no sidecar. Ephemeral environments don't need warm restarts.
- The adapter becomes an **HTTP client + health reporter** (~a few hundred LOC). Deleted: sidecar `instance.json`, adoption probes, restart ladder, single-flight guards, the three kill paths — the entire 739-LOC supervision lattice.
- Upgrades: installer stops the service, swaps the binary (verify-then-commit as today), restarts the service.
- Guest mode (external antfly URL) survives trivially — it's now the same code path as everything else.

### D4. Migrations: blue/green versioned tables, no degraded window
- Physical table names carry the schema version (`bakin_assets_v7`). The registry maps logical name → physical table (client-side pointer; upstream has no table aliases — verified).
- On `SCHEMA_VERSION` bump: create new table → backfill/re-embed in background (dual-write new rows to both during the window) → flip pointer only when doc count + index health converge → drop old table.
- Queries never touch a half-built table. Antfly/Bakin restarts mid-migration resume the backfill. VIS scores never disappear because of a migration again.

### D5. Durability: write-time outbox, boot does nothing
- Every index write (index/remove/transform) from every content type goes: **enqueue to a durable SQLite outbox → drain loop → mark done**. Antfly down = rows wait. Boot = resume drain (normally empty). No scans, no mtime comparison, ever, on the boot path.
- The outbox is its own SQLite store (`~/.bakin/search-outbox.db` or similar) — **not** the execution ledger, which stays coordination-facts-only per its contract.
- Deep reconcile (walk source-of-truth vs index) still exists but ONLY as a doctor-scheduled sweep and an explicit `bakin search rebuild` — never automatic, never at boot.
- Black-swan recovery (index wiped): doctor detects count mismatch, offers explicit rebuild.

### D6. Uniform sync model: all content types, one contract
- Assets, memory, tasks, workflows, team, lessons — everything moves to watcher → outbox. `search-reconcile.ts`, the boot bootstrap budget/retry machinery, `sweepOfflineDrops` (assets half), memory's persisted dedupe cache, and freshness-stamp plumbing are **deleted**, not deprecated.
- Memory specifics: the byte-offset tailer stays (it's source-position tracking, not index inference) but feeds the outbox. Offline appends (files that grew while Bakin was down) are caught by a **stat-level size-vs-offset check** in the doctor sweep — cheap stats, no content reads.

### D7. Assets: no auto-ingest, explicit import
- **One rule: a raw file on disk never becomes an asset without an explicit import action** (UI, `bakin assets import`, or MCP tool). The auto-ingesting `assets/inbox/` behavior is deleted (boot drain + watcher intercept).
- Detection: live chokidar watcher notes unmanaged files (counter/badge only — no reads, no indexing); full scan runs only on demand (opening the Import view) or in the doctor sweep. Zero boot cost.
- UX: **Import tab in Assets** — lists unmanaged files with per-file Import and Import All; sidebar badge count; doctor check reports unimported count.
- Assets created through the service (agents, UI upload, API, MCP, CLI) are untouched by this rule — they always auto-index + enrich (D8).

### D8. Enrichment: Bakin-side vision LLM → manifest
- On asset creation, an **async enrichment queue** calls a vision-capable LLM (same provider pattern + billed-call idempotency as the images plugin) and writes structured results into the **manifest**: `enrichment: { caption, ocrText, suggestedTags, summary?, model, at }`.
- Durable and user-editable; survives any reindex without re-billing; visible in asset detail UI. The search doc simply includes these fields — BM25 + text-embedding leg get real content for images.
- Never blocks or fails asset creation. Doctor surfaces unenriched counts; explicit backfill via `bakin assets enrich [--all]`.
- Scope: images (caption + OCR + tags), text-heavy docs (summary alongside existing raw-text extraction), audio (transcription/description when the configured model supports it).
- Provider/model configurable in settings; default: cheapest configured vision-capable model (haiku-class). Never fabricate metadata — enrichment failure leaves fields absent, not guessed.

### D9. Embedding legs (assets table; other tables analogous)
- Content types declare capability-level legs (D17); the assets table declares: a **text-embedding leg** over description + caption + OCR + tags + extracted text, and a **media-embedding leg** over image **and audio** files (D12: audio rides the same leg; MIME wiring only).
- The antfly adapter's default mapping: text leg → `bge-small` (or successor), media leg → `antflydb/clipclap` (CLIP+CLAP, 512-dim). Model choices live in adapter settings, never in content-type definitions.
- Weights start from current values (media-leading for assets) and are finalized by the measured tuning pass (D13).

### D10. Global search: ⌘K takeover overlay
- Summoned by ⌘K / header search. One query → `/api/search` (cross-table). Results grouped by type; **type-filter chips** (req 6); keyboard nav; Enter deep-links.
- **Debug badges** (RRF / BM25 / TXT / VIS) render per-hit when debug mode is on — same component family as the assets grid overlay, which is retained (req 2).
- Plugins contribute hit rendering via a new SDK client registration (D14) — title/subtitle/thumbnail/href per content type.

### D11. Degradation: honest, never silent
- Antfly down/unreachable → search UIs show an explicit "Search unavailable" state with doctor link + retry. The assets grid's client-side substring fallback is **deleted**.
- Antfly up with embeddings rebuilding → antfly itself serves what it can (FTS); we don't add client-side partial-degradation heuristics.
- Browse/filter/listing paths (non-search) never touch antfly and keep working.

### D12. Audio search via CLAP
- Audio asset types are wired into the visual/media embedding leg (clipclap embeds audio natively into the same vector space). Enrichment adds transcription/description when the configured model supports audio input.

### D13. Tuning pass (measured, not guessed)
- Near the end: build a small golden-query relevance set; profile **RRF vs RSF** (new upstream fusion option), re-benchmark the reranker on main (was ~200ms/candidate on rc.9), set per-index weights from data. Output: a documented "why these defaults" record. Reranker default stays off unless the numbers say otherwise.

### D14. SDK contract (rewritten, no compat)
Plugin authors get, from the harness alone:
- `ctx.search.registerContentType(def)` — declares table (logical name, indexes/embedders, facets, searchable fields). Table creation, versioning (D4), outbox wiring, `/api/plugins/{id}/search` route, and **inclusion in global search** are automatic. File-backed variant wires watcher→outbox for on-disk sources.
- `ctx.search.index/remove/transform` — enqueue through the outbox (fire-and-forget safe).
- `ctx.search.query(...)` + `useSearch` hook — with the honest-degradation state built into the hook's return shape.
- Client side: `registerPlugin({ search: { hitRenderer } })` — how this type renders in the ⌘K overlay.
- Type facet is structural: every row carries its content type; `/api/search?types=a,b` filters (req 6).
- Old surface (`registerFileBackedContentType`'s `fileToDoc: () => null` hacks, reconcile hooks, `whenReady` boot-gating) is deleted with no aliases.

### D15. Search telemetry panel (in scope, late phase)
- Health-plugin panel: query latency, per-leg availability over time, outbox drain depth, enrichment queue depth. Feeds from the existing usage recorder + doctor results — no parallel stat system (hard rule from CLAUDE.md).

### D16. Data on this machine
- Fresh index rebuild (tables recreated on the new schema). Asset manifests are the source of truth and are untouched (schema additively extended for `enrichment`). Existing assets get enriched via explicit backfill. No index-state migration from the old world.

### D17. Adapter neutrality: antfly is the default, not the design
All rebuild machinery is expressed against the `SearchAdapter` contract; adding a second adapter later must require zero changes upstream of the adapter layer. Concretely:
- **Contract surface**: the adapter interface exposes generic primitives — table lifecycle (create/drop), index/remove/transform, query, doc counts, index health, readiness — and the core layers (outbox, blue/green migrator, registry, doctor checks) are built ONLY on those primitives. The blue/green pointer flip lives in core and works for any adapter that can create tables and report counts/health.
- **Lifecycle is adapter-owned**: OS-service provisioning (D3), binary install/pin, and model management are implementation details behind the existing factory pattern (`src/core/search-adapter-factory.ts`, `getSearchAdapterSetup`). Core asks "ensure available / report health"; how is the adapter's business.
- **Capability model, not model names**: core and SDK speak in capability terms (text-embedding leg, media-embedding leg, full-text leg, reranking, fusion strategy). Embedder/model specifics (`clipclap`, `bge-small`, dimensions, GGUF vs ONNX) live in adapter settings. An adapter declares which capabilities it supports; content-type definitions request capabilities, and the adapter maps them.
- **Scores are generic**: query results carry a neutral `scoreBreakdown` (per-leg scores keyed by leg/index name) — the debug badges render whatever legs the adapter reports, with no antfly-shaped assumptions (no hardcoded `bleve|full_text` key sniffing in UI code; the adapter normalizes leg names).
- **Enrichment is upstream and neutral by construction** (D8 writes to manifests, not the engine) — no change needed.
- **Conformance suite**: the integration tests split into (a) an adapter-agnostic conformance suite any `SearchAdapter` implementation must pass (run against antfly today), and (b) antfly-specific tests (workaround regressions, service provisioning). A future adapter starts by passing (a).
- **Enforcement**: the existing architecture test (`@antfly/sdk` imports only in the adapter package) extends to forbid antfly-specific identifiers/types in `packages/core`, `packages/sdk`, `src/core`, and plugin code.

---

## 3. Commands

| Command | Purpose |
|---|---|
| `bun run build` / `bun run dev` / `bun run dev:mock` | unchanged build/dev loops |
| `bun run test` | full suite (CI-safe, mocked per testing rules) |
| `bun test tests/<file> --isolate` | single file |
| `bakin install search` | download pinned binary + provision OS service (launchd/systemd) + models |
| `bakin search rebuild [--table t]` | explicit full rebuild (blue/green path) |
| `bakin search status` | service state, table versions, outbox depth, index health |
| `bakin assets import [--all\|<path>]` | explicit import of unmanaged files |
| `bakin assets enrich [--all\|<assetId>]` | run/backfill enrichment |
| `bakin doctor` | includes: service provisioned/healthy, outbox drain, unimported count, unenriched count, count-mismatch (rebuild offer) |
| Antfly dev builds | built from `/Users/roscoe/go/src/github.com/antflydb/antfly` (Zig build; exact command captured in plan phase 0) |

## 4. Project Structure (blast radius)

| Area | Change |
|---|---|
| `packages/adapter-antfly/` | **Rewrite.** Keep: `pin.ts`, `installer.ts` (verify-then-commit), `models.ts`, `paths.ts` shapes. New: `service.ts` (launchd/systemd provisioning + strict-child fallback), thin `client.ts`/`query-translation.ts` rebuilt against main behavior. Delete: `server.ts` supervision lattice, `legacy-cleanup.ts` (one-shot, obsolete), stale-SDK shims. |
| `src/core/search-*` | **Replace.** New: `search-outbox.ts` (durable queue + drain), `search-tables.ts` (logical→physical mapping, blue/green migrator). Delete: `search-reconcile.ts`, `search-startup.ts` boot budget/retry, `search-warmup.ts` (service is always warm), `search-cleanup.ts` (folds into doctor sweep), `search-migration.ts` (replaced by blue/green). |
| `packages/core` + `packages/sdk` | New search contract types (D14); routing/search-route kept; client hit-renderer registration. |
| `plugins/assets/` | Delete inbox auto-ingest + `fileToDoc` hack; add Import tab + unmanaged detection, enrichment queue + manifest schema extension, audio MIME wiring. Keep the versioned store core (manifest/locks/atomic writes) — it's sound. |
| `plugins/memory/` | Tailer feeds outbox; delete `indexed-cache.ts` + boot backfill scan; doctor stat-sweep. |
| `packages/host/` | ⌘K global search overlay (new), header entry point. |
| `plugins/health/` | New/updated checks (service, outbox, imports, enrichment, count-mismatch) + telemetry panel. |
| Docs | Update `.claude/knowledge/{search-system,search-plugin-guide,search-api-reference,assets-versioning,memory-plugin,adapter-architecture,repo-architecture,doctor-and-health-checks}.md`, `CLAUDE.md` search/assets sections, `docs/plugin-authoring.md`, `README.md` if impacted. Delete the two root `ANTFLY_SEARCH_*.md` docs. |

## 5. Code Style

Inherits `CLAUDE.md` in full (strict TS, Zod at boundaries, functional preference, `createLogger`, no empty catches, kebab-case files, import order). Additions for this effort:
- Comments on any surviving upstream workaround must cite the upstream issue (D2).
- No module outside `packages/adapter-antfly/` may import `@antfly/sdk`, and no antfly-specific identifiers/types/concepts appear upstream of the adapter layer (architecture-test enforced, D17).
- No parallel stat systems; telemetry rides `recordUsage` + doctor.

## 6. Testing Strategy

1. **Real-binary integration suite**, split per D17: an **adapter-agnostic conformance suite** (`tests/integration/search-conformance/`) that any `SearchAdapter` must pass — table create, blue/green flip, outbox drain-after-downtime, FTS + semantic + hybrid queries, facets, type filters — run today against an ephemeral antfly (temp data dir, random port, dev build); plus **antfly-specific tests** (`tests/integration/antfly/`) for workaround regressions and service provisioning. Skips (with loud notice) when binary/models absent; embedding-dependent tests gated on model presence.
2. **Workaround regression tests**: one per surviving workaround, written to fail when upstream fixes land (D2).
3. **Unit tests** per CLAUDE.md rules — content-dir + OpenClaw-home mocks mandatory, outbox tested against temp SQLite, enrichment tested with a mocked provider (never real billed calls).
4. **Golden-query relevance set** for the tuning pass (D13) — checked in, re-runnable.
5. **UI**: overlay + Import tab covered by component tests; browser-level pass via the existing dev rig before ship.
6. **Ship-tag revalidation**: the full integration suite runs against the pinned release artifact as the final phase gate (D1).

## 7. Boundaries

**Always:**
- Work on `feat/antfly-zig-migration`; conventional commits; every commit green (build + tests) — a detailed commit/checkpoint strategy is a mandatory section of the plan.
- Update knowledge docs in the same phase as the code they describe.
- Bakin owns UI data/tasks/assets/audit; runtime providers own agent internals (adapter boundary unchanged).
- Enrichment writes to manifests only through the existing atomic-write + per-asset-lock chokepoints.

**Ask first:**
- Bumping the antfly pin after the ship tag is chosen.
- Any scope addition beyond D1–D17.
- Deleting or rewriting anything under `~/.bakin/` on this machine beyond the search index + outbox (manifests, tasks, memory files are user data).

**Never:**
- Boot-time scans, reconciles, or warming of any kind.
- Silent search fallbacks or fabricated metadata.
- Search rows or content in the execution ledger.
- Backwards-compatibility shims, aliases, or deprecated-but-kept code paths.
- `@antfly/sdk` imports — or any antfly-specific concept — outside the adapter package (D17).
- Tests touching real `~/.bakin/` or `~/.openclaw/`.

## 8. Open Items (resolved during plan, not blocking spec)

- Exact Zig build invocation + model-pull flow for dev builds (plan phase 0 captures it).
- Enrichment default model id (cheapest configured vision-capable; verified against the live models catalog at build time — never fabricated).
- Outbox schema details (row shape, retry/backoff policy, poison-row quarantine).
- Whether per-plugin `search-route.ts` endpoints need pagination changes for the overlay (likely no — overlay uses `/api/search`).
