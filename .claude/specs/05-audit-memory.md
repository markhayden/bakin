# Phase 5: Audit — Memory Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (3):** `GET /audit`, `GET /workspace`, `GET /gateway`
- **Exec tools:** None
- **Nav items:** Memory (Brain, order 40)
- **Client components:** 6 (agent browser, log viewer, etc.)
- **Cross-plugin deps:** `agents-data` (AGENT_IDS)

## Plugin-Specific Focus Areas

### Minimal API
Only 3 routes — mostly a viewer/browser. Consider whether it needs:
- Full-text search of audit logs (via Antfly)
- Filtered audit views by agent, event type, date range
- Export/download of audit data

### Route Standardization
- `GET /audit` → fine (query params for filtering)
- `GET /workspace?agentId=<id>` → `GET /workspaces/{agentId}`
- `GET /gateway?date=...` → `GET /gateway/{date}` or keep query params

### Deep Linking
- `/memory` shows log viewer — add `/memory/agents/{agentId}` for direct workspace view
- `/memory/audit/{entryId}` for specific audit entry (if useful)

### Antfly Search Integration
Memory plugin is a natural fit for search:
- Search audit log entries by content, agent, event type
- Search agent workspace files
- Integrate search bar into the memory UI
- Use Antfly SDK (already configured in core)

### Timeline View
Current UI is likely a flat log. Consider:
- Timeline visualization of agent activity
- Grouped by agent or by time period
- Visual indicators for different event types (task moved, asset created, workflow step, etc.)

### Hook Integration
- **Provides:** None (read-only plugin)
- **Consumes:** All audit events for display — could subscribe to `task:*`, `asset:*`, `workflow:*` hooks for real-time updates in the UI

### Agent Workspace Viewer
`GET /workspace` reads OpenClaw workspace files (AGENTS.md, SOUL.md, etc.). This should be aware of the block-based injection system (Phase 7) — display Bakin-managed blocks visually distinct from user content.

## Settings Schema
```typescript
settingsSchema: {
  retentionDays: { type: 'number', default: 90, label: 'Audit retention (days)', description: 'Auto-archive audit entries older than this' },
  searchEnabled: { type: 'boolean', default: true, label: 'Full-text search', description: 'Enable Antfly-powered search across audit logs' },
}
```
