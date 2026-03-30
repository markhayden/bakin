# Phase 5: Audit — Health Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 4 | `GET /summary`, `GET /requests`, `GET /usage`, `GET /registry` |
| MCP exec tools | 0 | |
| Hooks registered | 0 | |
| Components | 1 | |
| Settings schema | none | |
| Lifecycle hooks | none | |
| Tests | 0 | |

## Phase 5A Items

### Settings Schema
```typescript
settingsSchema: {
  refreshInterval: { type: 'number', default: 30, label: 'Refresh interval (seconds)', description: 'How often to poll for updated metrics' },
  showDetailedMetrics: { type: 'boolean', default: true, label: 'Detailed metrics', description: 'Show per-plugin and per-tool breakdowns' },
}
```

### Activity & Audit
Read-only/monitoring plugin — no mutations, no audit needed.

### Lifecycle Hooks
- `onReady()` — run initial doctor check, cache baseline metrics

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| System summary | `GET /summary` | `bakin_exec_health_status` | **New** — agent checks system health |
| Request log | `GET /requests` | — | UI-only |
| Agent usage | `GET /usage` | — | UI-only |
| Plugin registry | `GET /registry` | — | UI-only |
| Run doctor | `GET /doctor` | `bakin_exec_health_doctor` | **New** — agent triggers health check |
| Tool stats | `GET /tools` | — | UI-only |

**MCP consideration:** One or two exec tools so agents can self-diagnose system health. The `health_status` tool is useful for agents to check if the system is healthy before starting work.

### Route Additions
- `GET /doctor` — trigger on-demand doctor check, return results
- `GET /tools` — exec tool usage statistics

### Components
Only 1 component today. Health dashboard needs:
- Doctor results display (OK/WARN/ERROR per check)
- Exec tool usage stats table
- Per-plugin activity metrics

**Note:** Expanded health dashboard UI may be deferred if scope is too large for Phase 5. Core routes and exec tools are the priority.
