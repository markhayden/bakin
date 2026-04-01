# Phase 6: Plugin Page Route Refactor

**Status:** Pending
**Dependencies:** Phase 5 (plugin audits)

## Problem

All plugins currently use query params (`?taskId=`, `?jobId=`, `?itemId=`, `?asset=`) for selecting individual resources. This is fragile (dual-param race conditions), doesn't produce clean URLs, and — critically — isn't extensible to custom plugins because page routes are hardcoded as Next.js file-system routes in `src/app/`.

Projects was migrated to path-based routing (`/projects/[id]`, `/projects/[id]/edit`) as a proof of concept, but the other plugins and the underlying architecture still need work.

## Current State

| Plugin | Resource URL Pattern | Detail UI | Notes |
|--------|---------------------|-----------|-------|
| Projects | `/projects/[id]`, `/projects/[id]/edit` | Full page | **Done** — path-based |
| Workflows | `/workflows/[id]` | Full page (canvas + drawer) | **Done** — path-based |
| Tasks | `?taskId=` | Drawer | Deep-linked from other plugins |
| Schedule | `?jobId=`, `?mode=` | Drawer | Dual-param race risk |
| Calendar | `?itemId=`, `?mode=` | Drawer | Dual-param race risk |
| Assets | `?asset=` | Modal | Asset path as param |

Filter/search params (`?status=`, `?q=`, `?view=`, `?agent=`) should **stay as query params** — those are the correct pattern for ephemeral list state.

## Two Tracks

### Track A: Migrate Existing Plugins to Path Routes

For each plugin with addressable resources:

- **Tasks:** `/tasks/[id]` — opens task drawer (or full page detail)
- **Schedule:** `/schedule/[id]`, `/schedule/[id]/edit`, `/schedule/new` — replaces `?jobId=`/`?mode=`
- **Calendar:** `/calendar/[id]`, `/calendar/[id]/edit`, `/calendar/new` — replaces `?itemId=`/`?mode=`
- **Assets:** `/assets/[...path]` — replaces `?asset=` (asset paths contain slashes)

Each migration:
1. Add `src/app/{plugin}/[id]/page.tsx` (and `/edit/page.tsx`, `/new/page.tsx` as needed)
2. Update the list component to use `router.push(`/{plugin}/${id}`)` instead of query params
3. Update cross-plugin deep links (e.g., asset detail → task link)
4. Remove query-param-based selection state

### Track B: Dynamic Plugin Page Registration

Enable custom/addon plugins to register their own page routes without modifying `src/app/`.

**Option 1: Catch-all page route**
- Add `src/app/[pluginId]/[...path]/page.tsx` as a dynamic catch-all
- Plugins register page components via `ctx.registerPage(pattern, Component)`
- Catch-all resolves `pluginId` + `path` → registered component
- Mirrors the existing API route catch-all pattern

**Option 2: Plugin pages map in client.tsx**
- Each plugin exports a `pages` map from `client.tsx`:
  ```typescript
  export const pages = {
    '/': { component: ProjectGrid },
    '/[id]': { component: ProjectDetail },
    '/[id]/edit': { component: ProjectDetail, props: { initialEdit: true } },
  }
  ```
- Catch-all page route imports the map and renders the matched component
- Core plugins still get explicit `src/app/` routes for build-time optimization

**Considerations:**
- Next.js file-system routing conflicts: `src/app/projects/page.tsx` would conflict with `src/app/[pluginId]/page.tsx` — may need to move core plugins to the catch-all too, or use route groups
- Static vs dynamic: core plugins benefit from static routes (build optimization, code splitting)
- Addon plugins live in `~/.bakin/plugins/` — need a way to import their client components at runtime

## Cross-Plugin Deep Links

Several plugins link to resources in other plugins:
- Asset detail → "View task" button uses `?taskId=` on `/tasks`
- Task detail → linked assets
- Project checklist → linked board tasks

All cross-plugin resource links need to be updated when the target plugin migrates to path routes. Consider a `pluginLink(pluginId, resourceId)` utility that resolves the correct URL pattern.

## Migration Order

1. **Schedule** — simplest, isolated drawer, `?mode=` dual-param pain is highest
2. **Calendar** — same pattern as schedule
3. **Tasks** — most cross-plugin dependencies (assets, projects link to tasks)
4. **Assets** — path-in-path complexity (`?asset=images/foo/bar.jpg`)
5. **Track B** — dynamic registration architecture (separate spec)
