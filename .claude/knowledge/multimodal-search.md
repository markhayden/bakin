# Multimodal Search

How Bakin indexes content across modalities — text bodies, PDF extraction, and image pixels — and how to extend it.

For the full search system reference (registry, hybrid fusion, reranker, migration), see `search-system.md`. This doc focuses specifically on the **multimodal pipeline** for the `bakin_assets` table.

## The problem

Assets are mixed-modality by nature. A single `bakin_assets` table holds:

- PDFs (recipe, contract, spec sheet)
- Markdown and plain text (notes, project docs, READMEs)
- Structured data files (JSON, CSV, YAML)
- Raster images (screenshots, photos, diagrams)
- Vector images (SVG logos and icons)
- Audio and video (not yet indexed beyond metadata)

A single text embedding model can't meaningfully represent pixel data, and a single image embedder can't represent 500-word contract clauses. Bakin needs to route each asset through the right pipeline and merge the results at query time.

## The design

The `bakin_assets` Antfly table has **two embedding indexes** side by side:

| Index | Embedder | Template | What goes in |
|---|---|---|---|
| `assets_text` | `BAAI/bge-small-en-v1.5` | `{{description}} {{tags}} {{file_name}} {{content}}` | Sidecar metadata + server-side extracted body text |
| `assets_visual` | `openai/clip-vit-base-patch32` | `{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}` | Raster image pixels (CLIP joint text-image space) |

Plus the standard Bleve full-text index on `description`, `tags`, `file_name`, `content` — so keyword hits on extracted bodies show up in queries via the normal BM25 path.

At query time the registry passes `indexes: ['assets_text', 'assets_visual']` to `antfly.queryTable`, Antfly runs both embedders, and RRF merges them with Bleve into a unified ranking. The per-doc `_index_scores` breakdown tells you exactly which modality produced the hit.

### Why two indexes on one table

The alternative — two separate tables — would have required doubling reindex logic, splitting facets and aggregations, and merging cross-table query results. Antfly natively supports multiple named indexes on one table, and the registry's multi-index support (T3) makes the registration clean. Everything that touches assets (upload routes, trash, watcher, cleanup, facets) treats them as one logical collection; the storage layer just happens to run two embedders.

### Why server-side extraction instead of `{{remotePDF}}` / `{{remoteText}}`

Antfly ships template helpers that fetch content over HTTP or `file://` at enrichment time — `{{remotePDF url=X}}`, `{{remoteText url=X}}`, `{{remoteMedia url=X}}`. On paper those are the right abstraction: the template handles I/O, Bakin just passes URLs. In practice two things bit us:

**PDF extraction is broken upstream.** Antfly's Go PDF library (`ajroetker/pdf`, a fork of `rsc.io/pdf`) silently fails on any PDF with complex font subsetting, CID fonts, or text positioned via matrix transforms — which is every design-tool PDF from Canva, InDesign, Affinity, and basically any modern authoring tool. The helper returns empty text with no error. Documents index with no body content and every PDF query silently returns wrong results. See Bakin issue #72 for the full trace.

**Loopback HTTP fetches are blocked.** Antfly's scraping layer hardcodes a private-IP defense (`BlockPrivateIps: true` in the default `ContentSecurityConfig`) that rejects `127.0.0.1`, `10.*`, `192.168.*`, and `169.254.*`. There's a config key (`content_security.block_private_ips`) that *looks* like it disables this, but it's dead code — `SetDefaultSecurityConfig()` is defined in Antfly's source and never called anywhere. Another #72 finding. For plain-text formats we could theoretically work around this with `{{remoteText url=file://...}}`, but we'd still be at the mercy of Antfly's private-IP check on HTTPS sources, and the PDF path would still be broken.

**Server-side extraction in Bakin sidesteps both.** Bakin reads the file directly from disk (trivial — assets live in `~/.bakin/assets/`), extracts text with well-maintained Node libraries, and passes the result as a first-class `content` field on the search document. Antfly just embeds what it's given. As a bonus: extracted text shows up in the Bleve full-text index, so keyword search works on PDF bodies — something `{{remotePDF}}` doesn't provide even when it functions.

For **images**, we still use Antfly's `{{remoteMedia url=...}}` because CLIP needs pixel data and Bakin doesn't have an in-process way to hand raw image bytes to Termite. `file://` URLs work for `remoteMedia` because `DownloadContent` dispatches on scheme — the private-IP check only runs for `http(s)://`. `file://` goes through `validatePathSecurity`, which is a no-op unless `AllowedPaths` is configured.

## The pipeline

```
Filesystem event (upload, paste, manual drop, sync hook)
  ↓
plugins/assets/index.ts indexAsset(relPath)
  ↓
assetToSearchDoc(meta, filename, assetType, relPath)
  ├─ read sidecar (.meta.json)
  ├─ computeImageUrl(rel, filename, assetType)
  │    └─ raster formats → buildAssetFileUrl → 'file:///abs/path.jpg'
  │    └─ other          → ''
  ├─ extractAssetContent(absPath, filename)
  │    ├─ .pdf                  → pdf-parse (lazy-imported, v2 PDFParse class)
  │    ├─ .md/.txt/.json/.csv/… → fs.readFileSync('utf-8')
  │    └─ (other)               → ''
  │    (all paths capped at 50K chars, word-boundary-safe truncate)
  └─ emit doc: { description, tags, file_name, agent, task_id,
                asset_type, updated_at, content, image_url, ... }
  ↓
ctx.search.index(relPath, doc)
  ↓
AntflyClient.tables.batch(bakin_assets, { inserts: { [relPath]: doc } })
  ↓
Antfly's embedding enricher (per-shard, async):
  ├─ assets_text index: chunk → embed via BGE → store vectors
  ├─ assets_visual index: fetch image_url via file:// → embed via CLIP → store vectors
  └─ full_text_index_v0: tokenize description+tags+file_name+content → store Bleve doc
```

All three indexes are populated from the same source document in one insert. Failure in any one index is logged but doesn't abort the others — a doc with corrupt image bytes still gets its text embedding.

## Format support matrix

| Extension | asset_type | Text content | Image index | Notes |
|---|---|---|---|---|
| `.pdf` | `other` | pdf-parse (v2) | — | Caps at 100 pages |
| `.md`, `.txt`, `.rtf` | `text` | `fs.readFileSync` | — | |
| `.json`, `.csv`, `.tsv`, `.xml` | `data` | `fs.readFileSync` | — | Read as UTF-8, not parsed |
| `.yaml`, `.yml` | `plans` | `fs.readFileSync` | — | |
| `.png`, `.jpg`, `.jpeg` | `images` | — | CLIP (raster) | |
| `.gif`, `.webp`, `.bmp` | `images` | — | CLIP (raster) | |
| `.svg`, `.ico` | `images` | — | **excluded** | Vector/indexed-palette — Go stdlib image lib can't decode, CLIP needs raster |
| `.mp3`, `.wav`, `.m4a`, `.ogg` | `audio` | — | — | No transcription yet |
| `.mp4`, `.mov`, `.webm`, `.avi` | `video` | — | — | No frame extraction yet |

Everything with no text content and no image index still gets indexed via its sidecar metadata (`description`, `tags`, `file_name`), so you can always find an asset by its human-written description even when the body isn't machine-readable.

## Adding a new modality

Follow this path to add audio transcription, video frame extraction, or any other modality:

### 1. Decide if it's a new index or reuses `assets_text`

If the modality produces **text** (speech-to-text for audio, OCR for scans, description generation for video frames), add it to the existing `assets_text` index. No schema or index changes — just update the content extractor.

If the modality produces **vectors in a different space** that can't be meaningfully fused into text embeddings (e.g., an audio embedder like Whisper-encoder, or a video embedder like VideoBERT), add a new index alongside `assets_text` and `assets_visual`.

### 2. Case A — Extends `assets_text` (text output)

Update `plugins/assets/lib/content-extractor.ts`:

```typescript
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac'])

export async function extractAssetContent(absPath: string, filename: string): Promise<string> {
  const ext = (filename.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]
  try {
    if (PLAIN_TEXT_EXTS.has(ext))  return truncate(readFileSync(absPath, 'utf-8'))
    if (ext === '.pdf')            return truncate(await extractPdfText(absPath))
    if (AUDIO_EXTS.has(ext))       return truncate(await transcribeAudio(absPath))  // NEW
    return ''
  } catch (err) { /* ... */ }
}

async function transcribeAudio(absPath: string): Promise<string> {
  // whisper.cpp, openai-whisper, or a Node binding
  // return the full transcript as plain text
}
```

No schema change. No migration. Existing reindex picks it up. Bump `SCHEMA_VERSION` only if you want to force reprocessing of docs that were indexed before the new extractor landed.

### 3. Case B — New embedding index (non-text output)

Register a new index alongside the existing ones in `plugins/assets/index.ts`:

```typescript
indexes: [
  { name: 'assets_text',   embedderRef: 'default',     embeddingTemplate: '…' },
  { name: 'assets_visual', embedderRef: 'visual',      embeddingTemplate: '…' },
  {
    name: 'assets_audio',
    embedderRef: 'audio',  // ← new ref
    embeddingTemplate: '{{#if audio_url}}{{remoteMedia url=audio_url}}{{/if}}',
  },
]
```

Add the new embedder ref to `settings.search.settings.embedders`:

```typescript
embedders: {
  default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
  visual:  { provider: 'termite', model: 'openai/clip-vit-base-patch32' },
  audio:   { provider: 'termite', model: 'openai/whisper-base' },  // ← new
}
```

Add a `audio_url` keyword field to the schema. Compute it in `computeMediaUrls()` (rename to something more generic if it's getting crowded). Bump `SCHEMA_VERSION` — this is a breaking schema change, and the migration mechanism will drop and recreate `bakin_assets` on next boot. Update tests, run `antfly termite pull --variants i8 openai/whisper-base`, restart.

### 4. Document the choice

Add a row to the format support matrix above. Update the reranker decision table in `search-system.md` if the new modality affects the `rerankField` calculus. Note any upstream Antfly limitations encountered in #72.

## Operational notes

### Model warmup

Both BGE and CLIP lazy-load on first use. The first query after boot (or after Termite's 5-minute keep-alive expires) takes 500ms–2s while the model loads from disk into RAM. Subsequent queries are sub-100ms. This only matters for cold starts — in production, the models stay warm under normal traffic.

### Memory

- BGE (`bge-small-en-v1.5`): ~130MB on disk, ~250MB RAM when loaded
- CLIP (`clip-vit-base-patch32`): ~600MB on disk, ~800MB RAM when loaded
- Reranker (`mxbai-rerank-base-v1`): ~700MB on disk, ~1GB RAM when loaded (only loaded for tables with `rerankField` set)

Total worst case ≈2GB RAM. The Mac mini handles this comfortably; smaller boxes might want to skip the reranker or swap CLIP for a smaller visual model.

### Reindex cost

A full reindex of `bakin_assets` re-extracts every file's content, re-fetches every image via `file://`, and re-embeds everything. For a 1000-asset collection with a 50/50 mix of text and images, budget:

- Text extraction: ~5ms per file for small text, ~200-500ms per PDF
- BGE embedding: ~10-30ms per chunk (200-token chunks)
- CLIP embedding: ~80-150ms per image (cold) or ~40-80ms (warm)

Rough total: 1-3 minutes for a 1000-asset reindex. Runs in the background via the server boot hook; Bakin is usable immediately with empty tables and indexing completes asynchronously.

### When CLIP batch embedding hits the Antfly bug

There's a known Antfly ONNX issue where CLIP's batch embedding fails with a Reshape error when processing >1 image in a single call. Antfly logs it as a warning and falls back to per-item embedding, which succeeds. You'll see this in logs as:

```
embedding images: forward pass: running ONNX inference: ... Reshape node ... input_shape_size == size
Batch embedding failed, falling back to per-item embedding ... succeeded=N failed=0
```

The fallback works, so this is noise, not a failure. Tracked in #72 as another Antfly finding.

## Testing the pipeline

Local smoke test against a running `bun run dev:mock`:

```bash
# 1. Drop test content
cp my-recipe.pdf ~/.imitationcrab/assets/other/test-pdf/
echo '{"agent":"main","taskId":"test","created":"2026-04-12T00:00:00Z","description":"pdf test","tags":[]}' \
  > ~/.imitationcrab/assets/other/test-pdf/my-recipe.pdf.meta.json

cp my-photo.jpg ~/.imitationcrab/assets/images/test-img/
echo '{"agent":"main","taskId":"test","created":"2026-04-12T00:00:00Z","description":"image test","tags":[]}' \
  > ~/.imitationcrab/assets/images/test-img/my-photo.jpg.meta.json

# 2. Force a reindex (the watcher would also catch the drops, but this is deterministic)
curl -X POST "http://localhost:3737/api/reindex?table=assets"

# 3. Search for a term in the PDF body (not in sidecar)
curl "http://localhost:3737/api/search?q=<unique+body+term>&table=assets"
#    → recipe PDF at rank 1, look for `bleve` score in indexScores

# 4. Search for a visual concept in the image (not in sidecar)
curl "http://localhost:3737/api/search?q=<visual+concept>&table=assets"
#    → image jpg at rank 1, look for `assets_visual` score in indexScores
```

The **`indexScores`** field on each result is the proof of life. A hit with `bleve: 0.4` means the full-text index matched — server-side extraction worked. A hit with `assets_visual: 1.5` means CLIP matched the image pixels to the query. A hit with only `assets_text` scores (no bleve, no visual) means only metadata matched — the body wasn't extracted, or the image wasn't raster, or the query didn't semantically resemble the embedded content.

## Known upstream issues

All tracked in [Bakin issue #72](https://github.com/markhayden/bakin/issues/72):

1. **`content_security.block_private_ips` is dead code** — documented Antfly config key that does nothing because `SetDefaultSecurityConfig()` is never called from app startup.
2. **`ajroetker/pdf` is too weak for real PDFs** — fails silently on complex font encoding. Would be fixed upstream by swapping to `pdfcpu` or shelling out to `pdftotext`.
3. **`remote_content.security.*` doesn't propagate to plain HTTP URLs** — only applies to S3 URLs with matching credentials. Plain `http://` falls through to the hardcoded default.
4. **CLIP batch embedding ONNX reshape error** — batch size >1 fails, per-item fallback works. Tracked for an Antfly upstream fix.
5. **Providing `--config` disrupts `viper.SetDefault("termite.api_url")`** — minor viper idiom issue, workaround is setting the key explicitly.

When any of these are fixed upstream, Bakin can revert the corresponding workaround. The pivots are minimal and clearly marked in commit messages (`fix(antfly):` and `fix(assets):` on the feat/multimodal-search branch).
