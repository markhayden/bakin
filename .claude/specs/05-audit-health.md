# Phase 5: Audit — Health Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (4):** `GET /summary`, `GET /requests`, `GET /usage`, `GET /registry`
- **Exec tools:** None
- **Nav items:** Health (Activity, order 85)
- **Client components:** 1
- **Cross-plugin deps:** `request-log`, `doctor`, `agent-usage` from `src/core/`

## Plugin-Specific Focus Areas

### GlobalThis Hack
Health plugin likely accesses plugin registry and exec tool stats via globalThis or direct imports. This needs to be cleaned up:
- Registry data should be available via a proper API (e.g., `ctx.getRegistrySnapshot()`)
- Exec tool stats via the existing `getExecToolStats()` from registry
- No globalThis references in plugin code

### Real-Time Charts
Currently 1 client component — likely a basic summary view. Needs:
- Real-time charts for request rate, error rate, agent activity
- Historical data (last hour, day, week)
- Per-agent activity breakdown
- SSE-powered live updates (subscribe to audit events)

### Doctor Integration
`src/core/doctor.ts` already runs health checks. Health plugin should:
- Display latest doctor results prominently
- Show `[OK]`, `[WARN]`, `[ERROR]`, `[FIXED]` status per check
- Allow triggering doctor run from UI
- Show check history over time

### Per-Plugin Activity Metrics
Once Phase 4's activity API is in place, health plugin can show:
- Activity volume per plugin
- Error rates per plugin
- Most used exec tools
- Slowest routes

### Alert Configuration
Future: configurable alerts when health thresholds are crossed:
- Error rate > threshold → notification
- Agent stuck > threshold → notification
- Disk space low → notification
Currently watchdog handles some of this — health plugin should surface watchdog state.

### Route Additions
- `GET /doctor` — run doctor checks on demand and return results
- `GET /doctor/history` — historical check results
- `GET /tools` — exec tool usage stats (separate from registry)

### Hook Integration
- **Provides:** None (consumer/viewer only)
- **Consumes:** All hooks for monitoring — `task:*`, `workflow:*`, `schedule:*`, `asset:*`

## Settings Schema
```typescript
settingsSchema: {
  refreshInterval: { type: 'number', default: 30, label: 'Refresh interval (seconds)', description: 'How often to poll for updated metrics' },
  showDetailedMetrics: { type: 'boolean', default: true, label: 'Detailed metrics', description: 'Show per-plugin and per-tool breakdowns' },
  alertOnErrors: { type: 'boolean', default: true, label: 'Alert on errors', description: 'Show banner alert when error rate exceeds threshold' },
}
```
