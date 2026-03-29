# Audit Plugin

Run through the standardized plugin audit checklist. Use this when auditing an existing plugin for production readiness (Phase 5).

## Usage

Provide the plugin id to audit (e.g., `tasks`, `assets`, `schedule`).

## Audit Checklist

### 1. Manifest
- [ ] `beacon-plugin.json` exists with all required fields
- [ ] Version is set and meaningful
- [ ] Dependencies accurately listed
- [ ] Secrets declared for any vault keys used
- [ ] Permissions match actual usage

### 2. Routes
- [ ] All routes inventoried (list every `ctx.registerRoute()` call)
- [ ] Naming follows convention: verb or resource pattern (`/list`, `/create`, `/{id}`)
- [ ] All resource routes accept ID as path segment for deep linking
- [ ] No query-param-only resource access (migrate `?id=X` to `/{id}`)
- [ ] JSON response helper used consistently
- [ ] Error responses include meaningful messages

### 3. MCP Exec Tools
- [ ] All tools inventoried (list every `ctx.registerExecTool()` call)
- [ ] Naming follows `beacon_exec_{pluginId}_{action}` convention
- [ ] Parameters use Zod schemas
- [ ] Handlers return `{ ok, error?, details? }` shape
- [ ] Tools log activity via `beacon_log_progress` or `ctx.activity.log()`

### 4. Settings Schema
- [ ] `settingsSchema` defined on plugin object with all configurable options
- [ ] Each setting has type, default, label, description
- [ ] Settings accessed via `ctx.getSettings()`, not hardcoded values
- [ ] Secrets use vault (`ctx.vault.get()`), not settings

### 5. Client Components
- [ ] Uses shadcn/ui base components (Button, Card, Input, etc.) — no custom primitives
- [ ] Follows design system patterns (CVA variants, cn() merging, Tailwind tokens)
- [ ] Loading states use skeleton components
- [ ] Error states display meaningful messages with retry options
- [ ] Empty states have illustration + message + action
- [ ] Forms track dirty state, disable submit when clean
- [ ] Agent representations use `AgentAvatar` component (no raw emoji/icons)

### 6. Page Route
- [ ] Page exists at `src/app/{pluginId}/page.tsx`
- [ ] Supports deep linking: `src/app/{pluginId}/[id]/page.tsx` for detail views
- [ ] Consistent page layout (title bar, breadcrumbs, actions top-right)
- [ ] Responsive layout

### 7. Hook Integration
- [ ] Events emitted for significant state changes (created, updated, deleted)
- [ ] Cross-plugin interaction uses hooks, not direct imports
- [ ] No direct imports from other plugin `lib/` directories

### 8. Activity & Audit
- [ ] Significant operations log to activity feed
- [ ] Audit events emitted for trackable actions
- [ ] Agent identity propagated in all audit entries

### 9. Tests
- [ ] Test directory exists (`tests/` or `__tests__/`)
- [ ] Happy path covered for all routes
- [ ] Error cases covered (missing params, invalid data)
- [ ] Exec tool handlers tested

### 10. Accessibility
- [ ] Interactive elements have proper tab order
- [ ] Buttons and links have aria-labels where icon-only
- [ ] Keyboard navigation works for primary flows

## Output

Generate a report with:
- `[PASS]` — meets standard
- `[FAIL]` — needs fix (describe what's wrong)
- `[SKIP]` — not applicable to this plugin
- Summary of required changes with file paths
