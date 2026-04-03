# Phase 5: Audit — Health Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Done

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 5 | `GET /summary`, `GET /requests`, `GET /usage`, `GET /registry`, `GET /doctor` |
| MCP exec tools | 2 | `bakin_exec_health_status`, `bakin_exec_health_doctor` |
| Hooks registered | 0 | |
| Components | 1 | `HealthPage` — dashboard with 8 sections, pagination, search |
| Settings schema | 2 fields | `refreshInterval` (number), `showDetailedMetrics` (boolean) |
| Lifecycle hooks | 1 | `onReady()` — logs baseline doctor results |
| Tests | 1 | Plugin contract test coverage |

## Phase 5A Items

### Settings Schema — Done
```typescript
settingsSchema: {
  fields: [
    { key: 'refreshInterval', type: 'number', default: 30 },
    { key: 'showDetailedMetrics', type: 'boolean', default: true },
  ],
}
```

### Activity & Audit
Read-only/monitoring plugin — no mutations, no audit needed.

### Lifecycle Hooks — Done
- `onReady()` — logs baseline error/warning counts from cached doctor results

## Phase 5B Items

### Route Surface Parity — Done

| Operation | HTTP API Route | MCP Exec Tool | Status |
|-----------|---------------|---------------|--------|
| System summary | `GET /summary` | `bakin_exec_health_status` | Done |
| Request log | `GET /requests` | — | Done (UI-only) |
| Agent usage | `GET /usage` | — | Done (UI-only) |
| Plugin registry | `GET /registry` | — | Done (UI-only) |
| Run doctor | `GET /doctor` | `bakin_exec_health_doctor` | Done |

### Route Migration — Done
- `/api/doctor` moved from `server.ts` into health plugin as `GET /doctor`
- CLI updated to use `/api/plugins/health/doctor?fresh=true`
- `api-docs.ts` core route entry removed (auto-registered via plugin system)

### UI Polish — Done
- OpenClaw dashboard link (uses browser hostname + gateway port for Tailscale compat)
- Updated/date combined on one line
- Section renames: Tool Usage, Session Cost (est.), Active Plugins, Active Tools
- Plugin descriptions surfaced from `bakin-plugin.json` manifests
- Tool source chips show `plugin:{id}` format
- Tools sorted by lastUsed desc, then calls desc
- Pagination on tools, endpoints, recent requests (page size 20)
- Search on Active Plugins and Active Tools
- Memory card shows percentage of total with color-coded progress bar
