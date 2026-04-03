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
  {type}/                     # text, images, video, audio, plans, data, other
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
  "originalFilename": "hero.png"
}
```

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
| `/file` | GET | `path`, `v` (cache bust) | Serves file with MIME type + ETag |
| `/:assetPath` | DELETE | — | Soft-delete to .trash/ |
| `/trash` | GET | — | Lists trashed items with expiry |
| `/trash/:file/restore` | POST | — | Restores from trash to original location |
| `/trash/:file` | DELETE | — | Permanently removes trashed item |
| `/trash` | DELETE | — | Bulk delete all trash |

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

1. **On save** (`scripts/lib/save-asset.ts`): Image assets auto-generate `.thumb.jpg` via `generateThumbnail()` (ffmpeg, 400px wide, quality 5)
2. **Audit repair** (`scripts/lib/audit-assets.ts`): `bakin_exec_audit_assets --fix` generates missing thumbnails
3. **Grid/list display**: UI prefers `variant.role === 'thumbnail'` for preview URLs, falls back to full image
4. **Lazy loading**: Grid images use `loading="lazy"` for deferred offscreen loading

## Trash Lifecycle

1. `DELETE /:assetPath` moves file to `.trash/{filename}__deleted-{timestamp}`
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

### Cross-Plugin Hooks
Registered in `plugins/assets/index.ts` via `ctx.hooks.register()`:
- `assets.validateSidecar(metaPath)` — validate sidecar fields
- `assets.getSidecarPath(assetPath)` — resolve .meta.json path
- `assets.createStub(assetPath)` — auto-create metadata from directory context
- `assets.detectVariant(filename)` — check if file is a variant
- `assets.getAssetTypes()` — return available asset type enum
- `assets.listTrash()` / `assets.restoreAsset()` / `assets.emptyTrash()`

## Key Files

```
plugins/assets/
  index.ts                    — Plugin entry, hooks, routes, settings
  routes/list.ts              — Asset listing with filters + pagination
  routes/file.ts              — File serving with MIME types
  routes/delete.ts            — Soft-delete
  routes/list-trash.ts        — Trash listing
  routes/restore.ts           — Restore from trash
  lib/asset-index.ts          — In-memory index, variant grouping
  lib/sidecar.ts              — Sidecar read/write/validate/normalize
  lib/constants.ts            — Asset types, extensions, MIME mapping
  lib/trash.ts                — Trash operations

src/components/assets/
  assets-page.tsx             — Main page with URL state, pagination, sorting
  asset-filters.tsx           — PluginHeader + FacetFilter + view toggle
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
