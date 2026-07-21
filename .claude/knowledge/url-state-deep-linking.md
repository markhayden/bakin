# URL State & Deep Linking

## Navigation Rule — never a full reload (routing overhaul PR1)

Internal navigation ALWAYS goes through the SPA router; a hard navigation re-boots the whole shell (manifest fetch, plugin loads, SSE reconnect):

- **Links:** `PluginLink` from `@makinbakin/sdk/components` (plugins + shared `src/components`) or TanStack `Link` (host internals). Both keep real-anchor semantics (copy, cmd/middle-click) while routing primary clicks client-side. Raw internal `<a href="/…">` is banned; `<a href="/api/…">` (real server resources: downloads, exports) is exempt.
- **Programmatic:** `useRouter().push/replace` from `@makinbakin/sdk/hooks` — never `window.location.assign/replace/href`.
- **Outside React (OS notification clicks):** `navigateToUrl()` in `src/lib/browser-notify.ts` routes through the `globalThis.__bakinNavigate` bridge the host registers at boot (`packages/host/src/main.tsx`); falls back to a hard load only when the shell isn't booted. globalThis because plugin bundles inline their own copy of that module.
- **Toast click-throughs** navigate via `useRouter().push` and dismiss themselves with the id `toast()` returns (see chat's `ReplyToast` / workflows' `GateToast`).

`PluginLink` is the one unresolved prerelease UI API gap: the routing behavior
is authoritative, but the component is still available only through the frozen
migration barrel. Do not copy it, replace it with a raw anchor, or add another
router abstraction. Resolve its focused public location at the component/API
checkpoint before external plugin migration.

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

### Path segments — for page identity
Which page you are on: lists, full-page details, creation surfaces. TanStack Router code-based routes under `packages/host/src/routes/` — each route renders `<Slot name="page:/route" />` so the owning plugin registers the page component via `registerPlugin({ slots: { ... } })`.

**The taxonomy (routing overhaul, spec `.claude/specs/routing-overhaul.md` D1 — presentation-based):**

| Shape | Rule | Examples |
|---|---|---|
| Path | Page identity: lists, full-page details, creation surfaces | `/chat/$chatId`, `/team/$id`, `/assets/$assetId`, `/brands/$brandId`, `/workflows/$id`, `/chat/new?agent=`, `/workflows/new` |
| Query | Overlay identity (drawers) + tabs + view state — anything that composes with the page's other state | `?taskId=` `?jobId=` `?recordId=` (drawers, BY DESIGN), `?tab=`, `?view=` `?q=` `?agent=` `?status=` `?sort=` |

Drawers deliberately stay query params: they're overlays over a list that must compose with filters (`/tasks?status=todo&taskId=x`), and closing one is just dropping a param. Chat is fully path-based (`/chat`, `/chat/$chatId`, `/chat/new?agent=<draft agent>` — see `.claude/knowledge/chat-plugin.md`); the retired `?chat=`/`?draft=` shapes are dead, no redirects by decision.

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
- `setValue` uses `router.replace()` — no history spam; replace never resets scroll
- `pushValue` (third return) uses `router.push()` — creates a browser history entry for back-button navigation
- Array values are comma-separated: `?status=todo,blocked,review`
- **Setters batch per tick** (PR3): any number of setter calls in one handler compose into ONE navigation (push wins over replace). Calling two setters together is safe.
- **Query values are plain strings** (PR3): the router never JSON-coerces — `?id=123` stays the string `'123'` on read, and values are never JSON-quoted in the URL (`packages/host/src/lib/search-params.ts`).
- **Scroll** (PR3): `scrollRestoration` is on (element-level — the shell scrolls an inner div marked `data-scroll-restoration-id`); back/forward restores position. `push` scrolls to top unless `{ scroll: false }`; `replace` always keeps position.

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
| Chat | ✅ Done | Path-based: `/chat/$chatId`, `/chat/new?agent=`; list filter `agent` |
| Tasks | ✅ Done | `view`, `q`, `agent`, `status`, `taskId` (deep link). Edit/create state is component-level (`editing` useState), not URL-driven. |
| Assets | ✅ Done | `view`, `q`, `type`, `asset`, `page`, `sort`, `dir` |
| Messaging (Calendar) | ✅ Done | `view`, `q`, `agent`, `status`, `type`, `itemId` (deep link), `mode` (edit) |
| Messaging (Brainstorm) | ✅ Done | `session` (deep link to planning session), search via parent PluginHeader |
| Workflows | ✅ Done | `q` on list; path-based `/workflows/[id]` for canvas detail, step drawer via node click |
| Schedule | ✅ Done | `view`, `q`, `agent`, `jobId` (deep link), `mode` (create/edit/duplicate) |
| Health | ✅ Done | `tab` (overview/activity/agents/system) |
| Memory | ✅ Done | `q` (search query), `tier` (multi-select), `agent` (single-select — shared avatar-strip `AgentFilter`), `kind` (multi-select, durable-only), `recordId` (deep link — detail drawer, ⌘K target). Landing page is the search surface — no sub-routes. |
| Projects | ✅ Done | `status`, `q` on list; path-based `/projects/[id]` and `/projects/[id]/edit` for detail |
| Models | ✅ Done | `tab` (agents/available/aliases/routing/spend) |
