# Phase 5: Plugin Audit — Template

**Status:** Pending
**Dependencies:** Phases 3 (design system) and 4 (plugin architecture)

## Purpose

Every plugin gets audited against a standard checklist. This template defines the checklist. Individual plugin specs (05-audit-{pluginId}.md) apply this template with plugin-specific notes.

## Standard Audit Checklist

### 1. Manifest
- [ ] `bakin-plugin.json` has all required fields (id, name, version, beacon, description, entry)
- [ ] Dependencies accurately listed
- [ ] Secrets declared for any vault keys used
- [ ] Permissions match actual usage

### 2. Routes
- [ ] All routes inventoried
- [ ] Naming follows REST convention (`GET /items`, `POST /items`, `GET /items/{id}`)
- [ ] All resources accessible by path segment ID (not query params)
- [ ] Deep link support: page at `/pluginId/{resourceId}`
- [ ] JSON response helper used consistently
- [ ] Error responses include meaningful messages with status codes

### 3. MCP Exec Tools
- [ ] All tools follow `bakin_exec_{pluginId}_{action}` naming
- [ ] Parameters use Zod schemas with `.describe()` annotations
- [ ] Handlers return `{ ok, error?, details? }` shape
- [ ] Tools use `ctx.activity.log()` to report progress

### 4. Settings Schema
- [ ] `settingsSchema` defined with all configurable options
- [ ] Each setting has type, default, label, description
- [ ] Settings accessed via `ctx.getSettings()`, not hardcoded
- [ ] Secrets use `ctx.vault.get()`, not settings

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
- [ ] Detail page at `src/app/{pluginId}/[id]/page.tsx`
- [ ] Uses `<PageLayout>` wrapper
- [ ] Consistent breadcrumbs and actions

### 7. Hook Integration
- [ ] Provides hooks for its significant state changes
- [ ] Consumes hooks from other plugins (not direct imports)
- [ ] No direct imports from other plugin `lib/` directories

### 8. Activity & Audit
- [ ] Significant operations use `ctx.activity.log()`
- [ ] Audit events emitted via `ctx.activity.audit()`
- [ ] Agent identity propagated in all entries

### 9. Tests
- [ ] Test directory exists
- [ ] Happy path covered for all routes
- [ ] Error cases covered
- [ ] Exec tool handlers tested (if any)

### 10. Accessibility
- [ ] Interactive elements have tab order
- [ ] Icon-only buttons have aria-labels
- [ ] Keyboard navigation for primary flows
