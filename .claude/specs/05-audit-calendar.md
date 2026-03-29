# Phase 5: Audit — Calendar Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (7):** `GET /items`, `POST /items`, `POST /items/update`, `POST /items/delete`, `POST /items/approve`, `POST /items/reject`, `POST /brainstorm`
- **Exec tools:** None
- **Nav items:** Calendar (order 25)
- **Client components:** 4
- **Cross-plugin deps:** `content-dir` (getContentDir)

## Plugin-Specific Focus Areas

### Route Standardization
- `GET /items?month=YYYY-MM` → fine as query-based filtering
- `POST /items/update` → `PUT /items/{itemId}`
- `POST /items/delete` → `DELETE /items/{itemId}`
- `POST /items/approve` → `POST /items/{itemId}/approve`
- `POST /items/reject` → `POST /items/{itemId}/reject`

### Deep Linking
- `/calendar` shows month view — need `/calendar/{date}` to open to a specific date
- `/calendar/items/{itemId}` for direct item detail

### Schedule Plugin Overlap
Calendar and Schedule plugins have related but distinct purposes:
- **Calendar:** Content scheduling — what content gets published when
- **Schedule:** Cron automation — recurring jobs that create tasks
- Clarify the boundary in documentation
- Consider: should calendar items automatically create schedule jobs?
- Consider: should schedule runs appear on the calendar view?

### Brainstorm Feature
`POST /brainstorm` sends prompts to agents for content ideation. Similar to projects' `/ask` — both should use the agent bridge interface (Phase 6).

### Exec Tools
Calendar has no agent-facing tools. Add:
- `bakin_exec_calendar_list` — list upcoming items
- `bakin_exec_calendar_create` — create calendar item
- `bakin_exec_calendar_update` — update item

These let agents schedule content as part of workflows.

### Hook Integration
- **Provides:** `calendar:item:created`, `calendar:item:approved`, `calendar:item:rejected`
- **Consumes:** `task:completed` (to auto-update linked calendar items), `asset:created` (to attach assets to calendar items)

## Settings Schema
```typescript
settingsSchema: {
  defaultView: { type: 'select', default: 'month', options: ['month', 'week', 'list'], label: 'Default view', description: 'Calendar view shown on page load' },
  showScheduleJobs: { type: 'boolean', default: false, label: 'Show schedule jobs', description: 'Display recurring schedule jobs on the calendar' },
}
```
