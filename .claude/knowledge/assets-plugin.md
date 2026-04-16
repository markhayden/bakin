# Assets Plugin

## Overview

The Assets plugin is the centralized content store for all files created by AI agents. When agents generate images, write text, produce video, export data, or create plans, those files land in the asset system with structured metadata — making them browsable, searchable, and linked back to the tasks that produced them.

### Why It Matters

Without a centralized asset system, agent-created files are scattered across task directories with no consistent way to browse, search, or manage them. The Assets plugin solves this by providing:

- **Organized storage** — Files are stored in a consistent directory structure by type and task, with sidecar metadata (agent, timestamps, tags, descriptions)
- **Variant management** — Thumbnails and optimized versions are generated automatically, reducing bandwidth and improving load times in the UI
- **Full-text searchable** — Asset metadata is indexed by Antfly for fast search across descriptions, tags, and filenames
- **Task integration** — Every asset links back to the task that created it, and task detail drawers show associated assets inline with preview modals
- **Trash lifecycle** — Soft-delete with 7-day retention prevents accidental data loss while keeping the library clean
- **Deep-linkable** — Every view state (filters, sort, selected asset) is URL-backed for bookmarking and sharing

## Storage Model

```
~/.bakin/assets/
  {type}/                     # text, images, video, audio, plans, research, pdf, data, other
    {taskId}/                 # Task directory (or _unlinked, library)
      YYYYMMDD-{slug}.{ext}  # Primary asset (date-prefixed, slugified)
      YYYYMMDD-{slug}.{ext}.meta.json   # Sidecar metadata
      YYYYMMDD-{slug}.thumb.jpg         # Thumbnail variant (400px wide)
      YYYYMMDD-{slug}.opt.jpg           # Optimized variant
  .trash/                     # Soft-deleted assets (7-day TTL)
    {filename}__deleted-{timestamp}
```

### Sidecar Metadata (.meta.json)

```json
{
  "agent": "pixel",
  "taskId": "b082bb01",
  "created": "2026-03-23T14:30:00.000Z",
  "tool": "dall-e-3",
  "description": "Hero image for blog post",
  "tags": ["social", "blog"],
  "originalFilename": "hero.png",
  "source": "agent"
}
```

The `source` field tracks how the asset was created: `"agent"` (MCP tool), `"upload"` (manual UI upload), or `"clipboard"` (pasted into task description). Used for lifecycle management (e.g., auto-purging clipboard assets on task completion).

Field aliases are auto-corrected: `author` -> `agent`, `createdAt` -> `created`, `task` -> `taskId`.

### Variant Naming

Variants are detected by filename pattern and grouped under their primary asset:
- `*.thumb.*` -> role: `thumbnail` (generated at 400px wide via ffmpeg)
- `*.opt.*` -> role: `optimized`

## API Routes

All under `/api/plugins/assets/`:

| Route | Method | Params | Notes |
|-------|--------|--------|-------|
| `/` | GET | `type`, `agent`, `taskId`, `tag`, `includeChildren`, `grouped`, `path`, `limit`, `offset` | Main listing with pagination |
| `/upload` | POST | multipart: `file`, `taskId?`, `description?`, `tags?`, `source?` | Upload files from UI or clipboard paste |
| `/file` | GET | `path`, `v` (cache bust) | Serves file with MIME type + ETag |
| `/` | DELETE | `path` | Soft-delete to .trash/ |
| `/trash` | GET | — | Lists trashed items with expiry |
| `/trash/:file/restore` | POST | — | Restores from trash to original location |
| `/trash/:file` | DELETE | — | Permanently removes trashed item |
| `/trash` | DELETE | — | Bulk delete all trash |
| `/link` | PATCH | JSON: `path`, `taskId` (string \| null) | Relink asset to different task or unlink (null → `_unlinked`) |
| `/retype` | PATCH | JSON: `path`, `type` (AssetType) | Change asset type — physically moves file to new type directory |
| `/content` | PUT | JSON: `path`, `content` (string) | Update text content of an editable asset (text MIME types only) |

Alternative file serving at `/api/assets/[...path]` supports range requests (video seeking).

## URL State

All filter/view state is URL-backed via `useQueryState`/`useQueryArrayState`:

| Param | Default | Values |
|-------|---------|--------|
| `view` | `grid` | `grid`, `list`, `trash` |
| `q` | (empty) | Search text |
| `type` | (empty) | Comma-separated: `images,video` |
| `asset` | (empty) | Asset path for detail deep link |
| `page` | `1` | Page number |
| `sort` | `created` | `name`, `type`, `size`, `created` |
| `dir` | `desc` | `asc`, `desc` |

Page size persisted in `localStorage` key `assets-page-size` (default: 24).

## Thumbnail Pipeline

1. **On save** (`plugins/assets/lib/save-asset.ts`): Image assets auto-generate `.thumb.jpg` via `generateThumbnail()` (ffmpeg, 400px wide, quality 5). Both Gemini-generated and raw-imported images (via `bakin_exec_gen_image --filePath`) go through this pipeline. Raw imports use `ffprobe` for dimension detection.
2. **Audit repair** (`scripts/lib/audit-assets.ts`): `bakin_exec_audit_assets --fix` generates missing thumbnails
3. **Grid/list display**: UI prefers `variant.role === 'thumbnail'` for preview URLs, falls back to full image
4. **Lazy loading**: Grid images use `loading="lazy"` for deferred offscreen loading

## Trash Lifecycle

1. `DELETE /?path=...` moves file to `.trash/{filename}__deleted-{timestamp}`
2. Sidecar is preserved alongside (for restore path resolution)
3. 7-day TTL before auto-purge
4. Restore infers original directory from sidecar `taskId` + asset type
5. Trash view shows expiry countdown per item

## Integration Points

### Task-Assets Widget
`src/components/assets/task-assets.tsx` embeds in the task detail drawer:
- Fetches assets for a task (including subtask children)
- Clicking an asset opens `AssetDetailModal` inline (no navigation)
- "View in Assets" link available inside the modal
- SSE listener auto-refreshes on `workflow.step_complete` events

### AssetDetailModal
`src/components/assets/asset-detail.tsx` exports a standalone modal:
- Accepts `assetPath` prop, fetches metadata from `/api/plugins/assets/list?path=...`
- Renders full preview + metadata sidebar
- Usable from any context without the full assets page
- **Type selector**: dropdown in the header to retype assets (physically moves file via `PATCH /retype`)
- **Inline editing**: Edit/Save/Cancel buttons for text-based assets. Uses shared `MarkdownEditor` from `src/components/markdown-editor.tsx`. Editable MIME types determined by `isEditableMimeType()` from `lib/constants.ts`

### Cross-Plugin Hooks
Registered in `plugins/assets/index.ts` via `ctx.hooks.register()`:
- `assets.validateSidecar(metaPath)` — validate sidecar fields
- `assets.getSidecarPath(assetPath)` — resolve .meta.json path
- `assets.createStub(assetPath)` — auto-create metadata from directory context
- `assets.detectVariant(filename)` — check if file is a variant
- `assets.getAssetTypes()` — return available asset type enum
- `assets.listTrash()` / `assets.restoreAsset()` / `assets.emptyTrash()`
- `assets.purgeClipboardForTask(taskId)` — soft-delete clipboard-source assets for a completed task (gated by `purgeClipboardOnComplete` setting)

## Key Files

```
plugins/assets/
  index.ts                    — Plugin entry, hooks, routes, settings
  routes/list.ts              — Asset listing with filters + pagination
  routes/upload.ts            — Multipart file upload handler
  routes/file.ts              — File serving with MIME types
  routes/delete.ts            — Soft-delete
  routes/list-trash.ts        — Trash listing
  routes/restore.ts           — Restore from trash
  lib/asset-index.ts          — In-memory index, variant grouping
  lib/sidecar.ts              — Sidecar read/write/validate/normalize
  lib/constants.ts            — Asset types, extensions, MIME mapping
  lib/trash.ts                — Trash operations
  lib/relink.ts               — Relink/unlink assets between tasks
  lib/retype.ts               — Retype assets between type directories
  routes/link.ts              — PATCH /link handler
  routes/retype.ts            — PATCH /retype handler
  routes/content.ts           — PUT /content handler (inline text editing)

src/components/assets/
  assets-page.tsx             — Main page with URL state, pagination, sorting
  asset-filters.tsx           — PluginHeader + FacetFilter + view toggle + Add button
  upload-dialog.tsx           — Drag-drop upload dialog
  asset-card.tsx              — Grid card with thumbnail preview
  assets-grid.tsx             — Responsive grid layout
  assets-list.tsx             — Table layout with sortable columns
  asset-detail.tsx            — Full-screen preview modal + AssetDetailModal
  asset-pagination.tsx        — Page controls with persistent page size
  trash-grid.tsx              — Trash view with restore/delete actions
  task-assets.tsx             — Embedded widget for task drawer
  delete-asset-dialog.tsx     — Confirmation dialog

src/hooks/use-assets.ts       — Data fetching + SSE live updates
scripts/lib/save-asset.ts     — MCP tool for standardized asset saving
scripts/lib/audit-assets.ts   — Audit tool with thumbnail generation
```

## MCP Exec Tools

| Tool | Description |
|------|-------------|
| `bakin_exec_assets_list` | List assets with optional type filter |
| `bakin_exec_assets_get` | Retrieve sidecar metadata by path |
| `bakin_exec_assets_save` | Save agent-created file with naming conventions and sidecar |
| `bakin_exec_assets_delete` | Soft-delete to trash |
| `bakin_exec_assets_link` | Move between task directories, update sidecar |
| `bakin_exec_assets_retype` | Change asset type — physically moves file to new type directory |
| `bakin_exec_assets_update_content` | Update text content of editable assets (text MIME types only) |
| `bakin_exec_assets_list_trash` | List trash with expiry info |
| `bakin_exec_assets_restore` | Restore from trash |
| `bakin_exec_assets_audit` | Health check: missing thumbnails, invalid sidecars, orphaned files |
| `bakin_exec_assets_empty_trash` | Permanently delete all trash |
| `bakin_exec_assets_permanent_delete` | Permanently delete specific trashed item |

The `save` and `retype` tools include a categorization rubric in their `type` parameter description to guide agents on when to use each type (text vs research vs plans, etc.).

## Editable Asset Types

`isEditableMimeType()` from `lib/constants.ts` identifies MIME types that support inline content editing via `PUT /content`:

`text/markdown`, `text/plain`, `application/rtf`, `text/yaml`, `application/yaml`, `application/json`, `text/csv`, `text/tab-separated-values`, `application/xml`

Binary types (images, video, audio, PDF) are not editable.

## Manual Upload & Clipboard Paste

### Upload Route (`POST /upload`)
Accepts multipart form data. Used by both the upload dialog and clipboard paste handler.
- Auto-detects asset type from file extension via `getAssetType()`
- Writes to temp dir, calls `saveAsset()`, cleans up
- Sets `source` field: `"upload"` (dialog) or `"clipboard"` (paste)
- SSE broadcast happens automatically via file watcher

### Upload Dialog
"Add" button in the Assets page header opens a dialog with drag-and-drop zone, file picker, and optional metadata fields (description, tags, task link). Supports multiple files.

### Clipboard Paste in Task Details
`onPaste` handler on the task description `<Textarea>`:
- **Images**: Detected via `image/*` clipboard items. Uploaded as asset, markdown image ref inserted: `![pasted image](/api/assets/{path})`
- **Long text** (20+ lines or 500+ chars): Saved as `.md` text asset. Compact reference inserted: `[Attached: filename (N lines)](/api/assets/{path})`
- **Short text**: Passes through normally (no interception)

Asset references use `/api/assets/` URLs, which render natively in `ReactMarkdown` and work in dispatch messages.

### Dispatch Context
`buildDispatchMessage()` scans task descriptions for `/api/assets/` references and appends an "Attached Context" section with filesystem paths so agents can read the files directly.

### Clipboard Purge
Plugin setting `purgeClipboardOnComplete` (default: false). When enabled, clipboard-source assets are soft-deleted to trash when their linked task moves to Done. Triggered via the `assets.purgeClipboardForTask` hook from `task-service.ts`.

## Antfly Search

Assets are indexed in Antfly via `ctx.search` for hybrid search across all asset types.

**Table:** `bakin_assets`

**Schema:**

| Field | Type | Notes |
|-------|------|-------|
| `description` | text | Asset description from sidecar |
| `tags` | text | Comma-separated tags |
| `agent` | keyword | Agent that created the asset |
| `task_id` | keyword | Linked task ID |
| `asset_type` | keyword | Type directory (images, text, video, etc.) |
| `file_name` | text | Original filename |
| `tool` | keyword | Tool used to create the asset |
| `updated_at` | datetime | Creation timestamp |

**Indexing triggers** (all in `plugins/assets/index.ts`):
- `indexAsset(relPath)` after: upload (REST), save (MCP), restore from trash
- `ctx.search.remove(path)` after: delete/trash (REST and MCP), relink (old path)
- `indexAsset(newPath)` after: relink (new path)

**Reindex:** `reindex()` generator scans `~/.bakin/assets/{type}/{subdir}/*.meta.json` across all `ASSET_TYPES`.

**Verify exists:** Checks if `{key}.meta.json` exists on disk. Orphan cleanup removes entries for trashed/deleted assets.
