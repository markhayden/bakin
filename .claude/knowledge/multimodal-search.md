# Multimodal Search — Assets Text + Media Legs

How Bakin makes assets findable by what they *are* — caption text, OCR'd
words, visual similarity, audio similarity — not just filenames. For the full
search architecture (outbox, blue/green, service lifecycle) see
`search-system.md`; this doc is the `bakin_assets` multimodal pipeline.

## The two embedding legs

`bakin_assets` declares two capability legs (plus the engine-managed
full-text index). The antfly adapter maps capabilities to models
(`packages/adapter-antfly/src/defaults.ts`); nothing upstream names a model
(D17 — architecture-test enforced).

| Leg | Capability | Default model (antfly adapter) | Input |
|---|---|---|---|
| `assets_text` | `text-embedding` | `BAAI/bge-small-en-v1.5` (384-dim) | description + caption + OCR + tags + transcript + extracted text (chunked 200/25) |
| `assets_visual` | `media-embedding` | `antflydb/clipclap` (CLIP+CLAP, 512-dim) | raw media bytes via `media_url` — **raster images AND audio** |

`antflydb/clipclap` is a dual-encoder CLIP (images↔text shared space) with a
CLAP audio half — one leg embeds both pixels and audio into the same vector
space, so "find that voice memo about the launch" and "red dashboard mockup"
use the same query mechanics.

## Where the text comes from: enrichment (the load-bearing half)

CLIP similarity alone can't carry image search. On asset create/new-version,
the **enrichment queue** (assets plugin) calls a vision LLM and writes
`caption`, `ocrText`, `suggestedTags`, `transcript` (audio), `summary`
(text-heavy docs) into the asset **manifest** — durable, user-editable, never
re-billed (`done + forVersion` skip guard; user-edited fields are never
clobbered). `buildVersionedAssetSearchDoc` (`plugins/assets/lib/search-doc.ts`)
folds those fields into the search doc, so BM25 and the text leg both see
real content for images. Provider layer:
`packages/core/src/media/direct-vision-provider.ts` (Anthropic/OpenAI/Google;
Zod-strict output — invalid JSON means `failed`, never fabricated metadata).

## media_url mechanics

- `search-doc.ts` sets `media_url` to a `file://` URL (`buildAssetFileUrl`)
  for raster images (`png|jpe?g|gif|webp|bmp`) and audio files
  (`mp3|wav|flac|ogg|m4a|aac` when `manifest.type === 'audio'`).
- The media leg's template is `{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}`
  — docs without media simply skip the leg.
- `file://` URLs, not loopback HTTP: the engine's scraper blocks private IPs
  for `http(s)://`, while `file://` dispatches straight to a local read —
  the sanctioned path for a same-host engine.
- Embedding runs IN-PROCESS in the engine (never an inference URL — an HTTP
  inference path wedges backfill on cold/dead endpoints).

## Server-side text extraction (unchanged rationale)

Bakin extracts document text itself (`plugins/assets/lib/content-extractor.ts`:
plain formats read directly, PDF via lazy `pdf-parse` with a 100-page cap,
50K-char cap, per-(asset,version,size) LRU) and passes it as a first-class
`content` field. The engine's own `{{remotePDF}}` extraction is unreliable on
design-tool PDFs, and Bakin-side extraction also feeds BM25 keyword search.
The engine never reads local files except `media_url` bytes.

## Mixed corpora (antfly#319: RESOLVED at 0.2.0)

A table where some docs have `media_url` and some don't is the NORMAL case.
The old failure — backfill accounting never reaching "complete" when the
template skips docs
([antflydb/antfly#319](https://github.com/antflydb/antfly/issues/319)) — is
fixed in the 0.2.0 pin: skip-heavy corpora clear their flags honestly at
idle, proven at scale including interrupted rebuilds (gate T7,
`tasks/evidence-antfly-0.2.0.md`). The `mapIndexStatuses` idle-detection
override was deleted 2026-08-31; guards in
`tests/integration/antfly/workaround-regressions.test.ts` fail if the lying
flags ever return. An interrupted backfill leaves a sticky-honest
`backfill_state:"degraded"` scar on a fully functional leg (maps ready).

## Fusion + debug scores

Hybrid queries fuse full-text + both legs with **RSF** at balanced weights
(1.0/1.0) — the measured winners (83% vs 28% hit@1 against the old 0.5/2.0
RRF skew; `search-tuning.md` has the numbers and the re-run command).
Per-hit `indexScores` come back with neutral keys (`full_text`,
`assets_text`, `assets_visual`); the shared `ScoreOverlay` SDK component
renders one badge per leg in debug mode — in the assets grid AND the ⌘K
overlay. Embedding legs report `-cosine_distance` (negative; nearer 0 =
more similar).

Reranking is per-query opt-in (`rerank: true`): +11pts hit@1 on the golden
set at ~10× latency (~200ms/candidate, serialized on Metal). Never default-on.

## Schema changes

Doc-shape or leg changes ride the content type's `schemaVersion` (currently 2
for assets) — bumping it (or changing adapter embedder settings, which changes
`mappingFingerprint()`) triggers a background blue/green migration. No
drop-and-reindex, no degraded window, no manual steps.

## Performance notes

- Embeddings are computed at index time (write-heavy, query-cheap); vectors
  persist on disk — the SIGKILL drill shows identical scores ~500ms after an
  engine restart.
- The OS-supervised engine preloads its embedders (`--preload-model` per
  configured antfly-provider embedder) — no cold-model window after service
  restarts.
- CLIP/CLAP embedding: tens of ms per item warm; enrichment (LLM) is the
  slow + billed step and is asynchronous by design.
