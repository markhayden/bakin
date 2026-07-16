# URL State & Deep Linking

## Navigation Rule — never a full reload (routing overhaul PR1)

Internal navigation ALWAYS goes through the SPA router; a hard navigation re-boots the whole shell (manifest fetch, plugin loads, SSE reconnect):

- **Links:** `PluginLink` from `@makinbakin/sdk/components` (plugins + shared `src/components`) or TanStack `Link` (host internals). Both keep real-anchor semantics (copy, cmd/middle-click) while routing primary clicks client-side. Raw internal `<a href="/…">` is banned; `<a href="/api/…">` (real server resources: downloads, exports) is exempt.
- **Programmatic:** `useRouter().push/replace` from `@makinbakin/sdk/hooks` — never `window.location.assign/replace/href`.
- **Outside React (OS notification clicks):** `navigateToUrl()` in `src/lib/browser-notify.ts` routes through the `globalThis.__bakinNavigate` bridge the host registers at boot (`packages/host/src/main.tsx`); falls back to a hard load only when the shell isn't booted. globalThis because plugin bundles inline their own copy of that module.
- **Toast click-throughs** navigate via `useRouter().push` and dismiss themselves with the id `toast()` returns (see chat's `ReplyToast` / workflows' `GateToast`).

Enforced twice: `tests/architecture/no-hard-navigation.test.ts` (CI gate — scanner with teeth + path-pinned allowlist with reasons) and mirrored `no-restricted-syntax` rules in `eslint.config.mjs` (editor feedback). Keep the two allowlists in sync. Legitimate full reloads (unsaved-changes guard, `router.refresh()`, dev loop, update recovery, plugin-failure banner, manifest-change reload) are allowlisted there — new entries must be recovery/dev-tooling paths, never user-facing links.

## Rule

All interactive UI state that a user would want to bookmark, share, or navigate back to **must** be reflected in the URL. This includes:

- **View modes** (kanban/table, grid/list)
- **Filters** (agent, status, type, etc.)
- **Search queries**
- **Selected tabs** or active panels

State that is transient and not meaningful to bookmark (e.g., open modals, drag state, hover) stays in `useState`.

## Two URL Patterns

### Query params — for list-level state
Filters, search, view mode, pagination. These are ephemeral and combinable. Use `useQueryState` / `useQueryArrayState`.

### Path segments — for addressable resources
Individual items (`/projects/abc123`) and their modes (`/projects/abc123/edit`, `/projects/new`). These are TanStack Router code-based routes under `packages/host/src/routes/` — each route renders `<Slot name="page:/route" />` so the owning plugin can register the page component via `registerPlugin({ slots: { ... } })`. Path-based routing is the target pattern for all plugins.

**Current state:** Projects and Workflows use path segments. Other plugins still use query params (`?taskId=`, `?jobId=`, etc.).

## Hook: `useQueryState` / `useQueryArrayState`

Located at `src/hooks/use-query-state.ts` (re-exported from `@bakin/sdk/hooks` for plugin authors). The implementation wraps TanStack Router's `useNavigate` + `useSearch` under the hood. Two hooks:

```tsx
// Single string value ↔ query param
const [view, setView] = useQueryState('view', 'kanban')
// /tasks?view=table

// Array of strings ↔ comma-separated query param
const [status, setStatus] = useQueryArrayState('status')
// /tasks?status=todo,blocked
```

- When value equals the default, the param is **removed** from the URL (clean URLs by default)
- `setValue` uses `router.replace()` with `scroll: false` — no history spam, no scroll jump
- `pushValue` (third return) uses `router.push()` — creates a browser history entry for back-button navigation
- Array values are comma-separated: `?status=todo,blocked,review`

## Suspense Requirement

Any page component that reads query params (directly via TanStack Router's `useSearch`, or indirectly through `useQueryState` / `useQueryArrayState`) must be wrapped in `<Suspense>`. This convention predates the Bun migration but still applies — the router may re-render under a Suspense boundary during navigation, and the plugin's slot component needs to handle the loading state cleanly:

```tsx
import { Suspense } from 'react'
import { registerPlugin } from '@bakin/sdk'
import { KanbanBoard } from './components/kanban-board'

function TasksPage() {
  return (
    <Suspense>
      <KanbanBoard />
    </Suspense>
  )
}

registerPlugin({
  id: 'tasks',
  slots: { 'page:/tasks': TasksPage },
})
```

## Query Param Conventions

| Param | Type | Example | Use |
|-------|------|---------|-----|
| `view` | string | `kanban`, `table`, `grid`, `list`, `trash` | View mode toggle |
| `q` | string | any text | Search query |
| `agent` | string | `main`, `all` | Agent filter (single-select) |
| `status` | string[] | `todo,blocked` | Status filter (multi-select via FacetFilter) |
| `type` | string[] | `images,video` | Type filter (multi-select via FacetFilter) |
| `asset` | string | asset path | Deep-link to open asset detail |
| `taskId` | string | task id | Deep-link to open task detail drawer |
| `jobId` | string | job id | Deep-link to open schedule job detail drawer |
| `recordId` | string | memory rowId (`<tier>:<hash>`) | Deep-link to open memory detail drawer (resolved via `GET /record`) |
| `lessonId` | string | lesson id | Highlight + scroll to a lesson on the team Lessons tab (`?tab=lessons`) |
| `mode` | string | `create`, `edit`, `duplicate` | Form mode (schedule plugin) |
| `page` | string | `1`, `2` | Pagination page number |
| `sort` | string | `name`, `size`, `created`, `type` | Sort column (list view) |
| `dir` | string | `asc`, `desc` | Sort direction |

- Use short, lowercase param names
- `all` is the default for single-select filters — omit from URL when active
- Empty array is default for multi-select — omit from URL when empty
- Param names should be consistent across plugins (e.g., `q` for search everywhere, `view` for view mode)

## Multi-param updates: never call two setters in one tick

Each `useQueryState`/`useQueryArrayState` setter snapshots the **pre-update**
search params and calls `router.replace` — two setters in the same handler
clobber each other (the second nav drops the first's param). And `replace`
creates no history entry, so browser back can't undo the navigation.

For any interaction that updates multiple params (e.g. the assets folder
click: `view` + `tags`), build ONE URL and `router.push` it — one atomic
update, one history entry. Pattern (`VersionedAssetGrid.tsx` `pushParams`):

```tsx
const params = new URLSearchParams(searchParams.toString())
// set/delete every param, honoring defaults-omitted
router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
```

Rule of thumb: `replace` for filter tweaks within a view; `push` for
navigation-like transitions the user expects back to undo.

## FacetFilter Component

Located at `src/components/facet-filter.tsx`. Shared multi-select filter component using Popover + Command.

```tsx
<FacetFilter
  label="Status"
  options={[
    { value: 'todo', label: 'Todo', icon: <DotIcon /> },
    { value: 'done', label: 'Done', icon: <DotIcon /> },
  ]}
  selected={statusFilter}       // string[]
  onChange={setStatusFilter}     // (string[]) => void
  counts={aggregations?.status ? Object.fromEntries(...) : undefined}  // from Antfly
/>
```

- Replaces long tab bars for 4+ options
- Shows count badge on trigger when filters active
- Removable chips for each active selection
- "Clear filters" action inside popover
- Options support icons (avatars, dots, file type icons)
- Optional `counts` prop shows Antfly aggregation counts next to each option

## useSearch Hook

Located at `src/hooks/use-search.ts`. Provides Antfly-powered search alongside existing client-side filtering. Pass `plugin: <pluginId>` to hit the plugin's auto-registered `/api/plugins/{plugin}/search` route, or omit `plugin` to fall back to the cross-plugin `/api/search` endpoint.

```tsx
const search = useSearch({ plugin: 'tasks', facets: ['status', 'agent'], debounce: 300 })

useEffect(() => {
  if (q) search.search(q)
  else search.clear()
}, [q])

// Use search.results to reorder client-side filtered list
// Use search.aggregations to populate FacetFilter counts
```

Returns: `{ results, aggregations, loading, error, meta, search, clear }`. Types: `SearchResult`, `SearchResponse`, `UseSearchOptions`, `UseSearchReturn`.

Helper: `reorderBySearchResults(items, searchResults)` — reorders a client-side filtered array using relevance scores.

Pattern: client-side filtering runs immediately (instant feedback), search fires debounced in background and reorders results when available. If Antfly is disabled or errors, client-side filtering is the fallback.

## Implementation Status

| Plugin | URL State | Notes |
|--------|-----------|-------|
| Tasks | ✅ Done | `view`, `q`, `agent`, `status`, `taskId` (deep link). Edit/create state is component-level (`editing` useState), not URL-driven. |
| Assets | ✅ Done | `view`, `q`, `type`, `asset`, `page`, `sort`, `dir` |
| Messaging (Calendar) | ✅ Done | `view`, `q`, `agent`, `status`, `type`, `itemId` (deep link), `mode` (edit) |
| Messaging (Brainstorm) | ✅ Done | `session` (deep link to planning session), search via parent PluginHeader |
| Workflows | ✅ Done | `q` on list; path-based `/workflows/[id]` for canvas detail, step drawer via node click |
| Schedule | ✅ Done | `view`, `q`, `agent`, `jobId` (deep link), `mode` (create/edit/duplicate) |
| Health | ❌ Pending | |
| Memory | ✅ Done | `q` (search query), `tier` (multi-select), `agent` (single-select — shared avatar-strip `AgentFilter`), `kind` (multi-select, durable-only), `recordId` (deep link — detail drawer, ⌘K target). Landing page is the search surface — no sub-routes. |
| Projects | ✅ Done | `status`, `q` on list; path-based `/projects/[id]` and `/projects/[id]/edit` for detail |
| Models | ❌ Pending | |
