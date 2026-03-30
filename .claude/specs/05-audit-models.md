# Phase 5: Audit — Models Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Pending

## Current Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 7 | `GET /available`, `GET /config`, `POST /config`, `POST /defaults`, `GET /aliases`, `POST /aliases`, `POST /restart` |
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
  showUsageMetrics: { type: 'boolean', default: true, label: 'Show usage metrics', description: 'Display token usage and cost estimates' },
  defaultModel: { type: 'select', default: 'claude-sonnet-4-6', options: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'], label: 'Default model', description: 'Default model for new agents' },
}
```

### Activity & Audit
Add `ctx.activity.audit()` to: config change, alias change, gateway restart.

### Manifest
Should declare `secrets: ["openclaw-api-key"]` if it reads gateway config/credentials.

## Phase 5B Items

### Route Surface Parity

| Operation | HTTP API Route | MCP Exec Tool | Agent Use Case |
|-----------|---------------|---------------|----------------|
| List models | `GET /available` | `bakin_exec_models_list` | **New** — agent checks available models |
| Get config | `GET /config` | `bakin_exec_models_get_config` | **New** — agent reads model assignments |
| Update config | `POST /config` | — | Human-only (model assignment is admin) |
| Set defaults | `POST /defaults` | — | Human-only |
| Get aliases | `GET /aliases` | — | UI-only |
| Set aliases | `POST /aliases` | — | Human-only |
| Restart gateway | `POST /gateway/restart` | — | Human-only (destructive) |

**MCP consideration:** Agents should be able to discover what models are available and what model they're assigned. They should NOT be able to change model assignments or restart the gateway.

### Route Standardization
- `POST /restart` → `POST /gateway/restart` (clarify what's being restarted)

### Hook Events (Notification Hooks)
- `models.configChanged` — `{ agentId, oldModel, newModel }`

### Minimal Changes
Models is a config plugin. Main work: 2 exec tools, route rename, audit on mutations.
