# Phase 5: Audit — Assets Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (7):** `/list`, `/file`, `/delete`, `/list-trash`, `/restore`, `/permanent-delete`, `/empty-trash`
- **Exec tools:** None (save-asset is a core script in `scripts/lib/save-asset.ts`)
- **Nav items:** Assets (order 20)
- **Client components:** 0 (UI is in `src/components/assets/`)
- **Cross-plugin deps:** imports `watcher` from `src/core/`

## Plugin-Specific Focus Areas

### Component Location
Assets has 0 plugin-local components — all UI lives in `src/components/assets/`. These should move into the plugin's `components/` directory for proper encapsulation.

### Route Standardization
- `/file?path=...` → `/files/{encoded-path}` or keep query param (file paths are complex)
- `/list?type=images&taskId=abc` is fine as query-based filtering
- Add `GET /{assetId}` for individual asset metadata (deep linking)

### Deep Linking
- `/assets` shows browser — need `/assets/{type}/{taskId}/{filename}` or similar for direct links to specific assets
- Currently uses query params for navigation

### Thumbnail Generation
Major feature gap — currently no thumbnail system:
- On upload/save: generate WebP thumbnails at standard sizes (128, 256, 512px)
- Store alongside original in a `.thumbs/` subdirectory
- Gallery view uses thumbnails for fast loading
- Settings toggle: `thumbnails: boolean`

### Antfly Indexing
- Assets should be indexed for full-text search
- Text assets: index content
- Image/video assets: index metadata (title, tags, agent, task)
- Settings toggle: `indexing: boolean`

### Image Optimization
- Optional optimization on upload (compress, convert to WebP)
- Settings toggle: `optimization: boolean`
- Settings: `maxFileSize: number` (MB)

### Exec Tools
The `beacon_exec_save_asset` core script should become a plugin-registered tool:
- Move from `scripts/lib/save-asset.ts` into `plugins/assets/scripts/`
- Register via `ctx.registerExecTool()`
- Add additional tools: `bakin_exec_assets_list`, `bakin_exec_assets_get`, `bakin_exec_assets_delete`

### Hook Integration
- **Provides:** `asset:created`, `asset:deleted`, `asset:restored`
- **Consumes:** `task:completed` (to finalize/archive task assets)

### Sidecar Metadata
Audit the `.meta.json` sidecar pattern for consistency:
- All assets should have sidecars
- Schema should be validated (Zod)
- Missing sidecars should be auto-generated from available info

## Settings Schema
```typescript
settingsSchema: {
  thumbnails: { type: 'boolean', default: true, label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload' },
  indexing: { type: 'boolean', default: true, label: 'Antfly indexing', description: 'Index content for full-text search' },
  optimization: { type: 'boolean', default: false, label: 'Optimize images', description: 'Auto-compress and convert images to WebP' },
  maxFileSize: { type: 'number', default: 50, label: 'Max file size (MB)', description: 'Reject uploads larger than this' },
}
```
