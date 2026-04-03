# Phase 5: Audit — Calendar Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 7 | `GET /items`, `POST /items`, `POST /items/update`, `POST /items/delete`, `POST /items/approve`, `POST /items/reject`, `POST /brainstorm` |
| MCP exec tools | 0 | |
| Hooks registered | 0 | |
| Components | 4 | |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  defaultView: { type: 'select', default: 'month', options: ['month', 'week', 'list'], label: 'Default view', description: 'Calendar view shown on page load' },
  showScheduleJobs: { type: 'boolean', default: false, label: 'Show schedule jobs', description: 'Display recurring schedule jobs on the calendar' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to: create, update, delete, approve, reject.

### Manifest
Dependencies: should be `["tasks"]` if calendar items can link to tasks. Verify.

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| List items | `GET /items` | `bakin_exec_calendar_list` | **New** — agent checks upcoming schedule |
| Get item | `GET /items/{itemId}` | `bakin_exec_calendar_get` | **New** — agent reads specific item |
| Create item | `POST /items` | `bakin_exec_calendar_create` | **New** — agent schedules content |
| Update item | `PUT /items/{itemId}` | `bakin_exec_calendar_update` | **New** — agent modifies scheduled item |
| Delete item | `DELETE /items/{itemId}` | — | Human-only |
| Approve | `POST /items/{itemId}/approve` | — | Human-only (editorial approval) |
| Reject | `POST /items/{itemId}/reject` | — | Human-only |
| Brainstorm | `POST /brainstorm` | `bakin_exec_calendar_brainstorm` | **New** — agent generates content ideas |

**MCP gap:** Calendar has 0 exec tools. Agents cannot schedule content, check upcoming items, or brainstorm — all critical capabilities for content-producing agents.

### Route Standardization
- `POST /items/update` → `PUT /items/{itemId}`
- `POST /items/delete` → `DELETE /items/{itemId}`
- `POST /items/approve` → `POST /items/{itemId}/approve`
- `POST /items/reject` → `POST /items/{itemId}/reject`

### Hook Events (Notification Hooks)
- `calendar.itemCreated` — `{ itemId, date, title }`
- `calendar.itemApproved` — `{ itemId }`
- `calendar.itemRejected` — `{ itemId }`

### Deep Linking
- `src/app/calendar/[date]/page.tsx` — open calendar to specific date
