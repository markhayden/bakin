# Phase 5: Audit — Projects Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (14):** `/list`, `/get`, `/create`, `/update`, `/delete`, `/checklist/add`, `/checklist/toggle`, `/checklist/update`, `/checklist/remove`, `/checklist/link`, `/checklist/promote`, `/assets/attach`, `/assets/detach`, `/ask`
- **Exec tools (12):** `beacon_exec_project_list`, `_get`, `_create`, `_update`, `_delete`, `_add_item`, `_mark_item`, `_remove_item`, `_link_item`, `_promote_item`, `_attach_asset`, `_detach_asset`
- **Nav items:** Projects (Compass, order 30)
- **Client components:** 6 (project-card, project-detail, project-checklist, project-grid, project-status-badge, project-editor)
- **Cross-plugin deps:** Dynamic imports of `tasks/taskboard` (deleteTask), `openclaw-client` (sendMessage)

## Plugin-Specific Focus Areas

### Route Standardization
- `/get?id=proj-123` → `/{projectId}` (GET)
- All checklist routes: `/checklist/add` → `/projects/{projectId}/checklist` (POST to add, PUT to update)
- Asset routes: `/assets/attach` → `/{projectId}/assets` (POST)

### Deep Linking
- `/projects` shows grid — need `/projects/{projectId}` page
- Currently project detail might be a drawer/modal — should support full page route

### Most Mature Plugin
Projects has the most complete exec tool coverage (12 tools) and the most comprehensive API (14 routes). Good reference implementation for other plugins.

### Hook Integration
- **Provides:** `project:item:checked`, `project:updated`, `project:created`, `project:deleted`
- **Consumes:** `task:completed` (to auto-check linked checklist items), `asset:created` (notifications)
- Replace dynamic `tasks/taskboard` import with `ctx.hooks.call('task:delete', ...)`
- Replace `openclaw-client` import with agent bridge (Phase 6)

### Brainstorm Feature
`/ask` route sends prompts to an agent with project context. This should use the agent bridge interface (Phase 6) rather than importing openclaw-client directly.

### Task Linking
Checklist items can link to board tasks via `[[task:id]]` syntax. The `autoCheckLinkedItem()` function in project-service is called from task-service when tasks complete — this is a prime candidate for hook replacement.

## Settings Schema
```typescript
settingsSchema: {
  defaultStatus: { type: 'select', default: 'active', options: ['active', 'planning', 'paused'], label: 'Default project status', description: 'Status assigned to new projects' },
  autoPromoteThreshold: { type: 'number', default: 0, label: 'Auto-promote threshold', description: 'Auto-promote checklist items to tasks when project has more than N unchecked items (0 = disabled)' },
}
```
