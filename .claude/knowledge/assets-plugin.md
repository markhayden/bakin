# Assets Plugin

## Overview

The Assets plugin is the centralized content store for all files created by AI agents or dropped in manually by the user. When agents generate images, write text, produce video, or create plans, those files land in the asset system with structured metadata — browsable, searchable, and linked back to the tasks that produced them.

### Why It Matters

Without a centralized asset system, agent-created files are scattered with no consistent way to browse, search, or manage them. The Assets plugin solves this by providing:

- **Organized storage** — A single flat store sharded by month, with sidecar metadata (agent, taskId, timestamps, tags, descriptions, type).
- **Variant management** — Thumbnails and optimized versions are generated automatically, reducing bandwidth and improving load times in the UI.
- **Full-text searchable** — Asset metadata is indexed by Antfly for fast search across descriptions, tags, and filenames.
- **Task integration** — Every asset's sidecar can point at a task; task detail drawers show associated assets inline with preview modals.
- **Trash lifecycle** — Soft-delete with 7-day retention prevents accidental data loss.
- **Deep-linkable** — Every view state (filters, sort, selected asset) is URL-backed for bookmarking.

## Storage Model — Filename-as-Identity

The canonical filename **is** the asset's identity. Its location on disk is a pure function of that filename. This is the single design invariant the entire plugin is built on.

### Canonical filename

```
YYYYMMDD-{slug}-{id8}.{ext}
```

- `YYYYMMDD` — creation date, used as the shard key.
- `{slug}` — kebab-case from the human-facing name (title or description).
- `{id8}` — 8-hex-character random id, makes the filename unique.
- `{ext}` — lowercased extension.

Example: `20260404-hero-banner-a1b2c3d4.png`

### On-disk layout

```
~/.bakin/assets/
  store/
    2026-03/
      20260328-spec-a1b2c3d4.md
      20260328-spec-a1b2c3d4.md.meta.json
      20260328-hero-b5c6d7e8.png
      20260328-hero-b5c6d7e8.png.meta.json
      20260328-hero-b5c6d7e8.thumb.jpg              ← variant
      20260328-hero-b5c6d7e8.thumb.jpg.meta.json
    2026-04/
      20260404-brief-f9a0b1c2.md
      ...
  inbox/
    (drop zone — anything placed here is canonicalized on next ingest sweep)
  .trash/
    {canonical}__deleted-{timestamp}
    {canonical}__deleted-{timestamp}.meta.json
```

All month shards are created on-demand by `saveAsset` — `initBakinHome` only seeds `assets/`, `assets/store/`, `assets/inbox/`, and `assets/.trash/`.

### Path resolution (pure function)

```ts
// plugins/assets/lib/path-for-filename.ts
pathForFilename('20260404-hero-a1b2c3d4.png')
  → 'assets/store/2026-04/20260404-hero-a1b2c3d4.png'
```

No resolver. No in-memory map. No watcher-dependent lookup. Any code that has a filename can derive the absolute path with `join(contentDir, pathForFilename(filename))`. Callers must null-check — non-canonical filenames (missing/malformed date prefix) return `null`.

Exported helpers from `plugins/assets/lib/path-for-filename.ts`:

- `pathForFilename(filename)` — content-dir-relative path, with leading `assets/`.
- `relPathForFilename(filename)` — path relative to the assets root (no `assets/` prefix).
- `yearMonthFromFilename(filename)` — just the `YYYY-MM` shard key.
- `isCanonicalFilename(filename)` — predicate for ingestion.

### Why filename-as-identity

Retype (changing an asset's `type` field) used to physically move the file to a new type directory. Every external reference (project manifests, task state, search index) stored the full path as a string, so a retype left stale paths everywhere — project manifests pointed at files that no longer existed, agents reading those manifests blocked. This actually happened (project `ff335816`, task `64aabe60`) and motivated the rewrite.

Under filename-as-identity:

- Retype edits `meta.json.type`. File does not move.
- Relink edits `meta.json.taskId`. File does not move.
- The search index keys documents by filename, not path — stable across both.
- Project manifests and dispatch messages carry filenames, not paths. Resolution is a pure function at read time.

## Sidecar Metadata (`.meta.json`)

```json
{
  "agent": "pixel",
  "taskId": "b082bb01",
  "created": "2026-03-23T14:30:00.000Z",
  "tool": "dall-e-3",
  "description": "Hero image for blog post",
  "tags": ["social", "blog"],
  "type": "images",
  "originalFilename": "hero.png",
  "source": "agent"
}
```

- `type` — asset classification (`images`, `text`, `video`, `audio`, `plans`, `research`, `pdf`, `data`, `other`). Lives in the sidecar; retype changes only this field.
- `taskId` — linked task, or null for unlinked assets. Relink changes only this field.
- `source` — how the asset entered the store: `"agent"` (MCP tool), `"upload"` (UI dialog), `"clipboard"` (pasted into task description), `"inbox"` (canonicalized from `assets/inbox/`).
- `originalFilename` — the pre-canonicalization filename, preserved for human reference.

Field aliases are auto-corrected by the sidecar normalizer: `author` → `agent`, `createdAt` → `created`, `task` → `taskId`.

## Inbox Ingestion

Files dropped manually into `~/.bakin/assets/inbox/` are picked up by the ingest sweep and moved to the canonical store:

1. Each file is inspected — if already canonical (matches the filename regex) it's moved to `store/{YYYY-MM}/` as-is.
2. Non-canonical filenames are renamed to `{YYYYMMDD}-{slugified-name}-{id8}.{ext}`, using the file's mtime as the date source.
3. A stub sidecar is created with `source: "inbox"` and the original filename preserved.
4. After the move, a search index entry is created.

This preserves the "users can drop files into a known folder" property while keeping the store invariants intact.

## Variant Naming

Variants share the primary's base stem but carry a role marker before the final extension:

- `*.thumb.*` → role `thumbnail` (400px wide, generated via ffmpeg at save time).
- `*.opt.*` → role `optimized`.

`dispatch.ts` filters variants out when listing attached assets so agents only see the primary. Sidecars exist for variants too — they point at the same `taskId` as the primary.

## API Routes

All under `/api/plugins/assets/`:

| Route | Method | Params | Notes |
|-------|--------|--------|-------|
| `/` | GET | `type`, `agent`, `taskId`, `tag`, `q`, `limit`, `offset`, `filename`, `path` | Listing with pagination |
| `/upload` | POST | multipart: `file`, `taskId?`, `description?`, `tags?`, `source?` | UI / clipboard paste uploads |
| `/file` | GET | `filename` or `path`, `v` (cache bust) | Serves file with MIME + ETag |
| `/` | DELETE | `filename` or `path` | Soft-delete to `.trash/` |
| `/trash` | GET | — | Lists trashed items with expiry |
| `/trash/:file/restore` | POST | — | Restores to `store/{YYYY-MM}/` derived from canonical filename |
| `/trash/:file` | DELETE | — | Permanently removes trashed item |
| `/trash` | DELETE | — | Bulk delete all trash |
| `/link` | PATCH | JSON: `filename`, `taskId` (string \| null) | **Metadata-only.** Edits sidecar `taskId`; file does not move. |
| `/retype` | PATCH | JSON: `filename`, `type` (AssetType) | **Metadata-only.** Edits sidecar `type`; file does not move. |
| `/content` | PUT | JSON: `filename`, `content` (string) | Rewrites text content for editable MIME types |

Alternative file serving at `/api/assets/[...path]` supports range requests (video seeking).

### Retype / relink are metadata-only

Under filename-as-identity, `/retype` and `/link` mutate the sidecar and reindex the search document under the same filename key. The only side effect on disk is the `.meta.json` rewrite. No file move, no path rewrite in any downstream reference.

## URL State

All filter/view state is URL-backed via `useQueryState`/`useQueryArrayState`:

| Param | Default | Values |
|-------|---------|--------|
| `view` | `grid` | `grid`, `list`, `trash` |
| `q` | (empty) | Search text |
| `type` | (empty) | Comma-separated: `images,video` |
| `asset` | (empty) | Filename for detail deep link |
| `page` | `1` | Page number |
| `sort` | `created` | `name`, `type`, `size`, `created` |
| `dir` | `desc` | `asc`, `desc` |

Page size persisted in `localStorage` key `assets-page-size` (default: 24).

## Trash Lifecycle

1. `DELETE /?filename=...` moves file to `.trash/{canonical}__deleted-{timestamp}`.
2. Sidecar is preserved alongside.
3. 7-day TTL before auto-purge (`cleanTrash`).
4. Restore derives the target shard from the canonical filename: `assets/store/{YYYY-MM}/{filename}`. Non-canonical filenames cannot be restored (they would have no well-defined destination).
5. Trash view shows expiry countdown per item.

See `plugins/assets/lib/trash.ts`.

## Thumbnail Pipeline

1. **On save** (`plugins/assets/lib/save-asset.ts`): image assets auto-generate `.thumb.jpg` via ffmpeg (400px wide, quality 5). Dimension detection uses `ffprobe`.
2. **Audit repair** (`bakin_exec_assets_audit --fix`): generates missing thumbnails, fixes broken sidecars.
3. **UI display**: prefers `variant.role === 'thumbnail'` for preview URLs, falls back to full image.
4. **Lazy loading**: grid images use `loading="lazy"` for deferred offscreen loading.

## Integration Points

### Task-Assets Widget
`src/components/assets/task-assets.tsx` embeds in the task detail drawer. Fetches assets by `taskId` (filtered by sidecar), renders previews, and listens for SSE `workflow.step_complete` events to auto-refresh.

### AssetDetailModal
`src/components/assets/asset-detail.tsx`. Accepts `filename` prop, renders full preview + metadata sidebar. Includes a type selector that calls `PATCH /retype` (metadata-only) and inline editing for text-based MIME types.

### Cross-Plugin Hooks
Registered in `plugins/assets/index.ts`:

- `assets.validateSidecar(metaPath)` — validate sidecar fields
- `assets.getSidecarPath(assetPath)` — `{path}.meta.json` sibling resolver
- `assets.createStub(filename)` — auto-create metadata
- `assets.detectVariant(filename)` — check if file is a variant
- `assets.getAssetTypes()` — return available asset type enum
- `assets.listTrash()` / `assets.restoreAsset()` / `assets.emptyTrash()`
- `assets.purgeClipboardForTask(taskId)` — soft-delete clipboard-source assets for a completed task (gated by `purgeClipboardOnComplete` setting)

## Key Files

```
plugins/assets/
  index.ts                    — Plugin entry, hooks, routes, exec tools, settings
  routes/list.ts              — Listing with filters + pagination
  routes/upload.ts            — Multipart file upload handler
  routes/file.ts              — File serving with MIME types
  routes/delete.ts            — Soft-delete to trash
  routes/list-trash.ts        — Trash listing
  routes/restore.ts           — Restore from trash
  routes/permanent-delete.ts  — Permanent delete of trashed item
  routes/empty-trash.ts       — Bulk trash clear
  routes/link.ts              — PATCH /link (metadata-only)
  routes/retype.ts            — PATCH /retype (metadata-only)
  routes/content.ts           — PUT /content (inline text editing)
  lib/path-for-filename.ts    — Pure-function path resolver (THE invariant)
  lib/filename-id.ts          — Canonical filename generation + predicates
  lib/save-asset.ts           — Canonical save pipeline (name, write, sidecar, thumb)
  lib/ingest-inbox.ts         — Inbox → store canonicalization sweep
  lib/trash.ts                — Trash operations (softDelete, restoreAsset, listTrash, etc.)
  lib/relink.ts               — Metadata-only relink
  lib/retype.ts               — Metadata-only retype
  lib/sidecar.ts              — Sidecar read/write/validate/normalize
  lib/asset-index.ts          — In-memory index + variant grouping
  lib/asset-url.ts            — Filename → /api/assets/{filename} URL builder
  lib/content-extractor.ts    — Text extraction for search indexing
  lib/constants.ts            — Asset types, extensions, MIME mapping

src/components/assets/
  assets-page.tsx             — Main page with URL state
  asset-filters.tsx           — PluginHeader + FacetFilter + view toggle
  upload-dialog.tsx           — Drag-drop upload
  asset-card.tsx              — Grid card with thumbnail
  assets-grid.tsx             — Responsive grid
  assets-list.tsx             — Sortable table
  asset-detail.tsx            — Full-screen preview modal
  asset-pagination.tsx        — Page controls
  trash-grid.tsx              — Trash view
  task-assets.tsx             — Embedded widget for task drawer
  delete-asset-dialog.tsx     — Confirmation dialog

src/hooks/use-assets.ts       — Data fetching + SSE live updates
```

## MCP Exec Tools

| Tool | Description |
|------|-------------|
| `bakin_exec_assets_list` | List assets with optional filters (type, agent, taskId, tag) |
| `bakin_exec_assets_get` | Read sidecar metadata by filename |
| `bakin_exec_assets_save` | Save agent-created file with canonical naming + sidecar |
| `bakin_exec_assets_delete` | Soft-delete to trash |
| `bakin_exec_assets_link` | Edit sidecar `taskId` (metadata-only; no move) |
| `bakin_exec_assets_retype` | Edit sidecar `type` (metadata-only; no move) |
| `bakin_exec_assets_update_content` | Rewrite text content for editable MIME types |
| `bakin_exec_assets_list_trash` | List trash with expiry info |
| `bakin_exec_assets_restore` | Restore a trashed filename to its canonical shard |
| `bakin_exec_assets_audit` | Health check: missing thumbnails, invalid sidecars, orphaned files |
| `bakin_exec_assets_empty_trash` | Permanently delete all trash |
| `bakin_exec_assets_permanent_delete` | Permanently delete a specific trashed item |

All tools accept **filenames**, never paths. Agents should treat filenames as stable identity and avoid caching paths.

### Dispatch hint — `bakin_exec_assets_open`

`src/core/dispatch.ts` points agents at a `bakin_exec_assets_open` tool that is **not yet registered**. The spec defines it as a sidecar-plus-extracted-content reader, but the handler has not landed. Agents currently calling it will get "tool not found". Either register the tool (mirror `assets_get` + `content-extractor`) or rewrite the dispatch hint to call `assets_get` + `file` REST. Tracked as follow-up.

## Editable Asset Types

`isEditableMimeType()` from `lib/constants.ts` identifies MIME types that support inline content editing via `PUT /content`:

`text/markdown`, `text/plain`, `application/rtf`, `text/yaml`, `application/yaml`, `application/json`, `text/csv`, `text/tab-separated-values`, `application/xml`

Binary types (images, video, audio, PDF) are not editable.

## Manual Upload & Clipboard Paste

### Upload Route (`POST /upload`)
Accepts multipart form data. Used by both the upload dialog and clipboard paste handler.
- Auto-detects asset type from file extension via `getAssetType()`.
- Writes to temp dir, calls `saveAsset()` (canonicalizes name, creates sidecar, generates thumbnail), cleans up.
- Sets `source` field: `"upload"` (dialog) or `"clipboard"` (paste).
- SSE broadcast happens automatically via the file watcher.

### Upload Dialog
"Add" button in the Assets page header opens a drag-drop dialog with optional metadata fields.

### Clipboard Paste in Task Details
`onPaste` handler on the task description `<Textarea>`:

- **Images**: detected via `image/*` clipboard items. Uploaded, markdown image ref inserted: `![pasted image](/api/assets/{filename})`.
- **Long text** (20+ lines or 500+ chars): saved as `.md`. Compact reference: `[Attached: filename (N lines)](/api/assets/{filename})`.
- **Short text**: passes through normally.

### Dispatch Context
`buildDispatchMessage()` scans the filesystem (not the description) for sidecars whose `taskId` matches the task. It attaches those filenames to the dispatch message so agents know what to read.

### Clipboard Purge
Plugin setting `purgeClipboardOnComplete` (default: false). When enabled, clipboard-source assets are soft-deleted when their linked task moves to Done. Triggered via `assets.purgeClipboardForTask` hook from `task-service.ts`.

## Antfly Search

Assets are indexed in Antfly via `ctx.search` for hybrid search.

**Table:** `bakin_assets`
**Document key:** the canonical filename (stable across retype/relink because neither operation touches the filename).

**Schema:**

| Field | Type | Notes |
|-------|------|-------|
| `description` | text | From sidecar |
| `tags` | text | Comma-separated |
| `agent` | keyword | Creating agent |
| `task_id` | keyword | Linked task (sidecar) |
| `asset_type` | keyword | From sidecar `type` field |
| `file_name` | text | Canonical filename |
| `tool` | keyword | Creation tool |
| `updated_at` | datetime | Creation timestamp |

**Indexing triggers** (all in `plugins/assets/index.ts`):
- `indexAsset(filename)` after: upload (REST), save (MCP), restore from trash, retype (REST + MCP), relink (REST + MCP), content edit.
- `ctx.search.remove(filename)` after: delete/trash (REST + MCP).

**Reindex:** scans `assets/store/**/*.meta.json`, reads the sidecar, indexes under the filename key.

**Verify exists:** looks up `{filename}.meta.json` at its derived path. Orphan cleanup removes entries whose sidecar no longer exists.

Because the document key is the filename, retype/relink are single `index()` calls that overwrite the existing document in-place — no remove-and-re-add churn, no search-index orphans.
