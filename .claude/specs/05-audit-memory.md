# Phase 5: Audit — Memory Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 3 | `GET /audit`, `GET /workspace`, `GET /gateway` |
| MCP exec tools | 0 | |
| Hooks registered | 0 | |
| Components | 6 | agent browser, log viewer, etc. |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  retentionDays: { type: 'number', default: 90, label: 'Audit retention (days)', description: 'Auto-archive audit entries older than this' },
}
```

### Activity & Audit
Read-only plugin — no mutations, no audit needed.

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| Search audit | `GET /audit` | `bakin_exec_memory_search` | **New** — agent searches past activity/decisions |
| Get workspace | `GET /workspaces/{agentId}` | `bakin_exec_memory_workspace` | **New** — agent reads another agent's workspace |
| Get gateway log | `GET /gateway` | — | UI-only |

**MCP consideration:** Memory is primarily a viewer, but agents benefit from being able to search audit history and read other agents' workspaces. Two exec tools would cover this.

### Route Standardization
- `GET /workspace?agentId=X` → `GET /workspaces/{agentId}`

### Deep Linking
- `src/app/memory/agents/[id]/page.tsx` — direct workspace view for an agent

### Minimal Changes
Memory is the simplest plugin — read-only viewer. Main work is route path cleanup and optional exec tools.
