# Phase 5: Plugin Audit — Template

**Status:** In Progress
**Dependencies:** Phases 3 (design system) and 4 (plugin architecture) — Phase 4 complete

## Purpose

Every plugin gets audited against a standard checklist. This template defines the checklist. Individual plugin specs (05-audit-{pluginId}.md) apply this template with plugin-specific notes.

## Three Route Surfaces

Every plugin exposes functionality through up to three surfaces. All three must be audited for consistency:

1. **HTTP API routes** — Registered via `ctx.registerRoute()`. Consumed by the frontend (fetch), CLI (`bakin <command>`), and external tools (curl). Must follow REST conventions.
2. **MCP exec tools** — Registered via `ctx.registerExecTool()`. Consumed by AI agents through the MCP server. Must follow `bakin_exec_{pluginId}_{action}` naming. These are the agent's primary interface to plugin functionality.
3. **CLI commands** — Thin wrappers around HTTP API routes in `cli/bakin.ts`. Every major operation should be reachable from the CLI.

**Parity rule:** If an operation is available via HTTP API, it should also be available as an MCP exec tool (for agents) unless it's purely UI-serving (e.g., paginated list for rendering). Conversely, if an agent needs to perform an action, there must be an exec tool for it — agents should never need to `curl` the API directly.

## Standard Audit Checklist

### 1. Manifest
- [ ] `bakin-plugin.json` has all required fields (id, name, version, bakin, description, entry)
- [ ] Dependencies accurately listed (plugin deps, not npm deps)
- [ ] Secrets declared for any vault keys used
- [ ] Permissions match actual usage

### 2. HTTP API Routes
- [ ] All routes inventoried
- [ ] Naming follows REST convention (`GET /items`, `POST /items`, `GET /items/{id}`)
- [ ] All resources accessible by path segment ID (not query params)
- [ ] JSON response helper used consistently
- [ ] Error responses include meaningful messages with status codes
- [ ] Route handlers use `ctx.activity.audit()` for mutations

### 3. MCP Exec Tools
- [ ] All agent-facing operations covered as exec tools
- [ ] Tools follow `bakin_exec_{pluginId}_{action}` naming
- [ ] Parameters use Zod schemas with `.describe()` annotations
- [ ] Handlers return `{ ok, error?, details? }` shape
- [ ] Tools use `ctx.activity.log()` to report progress
- [ ] Tools use `ctx.activity.audit()` for structured audit trail
- [ ] Tool descriptions are clear enough for an agent to use without docs

### 4. Settings Schema
- [ ] `settingsSchema` defined with all configurable options
- [ ] Each setting has type, default, label, description
- [ ] Settings accessed via `ctx.getSettings()`, not hardcoded
- [ ] Secrets use vault, not settings

### 5. Client Components
- [ ] Uses shadcn/ui base components only
- [ ] Follows design system patterns (CVA, cn(), Tailwind tokens)
- [ ] Agent representations use `AgentAvatar`
- [ ] Loading states use skeleton components
- [ ] Error states with retry action
- [ ] Empty states with illustration + action
- [ ] Forms track dirty state

### 6. Page Routes
- [ ] Page at `src/app/{pluginId}/page.tsx`
- [ ] Detail page at `src/app/{pluginId}/[id]/page.tsx` (if plugin has addressable items)
- [ ] Uses `<PageLayout>` wrapper
- [ ] Consistent breadcrumbs and actions

### 7. Hook Integration
- [ ] Provides hooks for its significant state changes (notification hooks)
- [ ] Provides functional hooks for data access (read/query hooks)
- [ ] Consumes hooks from other plugins (not direct imports)
- [ ] No direct imports from other plugin `lib/` directories

### 8. Activity & Audit
- [ ] Significant operations use `ctx.activity.log()` (SSE feed)
- [ ] Audit events emitted via `ctx.activity.audit()` (structured trail)
- [ ] Agent identity propagated in all entries
- [ ] No raw `appendAudit()` or `globalThis.__bakinBroadcast` calls

### 9. Tests
- [ ] Test directory exists
- [ ] Contract test covers plugin activation
- [ ] Happy path covered for all HTTP routes
- [ ] Error cases covered
- [ ] Exec tool handlers tested (if any)

### 10. Accessibility
- [ ] Interactive elements have tab order
- [ ] Icon-only buttons have aria-labels
- [ ] Keyboard navigation for primary flows
