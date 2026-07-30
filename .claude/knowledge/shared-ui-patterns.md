# Shared UI Patterns (legacy migration reference)

> New browser UI must use public Storybook and the focused SDK entrypoints.
> This document explains existing compatibility adapters and historical
> product behavior; it is not an authoring API. Follow
> `.claude/skills/bakin-ui-conformance/SKILL.md` before using any example here.

> **Visual-authoring status (2026-07-18):** Product Character is the approved
> default. The token, typography, spacing, surface, and state guidance in
> `design-system.md` and `style-guide.md` supersede the hard-coded visual class
> examples below. Keep using this document for component behavior, ownership,
> and migration inventory; do not treat its legacy utility strings as a new
> styling API.

Promoted patterns in this document now resolve from focused
`@makinbakin/sdk/*` entrypoints. `PluginHeader` remains a migration-only
compatibility adapter; use `PageHeader` for new work. Plugins never import
directly from `packages/host/src/components/*`, `packages/ui/*`, or the legacy
`src/components/*` shims:

```tsx
import { AgentAvatar, FacetFilter } from '@makinbakin/sdk/patterns'
import { Drawer } from '@makinbakin/sdk/ui'
import { useSearch, useRuntimeStatus } from '@makinbakin/sdk/hooks'

// Existing consumers only; frozen migration barrel.
import { PluginHeader } from '@makinbakin/sdk/components'
```

Core plugins use the same public imports. Path-style `src/components/*.tsx`
entries in the historical tables below describe compatibility implementations,
not an authoring contract; verify every current owner in public Storybook and
`design-system/public-api.json`.

## Drawer

`src/components/drawer.tsx` — Historical compatibility implementation of
the resizable right-side detail drawer. The supported public contract is
`Drawer` from `@makinbakin/sdk/ui`.

### Props

| Prop | Type | Notes |
|------|------|-------|
| `open` | `boolean` | Controls visibility |
| `onOpenChange` | `(open: boolean) => void` | Called on close |
| `title` | `React.ReactNode` | Drawer title in header |
| `description` | `React.ReactNode` | Subtitle below title |
| `actions` | `React.ReactNode` | Rendered inline next to title and close button |
| `children` | `React.ReactNode` | Drawer body content |
| `defaultWidth` | `number` | Initial width (default 810, min 320, max 960) |
| `onBack` | `() => void` | When provided, shows a back arrow left of title (for edit→detail navigation) |
| `dirty` | `boolean` | When true, closing shows an "unsaved changes" confirmation dialog (default false) |

### Header Layout

The header renders as a single row: `[Title] ... [actions] [X close]`

- The built-in SheetContent close button is suppressed (`showCloseButton={false}`)
- A custom `SheetClose` is rendered inline with the actions
- Actions and close button are grouped with `flex items-center gap-1`

### Usage with Action Menu

```tsx
<Drawer
  open={isOpen}
  onOpenChange={(open) => { if (!open) onClose() }}
  title="Task Details"
  actions={
    <DropdownMenu>
      <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onClick={handleDuplicate}>
          <Copy className="size-3.5 mr-2" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDelete} className="text-red-400 focus:text-red-400">
          <Trash2 className="size-3.5 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  }
>
```

## DropdownMenu Action Pattern

Standard pattern for `...` overflow menus on cards, rows, and drawers.

### Trigger Styling

- **On cards (overlay):** `p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-zinc-400 hover:text-zinc-200 transition-colors`
- **On rows (inline):** `p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100`
- **In drawers (header):** `p-1.5 rounded-md hover:bg-accent transition-colors`

### Content

Always use `min-w-36` on `DropdownMenuContent` to prevent narrow popups from small triggers.

### Item Styling

- Normal items: default styles (no extra classes)
- Destructive items: `className="text-red-400 focus:text-red-400"` (not `variant="destructive"`)
- Focus uses `bg-secondary` (matches Select component), not `bg-accent`

### Where Used

| Plugin | Component | Actions |
|--------|-----------|---------|
| Tasks | task-detail-dialog (drawer) | Duplicate, Delete |
| Assets | asset-card (grid card) | Delete |
| Assets | assets-list (table row) | Delete |
| Schedule | job-row (table row) | Edit, Delete, Run Now |
| Schedule | job-drawer (drawer) | Duplicate, Delete |
| Calendar | item-detail-drawer (drawer) | Edit, Delete |

### Drawer Content Sections

All drawers follow the same section patterns inside `Drawer`:

- **Hero card** (first element): `flex items-center gap-4 rounded-lg p-4 border border-border bg-surface` — AgentAvatar left, info right
- **Metadata grid**: `grid grid-cols-2 gap-3` with `rounded-lg bg-surface p-3 space-y-1` cards. Label: `text-[11px] text-muted-foreground uppercase tracking-wider` with optional icon.
- **Section labels**: `text-[11px] text-muted-foreground uppercase tracking-wider mb-2`
- **Left-bordered content blocks**: `text-sm text-foreground/90 rounded-lg p-4 border-l-2 bg-surface whitespace-pre-wrap` — use agent/step-type accent color on border
- **Alert/rejection boxes**: `bg-red-500/10 border border-red-500/20 rounded-lg p-3`
- **Spacing**: `space-y-6` between major sections, `Separator` between groups
- **Quick actions**: `flex flex-wrap items-center gap-2` with `Button variant="outline" size="sm"`

### Where Drawer Is Used

| Plugin | Component | Detail |
|--------|-----------|--------|
| Tasks | task-detail-dialog | View/edit with hero, gate approval, notes |
| Calendar | item-detail-drawer | View/edit with hero, metadata grid, draft content |
| Schedule | job-drawer | View-only with hero, metadata grid, run history |
| Workflows | step-detail-drawer | View-only, per-step-type sections (agent/gate/output/parallel/workflow) |
| Team | agent-drawer | View-only with agent profile |

## AgentSelect

`src/components/agent-select.tsx` — Shared agent selection dropdown with avatar in both trigger and dropdown items.

### Props

| Prop | Type | Notes |
|------|------|-------|
| `value` | `string` | Selected agent ID |
| `onValueChange` | `(value: string) => void` | Called when selection changes |
| `allowNone` | `boolean` | Show "None" option (default false) |
| `noneLabel` | `string` | Label for none option (default "None") |
| `placeholder` | `string` | Trigger placeholder text |
| `agentIds` | `string[]` | Restrict to specific agents (default: all) |
| `className` | `string` | Extra classes on trigger |

### Where Used

| Plugin | Component | Use |
|--------|-----------|-----|
| Tasks | task-detail-dialog | Assignee picker |
| Schedule | job-form | Agent + Owner pickers |
| Calendar | item-detail-drawer | Agent picker |

## View/Edit Split Pattern

All detail drawers (Tasks, Calendar, Schedule) follow a two-mode pattern: **detail view** (read-only) and **edit form**.

### State Machine

Parent component manages `editing: boolean`. The drawer component receives:

```tsx
open: boolean          // drawer visible
editing: boolean       // true = form, false = detail
onEdit: () => void     // detail → edit
onCancelEdit: () => void  // edit → detail (back arrow)
onClose: () => void    // close drawer entirely
```

Create mode is derived: `isCreate = editing && !existingItem`

### Detail View

- **Hero card**: `bg-surface border-border rounded-lg p-4` with agent avatar, name, status dot + label
- **Quick actions**: Edit button, gate approval buttons
- **Metadata**: workflow progress, description (rendered via MarkdownContent with agent-colored left border)
- **Actions dropdown**: Edit, Duplicate, Delete

### Edit Form

- Drawer with `onBack={isCreate ? undefined : onCancelEdit}` and `dirty={dirty}`
- Form fields with `bg-surface` inputs
- Save/Cancel buttons

### Hero Card Pattern

```tsx
<div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
  <AgentAvatar agentId={agentId} size="lg" />
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium">{agentName}</div>
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${statusDotColor}`} />
      {statusLabel}
    </span>
  </div>
</div>
```

### Where Implemented

| Plugin | Component | URL-driven edit? |
|--------|-----------|-----------------|
| Tasks | task-detail-dialog | No (component state) |
| Calendar | item-detail-drawer | Yes (`mode` param) |
| Schedule | job-drawer + schedule-page | Yes (`mode` param) |
| Workflows | step-detail-drawer | N/A (view-only, no edit mode) |

## TaskAssets

`src/components/assets/task-assets.tsx` — Displays linked assets for a task with optional add button.

| Prop | Type | Notes |
|------|------|-------|
| `taskId` | `string` | Task to show assets for |
| `readOnly` | `boolean` | Hides "Add" button when true (use in detail view) |

## PluginHeader Actions (legacy consumers)

`PluginHeader` has an `actions` slot for controls that sit to the right of the search bar.

### What Goes in Actions

- View toggles (Board/Log, Grid/List/Trash)
- Primary action buttons (New Task, etc.)

### View Toggle Pattern

```tsx
<div className="flex items-center bg-muted/50 rounded-lg p-0.5">
  <button
    onClick={() => setView('kanban')}
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
      view === 'kanban'
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    <Kanban className="size-3.5" />
    Board
  </button>
</div>
```

## ModelSelect

`src/components/model-select.tsx` — Shared model selection dropdown fed by the models plugin API and grouped by provider.

### Props

| Prop | Type | Notes |
|------|------|-------|
| `value` | `string` | Selected full model ID (e.g. `anthropic/claude-opus-4-6`) |
| `onChange` | `(v: string) => void` | Called when selection changes |
| `models` | `AvailableModel[]` | Available models (from `GET /api/plugins/models/available`) |
| `defaultLabel` | `string` | Optional "use default" option label — uses value `__default__` |
| `className` | `string` | Extra classes on trigger |

### Option Groups

Options are grouped by provider (`anthropic`, `openai-codex`, `google`, etc.), not by Claude-era tiers. `AvailableModel` now includes provider metadata plus flags such as `configured`, `isDefault`, and `fallbackIndex`.

### Where Used

| Plugin | Component | Use |
|--------|-----------|-----|
| Team | agent-detail | Change agent's active model (saves via `POST /api/plugins/models/config`) |
| Team | agent-form | Select model during agent creation |
| Models | models-page | Agent config table, alias target, task profile model |

## useRuntimeStatus

`src/hooks/use-runtime-status.ts` — Checks if the active runtime needs a restart after config changes.

### Return Value

| Field | Type | Notes |
|-------|------|-------|
| `restartNeeded` | `boolean` | True if config changed since last runtime restart |
| `restarting` | `boolean` | True while restart POST is in flight |
| `restart` | `() => Promise<void>` | Calls `POST /api/plugins/models/runtime/restart` |
| `markDirty` | `() => void` | Optimistically set `restartNeeded` without waiting for server |

### How It Works

Server tracks `lastConfigChangeAt` and `lastRestartAt` timestamps via `globalThis.__bakinRuntimeSync` (survives Bun HMR and module re-evaluation). The hook fetches `GET /api/plugins/models/runtime/status` on mount and shows the amber restart banner if out of sync.

### Where Used

| Plugin | Component | Trigger |
|--------|-----------|---------|
| Team | agent-detail | Model change via dropdown |
| Team | team-grid | "Save Without Restart" on agent creation |
| Models | models-page | Any config/defaults change |

## useSearch

Located at `src/hooks/use-search.ts`. Provides Antfly-powered semantic search alongside client-side filtering in all plugin UIs. Takes a `plugin: <pluginId>` option that targets the plugin's auto-registered `/api/plugins/{plugin}/search` route — omit `plugin` to fall back to the cross-plugin `/api/search` endpoint.

**Usage:** Every plugin with a search bar fires `useSearch` when the user types. Results are used to reorder client-side filtered lists by relevance scores. Aggregation counts from `search.aggregations` feed into FacetFilter's `counts` prop.

**Integration pattern:**
1. Call `search.search(q)` when search text changes
2. Merge `search.results` into client-side filter via `reorderBySearchResults()`
3. Pass `search.aggregations.{facet}` as `counts` to FacetFilter

**Currently wired in:** Tasks, Assets, Projects, Workflows, Schedule, Memory (audit timeline), Messaging (brainstorm).

## AgentFilter

`src/components/agent-filter.tsx` — Single-select agent pill strip with an "All" button. Used on every plugin page that has a per-agent filter (tasks, schedule, messaging calendar, brainstorm).

```tsx
<AgentFilter
  agentIds={agentIds}           // any string[] — useAgentIds() for runtime agents, CONTENT_AGENTS for messaging
  value={agentFilter}            // current selection ('all' or an id)
  onChange={setAgentFilter}      // typically wired to useQueryState('agent', 'all')
/>
```

Always back the `value` with `useQueryState('agent', 'all')` so the selection is bookmarkable and survives back/forward navigation. The component is purely presentational — it does not know about `useAgentIds` or `CONTENT_AGENTS`, so the caller picks the source.

## SortableHead

`src/components/sortable-head.tsx` — Generic sortable `<TableHead>` cell for list tables. Click toggles ascending/descending; clicking a different field switches to that field and resets to descending. Generic over the field union so each table stays type-safe.

```tsx
type SortField = 'title' | 'agent' | 'updated'
const [field, setField] = useState<SortField>('updated')
const [dir, setDir] = useState<SortDir>('desc')

<SortableHead field="title" current={field} dir={dir} onSort={toggleSort}>Title</SortableHead>
<SortableHead field="agent" current={field} dir={dir} onSort={toggleSort}>Agent</SortableHead>
<SortableHead field="updated" current={field} dir={dir} onSort={toggleSort} disabled={isSearching}>Updated</SortableHead>
```

Set `disabled` while a search is active so the upstream relevance order (e.g. Antfly RRF) wins — the cell still renders but clicks are ignored and the arrow indicator hides. Used by tasks' task-log-table and messaging's session-list.

## Conversation surfaces

`IntegratedBrainstorm` was DELETED (2026-07). Every conversational surface — chat plugin, embedded brainstorm/plan panels, single-turn output embeds — composes the **conversation kit** (`src/components/conversation/`). Full reference: `.claude/knowledge/conversation-kit.md`. Short version: `ConversationPanel` + `useConversationStream` for embedded single-session surfaces (fitParent/showHeader/readOnly/transformText/onCustom cover the old brainstorm call-site shapes), `Conversation`/`AgentTurn`/`ActivityGroup`/`Composer` primitives for custom layouts, `foldConversation` as THE chunk-folding engine, and `conversationThreadId`/`createTurnRecorder` server-side. Routes stream `event: chunk` frames (raw runtime chunk JSON) instead of the old token/activity taxonomy.

## Key Files

```
src/components/drawer.tsx          — Resizable drawer shell
src/components/agent-filter.tsx          — Single-select agent pill strip
src/components/agent-select.tsx          — Agent picker with avatars
src/components/model-select.tsx          — Model picker grouped by tier
src/components/plugin-header.tsx         — Page header with search + actions
src/components/facet-filter.tsx          — Multi-select filter with optional Antfly counts
src/components/sortable-head.tsx         — Generic sortable table header cell
src/components/integrated-brainstorm/    — Unified streaming agent-chat surface
src/hooks/use-search.ts                  — Search hook (Antfly-backed) with debounce + fallback
src/hooks/use-runtime-status.ts          — Runtime restart sync checker
src/hooks/use-vertical-resize.ts         — Drag-to-resize hook (messaging panels + brainstorm)
src/components/ui/dropdown-menu.tsx      — Base dropdown (focus: bg-secondary)
src/components/ui/sheet.tsx              — Sheet primitive (used by Drawer)
src/core/app-services.ts                 — boot-created runtime/search/task services
```
