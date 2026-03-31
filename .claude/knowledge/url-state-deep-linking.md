# URL State & Deep Linking

## Rule

All interactive UI state that a user would want to bookmark, share, or navigate back to **must** be reflected in URL query parameters. This includes:

- **View modes** (kanban/table, grid/list)
- **Filters** (agent, status, type, etc.)
- **Search queries**
- **Selected tabs** or active panels

State that is transient and not meaningful to bookmark (e.g., open modals, drag state, hover) stays in `useState`.

## Hook: `useQueryState` / `useQueryArrayState`

Located at `src/hooks/use-query-state.ts`. Two hooks:

```tsx
// Single string value ↔ query param
const [view, setView] = useQueryState('view', 'kanban')
// /tasks?view=table

// Array of strings ↔ comma-separated query param
const [status, setStatus] = useQueryArrayState('status')
// /tasks?status=todo,blocked
```

- When value equals the default, the param is **removed** from the URL (clean URLs by default)
- Uses `router.replace()` with `scroll: false` — no history spam, no scroll jump
- Array values are comma-separated: `?status=todo,blocked,review`

## Suspense Requirement

Any page component that uses `useSearchParams` (directly or via `useQueryState`) must be wrapped in `<Suspense>` in the page route file. Next.js App Router requires this for client-side search params access.

```tsx
// src/app/tasks/page.tsx
import { Suspense } from 'react'
import { KanbanBoard } from '@bakin/tasks/components/kanban-board'

export default function TasksPage() {
  return (
    <Suspense>
      <KanbanBoard />
    </Suspense>
  )
}
```

## Query Param Conventions

| Param | Type | Example | Use |
|-------|------|---------|-----|
| `view` | string | `kanban`, `table`, `grid`, `list` | View mode toggle |
| `q` | string | any text | Search query |
| `agent` | string | `main-operator`, `all` | Agent filter (single-select) |
| `status` | string[] | `todo,blocked` | Status filter (multi-select via FacetFilter) |
| `type` | string[] | `images,video` | Type filter (multi-select via FacetFilter) |
| `highlight` | string | asset path | Deep-link to specific item |

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
/>
```

- Replaces long tab bars for 4+ options
- Shows count badge on trigger when filters active
- Removable chips for each active selection
- "Clear filters" action inside popover
- Options support icons (avatars, dots, file type icons)

## Implementation Status

| Plugin | URL State | Notes |
|--------|-----------|-------|
| Tasks | ✅ Done | `view`, `q`, `agent`, `status` |
| Assets | ❌ Pending | Has FacetFilter but state not URL-backed yet |
| Calendar | ❌ Pending | |
| Workflows | ❌ Pending | |
| Schedule | ❌ Pending | |
| Health | ❌ Pending | |
| Memory | ❌ Pending | |
| Projects | ❌ Pending | |
| Models | ❌ Pending | |
