# Assets Plugin — Current Structure

The deep contract reference is `.claude/knowledge/assets-versioning.md`
(versioned store, manifests, locks, search row). This doc is the module map +
the two flows added by the 2026-07 search/asset rebuild: **explicit import**
and **enrichment**.

## Module map (`plugins/assets/`)

```
index.ts                     — activate(): routes, exec tools, hooks, content type, health check
lib/
  asset-id.ts                — assetId grammar + path chokepoints (isValidAssetId, assetDirRelPath)
  manifest.ts                — Zod manifest schema (incl. enrichment block) + atomic writes
  manifest-cache.ts          — stat-validated read cache
  asset-lock.ts              — per-assetId async mutex
  asset-core.ts / asset-mutations.ts / asset-upsert.ts / asset-trash.ts — service layer
  asset-service.ts           — barrel
  asset-media.ts             — sharp/ffmpeg thumbnails, dimensions
  asset-url.ts               — file:// URL builder (media_url for the visual/audio leg)
  content-extractor.ts       — text extraction for search docs; PDFs delegate
                               to the core engine (src/core/pdf/engine.ts —
                               ONE engine shared with bakin_exec_pdf_*, #742;
                               caps in src/core/pdf/limits.ts)
  search-doc.ts              — buildVersionedAssetSearchDoc (manifest → search row)
  import-unmanaged.ts        — classifier + readdir-only scan + importUnmanagedFile
  unmanaged-tracker.ts       — in-memory watcher-fed unmanaged set → asset.unmanaged SSE
  enrichment/
    providers.ts             — vision-provider capability catalog + default-model resolution
    queue.ts                 — single-concurrency billed worker (manifest is the durable record)
    apply.ts                 — THE enrichment manifest writer (lock + atomic)
  tags.ts / task-asset-index.ts / health-checks.ts / serve.ts / constants.ts
components/versioned/        — grid (incl. Import tab), detail (incl. enrichment card), edit drawer
```

## Explicit import (D7 — nothing auto-ingests)

A raw file on disk NEVER becomes an asset without an explicit action. There is
no ingest sweep, no boot drain, no watcher adoption.

- **Detection:** the chokidar watcher notes unmanaged files (anything under
  `assets/**` that is not inside `store/<ym>/<validAssetId>/**` or `.trash/`)
  in an in-memory tracker — no reads, no indexing, zero boot cost. A debounced
  `asset.unmanaged {count}` SSE event drives the sidebar badge.
- **Scan:** `GET /api/plugins/assets/import/scan` (readdir+stat only) lists
  unmanaged files with suggested types; it reseeds the tracker. The hourly
  doctor check (`assets.unimported`, deliberately NOT auto-fixable) is the
  offline-drop catcher.
- **Import:** `POST /api/plugins/assets/import {paths?|all?, type?}`, the
  Assets **Import tab**, `bakin assets scan` / `bakin assets import
  [--all|<path>] [--type t]`, or MCP `bakin_exec_assets_scan_unmanaged` /
  `bakin_exec_assets_import`. Import creates a normal v1 versioned asset
  (`op:'import'`, `source.kind:'import'`, agent `user`) and consumes the
  source file; indexing rides the ordinary manifest→watcher→outbox path.
- `assets/inbox/` still exists as a convenient drop LOCATION, but it is just
  another unmanaged directory — the old auto-ingest sweep is deleted.

## Enrichment (D8 — vision LLM → manifest)

On `createAsset`/`addVersion`/changed-upsert, the enrichment queue calls a
vision-capable LLM and writes into the manifest's `enrichment` block:
`{status, caption, ocrText, suggestedTags, summary?, transcript?, model, at,
forVersion, error?, userEdited?}`.

- **Durable + billed-once:** `status done && forVersion === currentVersion`
  skips (unless `--force`); the idempotency registry dedupes concurrent
  requests; a reindex NEVER re-bills (the manifest is the record).
- **User edits win:** `PATCH /versioned/:assetId/enrichment` sets `userEdited`;
  machine re-runs preserve edited fields field-by-field.
- **Never blocks creation; never fabricates:** enqueue is fire-and-forget;
  provider output is Zod-strict (invalid ⇒ `failed` + error, fields absent).
  No configured key / unsupported modality ⇒ `skipped` with a reason.
- **Scanned PDFs (#747):** a PDF whose extraction yields no text (trimmed)
  does NOT skip — the first 3 pages render through the core PDF engine
  (`enrichment/scanned-pdf.ts`, budget `SCANNED_OCR_MAX_PAGES`) and each runs
  through the single-image vision pipeline: `ocrText` = page-labeled merge +
  a visible `[pages 4–N not OCR'd]` marker; caption/tags from page 1; ANY
  page failure fails the whole job (partials never apply as `done`). Engine
  resolution uses kind `image` for these jobs (needs vision, not a document
  summarizer). Deliberately vision-LLM, not the ocr pack — enrichment can't
  depend on optional packs, and D9 (server never spawns pack binaries) stands.
  Non-PDF documents with only whitespace still skip honestly.
- **Direct-path spend is on the ledger (#747 rider):** the direct engine
  writes the same work-class-`enrichment` `run_costs` row the runtime engine
  writes (agent `system`, provider-reported usage verbatim, absent usage =
  null tokens). ONE recorder — `meterAgentTurn`.
- **Providers:** `packages/core/src/media/direct-vision-provider.ts`
  (Anthropic/OpenAI/Google; audio input via Gemini). Default model = cheapest
  vision-capable tier whose provider has a configured key (env → secret
  store), resolved from the curated models catalog; `enrichmentModel` setting
  overrides.
- **Backfill:** `POST /enrich {assetId?|all?, force?}` / `bakin assets enrich`
  / the `assets.enrichment` doctor repair (manual tier — billed).
- Search docs include caption/ocr/tags/transcript/summary → BM25 and the text
  embedding leg see real content for images (see `multimodal-search.md`).

## Search row

One row per asset keyed by assetId, built from the current version + the
enrichment block; `media_url` (file:// URL) feeds the `assets_visual`
CLIP+CLAP leg for raster images AND audio. Content type `schemaVersion: 2`;
changes blue/green-migrate (`search-system.md`).
