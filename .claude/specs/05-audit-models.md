# Phase 5: Audit — Models Plugin

**Applies:** `05-audit-template.md` checklist

## Current Inventory

- **Routes (7):** `GET /available`, `GET /config`, `POST /config`, `POST /defaults`, `GET /aliases`, `POST /aliases`, `POST /restart`
- **Exec tools:** None
- **Nav items:** Models (Cpu, order 65)
- **Client components:** 1
- **Cross-plugin deps:** None (self-contained)

## Plugin-Specific Focus Areas

### Route Standardization
- Routes are already reasonable for a config-style plugin
- `POST /restart` → `POST /gateway/restart` (clarify what's being restarted)
- Consider: `GET /agents/{agentId}/model` for per-agent model lookup

### Deep Linking
- `/models` shows config UI — likely no per-item deep linking needed
- Possibly: `/models/agents/{agentId}` to jump to a specific agent's config

### Per-Agent Config UI
Currently 1 client component. Needs:
- Table/grid showing each agent with their assigned model
- Inline editing: click to change model from dropdown
- Visual indication of which model each agent is using
- Model usage metrics (token counts, cost estimates if available)

### Usage Metrics
Track and display:
- Token usage per agent per model (data from `src/core/agent-usage.ts`)
- Historical usage trends (daily/weekly)
- Cost estimates based on model pricing
- Which agents are most active

### Gateway Management
`POST /restart` restarts the OpenClaw gateway. This is a sensitive operation:
- Confirm dialog in UI
- Only show to admin (or add a simple auth check)
- Log to audit trail
- Show gateway status (up/down/restarting)

### Exec Tools
Add agent-facing tools:
- `bakin_exec_models_get_config` — get current model assignments
- `bakin_exec_models_list_available` — list available models

### Hook Integration
- **Provides:** `models:config:changed` (when agent model assignments change)
- **Consumes:** None

## Settings Schema
```typescript
settingsSchema: {
  showUsageMetrics: { type: 'boolean', default: true, label: 'Show usage metrics', description: 'Display token usage and cost estimates' },
  defaultModel: { type: 'select', default: 'claude-sonnet-4-6', options: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'], label: 'Default model', description: 'Default model for new agents' },
}
```
