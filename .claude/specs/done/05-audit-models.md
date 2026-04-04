# Phase 5: Audit — Models Plugin

**Applies:** `05-audit-template.md` checklist
**Status:** Done

## Final Inventory

| Surface | Count | Details |
|---------|-------|---------|
| HTTP routes | 9 | `GET /available`, `GET /config`, `POST /config`, `POST /defaults`, `GET /aliases`, `POST /aliases`, `POST /gateway/restart`, `GET /profiles`, `PUT /profiles` |
| MCP exec tools | 2 | `bakin_exec_models_list`, `bakin_exec_models_get_config` |
| Hooks registered | 3 | `models.configChanged`, `models.getEffectiveModel`, `models.getAvailableModels` |
| Components | 1 | `ModelsPage` — 4 tabs (agents, available, aliases, profiles) with inline global defaults editor |
| Settings schema | 2 fields | `showUsageMetrics` (boolean), `defaultModel` (select) |
| Lifecycle hooks | none | |
| Tests | 23 | Plugin contract, all routes, exec tools, validation |

## Phase 5A Items — Done

### Settings Schema — Done
Two fields: `showUsageMetrics` (boolean), `defaultModel` (select with 3 model options).

### Activity & Audit — Done
All 5 mutation routes have both `ctx.activity.audit()` and `ctx.activity.log()`.

### Agent Metadata — Done
Replaced hardcoded `AGENT_META` with `team.listAgents` hook (30s TTL cache).

### Hook Registrations — Done
- `models.configChanged` — notification hook
- `models.getEffectiveModel` — query hook (agentId → modelId)
- `models.getAvailableModels` — query hook (→ AvailableModel[])

### Manifest — Done
Dependencies: `["team"]`.

## Phase 5B Items — Done

### Route Surface Parity — Done

| Operation | HTTP API Route | MCP Exec Tool | Status |
|-----------|---------------|---------------|--------|
| List models | `GET /available` | `bakin_exec_models_list` | Done |
| Get config | `GET /config` | `bakin_exec_models_get_config` | Done |
| Update config | `POST /config` | — | Done (human-only) |
| Set defaults | `POST /defaults` | — | Done (human-only) |
| Get aliases | `GET /aliases` | — | Done (UI-only) |
| Set aliases | `POST /aliases` | — | Done (human-only) |
| Restart gateway | `POST /gateway/restart` | — | Done (human-only) |
| Get profiles | `GET /profiles` | — | Done |
| Update profiles | `PUT /profiles` | — | Done |

### Route Standardization — Done
- `POST /restart` → `POST /gateway/restart`

### Zod Validation — Done
All POST/PUT routes validate input with Zod schemas. 400 response with issues on failure.

### Task Profiles — Done
Editable task profiles stored via plugin settings. Each profile: `{ taskType, recommendedModel, notes }`. Seeded from defaults on first load. Not wired to dispatch yet — ready for OpenClaw per-request model support.

### UI Hardening — Done
- URL-backed tab state via `useQueryState('tab', 'agents')` with `<Suspense>`
- Pink accent tab bar (matching agent detail page)
- AgentAvatar instead of emoji icons
- Shared `ModelSelect` grouped by provider
- Loading skeletons, error banners, empty states on all tabs
- Full-width layout (no max-w constraint)
- PluginHeader with model count badge

### Current Behavior Notes
- `GET /available` is sourced from `openclaw models list --all --json`, filtered to models where `available === true`
- The Models page manages global default + fallback models directly from `agents.defaults.model`
- The previous "Tool Models" display column was removed because it was hardcoded UI, not real config

### Tests — Done
23 tests covering: plugin activation contract, all 9 routes, both exec tools, Zod validation edge cases.

## Catch-all Route Fix (Bonus)
Fixed `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` — hooks were stubbed out (`has: () => false`, `invoke: async () => undefined`). Now delegates to `globalThis.__bakinHookRegistry`. Benefits all plugins using cross-plugin hooks from API routes.
