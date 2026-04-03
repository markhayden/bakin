# Phase 5: Audit — Assets Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 7 | `/list`, `/file`, `/delete`, `/list-trash`, `/restore`, `/permanent-delete`, `/empty-trash` |
| MCP exec tools | 0 | `save-asset` is a core script in `scripts/lib/save-asset.ts` |
| Hooks registered | 8 | validateSidecar, getSidecarPath, createStub, detectVariant, getAssetTypes, listTrash, restoreAsset, emptyTrash |
| Components | 0 in plugin, **9 misplaced** in `src/components/assets/` |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  thumbnails: { type: 'boolean', default: true, label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload' },
  maxFileSize: { type: 'number', default: 50, label: 'Max file size (MB)', description: 'Reject uploads larger than this' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to: delete, restore, permanent-delete, empty-trash.

### Component Relocation
Move 9 .tsx files from `src/components/assets/` → `plugins/assets/components/`:
- asset-filters.tsx, asset-detail.tsx, assets-grid.tsx, assets-list.tsx, asset-card.tsx, assets-page.tsx, delete-asset-dialog.tsx, task-assets.tsx, trash-grid.tsx

Update imports in `src/app/assets/page.tsx` and anywhere else referencing `@/components/assets/`.

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| List assets | `GET /` | `bakin_exec_assets_list` | Agent browses available assets |
| Get asset | `GET /files/{path}` | `bakin_exec_assets_get` | Agent retrieves specific asset metadata |
| Save/upload | `POST /` | `bakin_exec_assets_save` | **Critical** — agent saves generated content. Migrate from `scripts/lib/save-asset.ts` |
| Delete | `DELETE /{assetId}` | `bakin_exec_assets_delete` | Agent removes asset |
| List trash | `GET /trash` | `bakin_exec_assets_list_trash` | Agent checks recoverable assets |
| Restore | `POST /trash/{assetId}/restore` | `bakin_exec_assets_restore` | Agent recovers asset |
| Empty trash | `DELETE /trash` | — | Human-only destructive op |
| Permanent delete | `DELETE /trash/{assetId}` | — | Human-only destructive op |

**MCP gap:** Agents currently save assets via the `bakin_exec_save_asset` core script. This should become a plugin-registered exec tool with proper Zod schemas and activity logging.

### Route Standardization
- `/file?path=...` → `GET /files/{encodedPath}` or keep query param (paths with slashes are complex)
- `/list-trash` → `GET /trash`
- `/restore` → `POST /trash/{assetId}/restore`
- `/permanent-delete` → `DELETE /trash/{assetId}`
- `/empty-trash` → `DELETE /trash`

### Hook Events (Notification Hooks)
- `assets.created` — `{ path, type, taskId, agentId }`
- `assets.deleted` — `{ path, type }`
- `assets.restored` — `{ path, type }`

### Sidecar Metadata
Audit `.meta.json` sidecar pattern:
- All assets should have sidecars
- Schema should be validated (Zod)
- Missing sidecars auto-generated from available info
