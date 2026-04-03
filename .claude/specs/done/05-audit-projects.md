# Phase 5: Audit — Projects Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 14 | `/list`, `/get`, `/create`, `/update`, `/delete`, `/checklist/*` (6), `/assets/*` (2), `/ask` |
| MCP exec tools | 12 | project_list, project_get, project_create, project_update, project_delete, project_add_item, project_mark_item, project_remove_item, project_link_item, project_promote_item, project_attach_asset, project_detach_asset |
| Hooks registered | 2 | readProject, autoCheckLinkedItem |
| Components | 6 | project-card, project-detail, project-checklist, project-grid, project-status-badge, project-editor |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 1 file | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  defaultStatus: { type: 'select', default: 'active', options: ['active', 'planning', 'paused'], label: 'Default project status', description: 'Status assigned to new projects' },
  autoPromoteThreshold: { type: 'number', default: 0, label: 'Auto-promote threshold', description: 'Auto-promote checklist items to tasks when project has more than N unchecked items (0 = disabled)' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to all 11 mutation routes.

### Reference Implementation
Projects is the **most complete plugin** — 12 exec tools, 14 routes, proper Zod schemas. Use as the gold standard when auditing other plugins for exec tool coverage and response shape consistency.

## Phase 5B Items

### Route Surface Parity

Projects already has good parity. Gaps:

| Operation | HTTP API Route | MCP Exec Tool | Status |
|-----------|---------------|---------------|--------|
| List | `GET /` | `bakin_exec_project_list` | Exists — standardize path from `/list` |
| Get | `GET /{projectId}` | `bakin_exec_project_get` | Exists — standardize from `/get?id=X` |
| Create | `POST /` | `bakin_exec_project_create` | Exists |
| Update | `PUT /{projectId}` | `bakin_exec_project_update` | Exists |
| Delete | `DELETE /{projectId}` | `bakin_exec_project_delete` | Exists |
| Add checklist item | `POST /{projectId}/checklist` | `bakin_exec_project_add_item` | Exists — standardize path |
| Toggle item | `POST /{projectId}/checklist/{itemId}/toggle` | `bakin_exec_project_mark_item` | Exists — standardize path |
| Update item | `PUT /{projectId}/checklist/{itemId}` | — | Exists, no exec tool |
| Remove item | `DELETE /{projectId}/checklist/{itemId}` | `bakin_exec_project_remove_item` | Exists — standardize method |
| Link item | `POST /{projectId}/checklist/{itemId}/link` | `bakin_exec_project_link_item` | Exists — standardize path |
| Promote item | `POST /{projectId}/checklist/{itemId}/promote` | `bakin_exec_project_promote_item` | Exists — standardize path |
| Attach asset | `POST /{projectId}/assets` | `bakin_exec_project_attach_asset` | Exists — standardize path |
| Detach asset | `DELETE /{projectId}/assets/{assetId}` | `bakin_exec_project_detach_asset` | Exists — standardize path |
| Ask/brainstorm | `POST /{projectId}/ask` | `bakin_exec_project_ask` | Exists, no exec tool — **add** |

### Route Standardization
- `/get?id=X` → `GET /{projectId}`
- `/checklist/add` → `POST /{projectId}/checklist`
- `/checklist/toggle` → `POST /{projectId}/checklist/{itemId}/toggle`
- `/assets/attach` → `POST /{projectId}/assets`
- `/assets/detach` → `DELETE /{projectId}/assets/{assetId}`

### Hook Events (Notification Hooks)
- `projects.created` — `{ projectId, title }`
- `projects.updated` — `{ projectId }`
- `projects.itemChecked` — `{ projectId, itemId, checked }`
- `projects.deleted` — `{ projectId }`

### Deep Linking
Add `src/app/projects/[id]/page.tsx` for direct project view.
