# Shared UI Patterns

All shared UI primitives in this doc are re-exported from `@bakin/sdk/components` (plus `@bakin/sdk/ui` for shadcn primitives and `@bakin/sdk/hooks` for React hooks). Plugin authors should always import via the SDK, never directly from `packages/host/src/components/*` or the legacy `src/components/*` shims:

```tsx
import { BakinDrawer, PluginHeader, FacetFilter, AgentAvatar } from '@bakin/sdk/components'
import { useSearch, useGatewayStatus } from '@bakin/sdk/hooks'
```

Core plugins use the same imports. The path-style `src/components/*.tsx` entries in the tables below are the source-of-truth locations inside the repo — plugins never reach them directly.

## BakinDrawer

`src/components/bakin-drawer.tsx` — Resizable right-side drawer used by all detail views. Exposed to plugins as `BakinDrawer` from `@bakin/sdk/components`.

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
<BakinDrawer
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

All drawers follow the same section patterns inside `BakinDrawer`:

- **Hero card** (first element): `flex items-center gap-4 rounded-lg p-4 border border-border bg-surface` — AgentAvatar left, info right
- **Metadata grid**: `grid grid-cols-2 gap-3` with `rounded-lg bg-surface p-3 space-y-1` cards. Label: `text-[11px] text-muted-foreground uppercase tracking-wider` with optional icon.
- **Section labels**: `text-[11px] text-muted-foreground uppercase tracking-wider mb-2`
- **Left-bordered content blocks**: `text-sm text-foreground/90 rounded-lg p-4 border-l-2 bg-surface whitespace-pre-wrap` — use agent/step-type accent color on border
- **Alert/rejection boxes**: `bg-red-500/10 border border-red-500/20 rounded-lg p-3`
- **Spacing**: `space-y-6` between major sections, `Separator` between groups
- **Quick actions**: `flex flex-wrap items-center gap-2` with `Button variant="outline" size="sm"`

### Where BakinDrawer Is Used

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

- BakinDrawer with `onBack={isCreate ? undefined : onCancelEdit}` and `dirty={dirty}`
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

## PluginHeader Actions

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

## useGatewayStatus

`src/hooks/use-gateway-status.ts` — Checks if the OpenClaw gateway needs a restart after config changes.

### Return Value

| Field | Type | Notes |
|-------|------|-------|
| `restartNeeded` | `boolean` | True if config changed since last gateway restart |
| `restarting` | `boolean` | True while restart POST is in flight |
| `restart` | `() => Promise<void>` | Calls `POST /api/plugins/models/gateway/restart` |
| `markDirty` | `() => void` | Optimistically set `restartNeeded` without waiting for server |

### How It Works

Server tracks `lastConfigChangeAt` and `lastRestartAt` timestamps via `globalThis.__bakinGatewaySync` (survives Bun HMR and module re-evaluation). The hook fetches `GET /api/plugins/models/gateway/status` on mount and shows the amber restart banner if out of sync.

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
  agentIds={agentIds}           // any string[] — useAgentIds() for OpenClaw agents, CONTENT_AGENTS for messaging
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

## IntegratedBrainstorm

`src/components/integrated-brainstorm/` — Unified streaming agent-chat surface. One component drives both the projects "bottom sheet" chat (below a content editor) and the messaging full-pane planning session chat. Used as `IntegratedBrainstorm` from `@bakin/sdk/components`; types exported alongside.

### When to reach for it

- You need a chat with a single agent.
- Responses stream from an SSE-shaped backend (OpenAI-style `choices[].delta.content` chunks work, as does any transport you wrap yourself).
- You want consistent chrome: avatar-tinted assistant bubbles, markdown rendering, `json`-block transform hook, thinking indicator, Esc-to-abort, culinary-verb personality, collapse chrome, empty state.

Not for: one-shot prompts without history (use `sendMessage` + a button), multi-agent threads, or anything that needs a chat list / session list above it — render those separately in the page, not in this component.

### Props summary

| Prop | Required | Notes |
|------|----------|-------|
| `messages` / `onMessagesChange` | yes | Controlled message list. Caller owns the array; component mutates via the callback. |
| `onSend` | yes | `(prompt, history, { signal, onToken, onCustom }) => Promise<{ content }>`. Caller opens the SSE stream, forwards text via `onToken`, forwards domain events (proposals, etc.) via `onCustom`, resolves on `done`, rejects on error. Must honor `signal` for Esc-to-abort. `history` is the conversation PRIOR to this turn — the new user turn is `prompt`, not yet in `history`. |
| `agentId` | yes | Drives avatar, name, border color on assistant bubbles. |
| `onAgentChange` | no | When provided, `<AgentSelect>` renders in the input row. |
| `label` / `icon` | no | Collapse header label + lucide icon. Defaults: `"Brainstorm"` + `Sparkles`. |
| `placeholder` | no | Textarea placeholder. Defaults to `Ask ${agentName}…`. |
| `emptyState` | no | Replace default "Brainstorm with {agent}" welcome. |
| `collapsible` | no | Default `true`. `false` shows a static header. |
| `defaultOpen` | no | Default `true`. |
| `fitParent` | no | `true` → panel fills parent height (no inline `height`, no top border, no drag handle, no auto-expand). Use for full-pane surfaces (messaging session chat). Default `false` (bottom-sheet mode). |
| `showHeader` | no | Default `true`. Set `false` when the parent page already has its own title chrome. |
| `readOnly` | no | Swaps the input row for `readOnlyNotice` (defaults to "Chat is read-only."). History stays scrollable. Used by messaging for completed sessions. |
| `transformAssistantMessage` | no | `(raw) => { text, extras? }`. Strip inline `json` blocks before rendering; surface the extracted count as a badge. Applied to streaming AND finalized content. |
| `conversationStartHeight` / `minHeight` / `maxHeight` | no | Outer panel sizing. Default 400 / 100 / 720 (bottom-sheet mode only). |
| `maxInputHeight` | no | Textarea auto-grow cap. Default 200px. Textarea has no drag grip — content-driven height only. |
| `storageKey` | no | When set, outer-panel drag height persists in `localStorage['bakin-vresize:{key}']`. Ignored when `fitParent` is on. |

### Two call-site shapes

1. **Bottom sheet** (projects) — panel is pinned below other content, auto-expands to 400px on first send, drag handle to resize.
   ```tsx
   <IntegratedBrainstorm
     messages={m} onMessagesChange={setM}
     onSend={projectAskOnSend}
     agentId={agent} onAgentChange={setAgent}
     placeholder="Ask about this project..."
   />
   ```

2. **Full pane** (messaging session chat) — panel IS the whole pane, no collapse, no drag.
   ```tsx
   <IntegratedBrainstorm
     messages={m} onMessagesChange={setM}
     onSend={sessionOnSend}
     agentId={agent}
     fitParent
     showHeader={false}
     placeholder={`Ask ${name} for content ideas…`}
     transformAssistantMessage={stripJsonProposals}
     readOnly={isCompleted}
     readOnlyNotice={<Badge variant="outline">Session completed — read-only</Badge>}
   />
   ```

### Keyboard

- **Enter** → send
- **Shift+Enter** → newline
- **Cmd/Ctrl+Enter** → send (muscle-memory alias)
- **Esc** → abort an in-flight request via `AbortController.abort()`. Partial tokens, if any, are preserved as the final assistant message. A "Stopped — send a new message to continue" notice renders until the next send.
- IME composition suppresses Enter-send between `compositionstart` and `compositionend`.

### Transport layer

`IntegratedBrainstorm` doesn't own the transport — the plugin writes a small `onSend` adapter around its backend. For OpenAI-shaped SSE, the pattern is identical to what's in `plugins/projects/components/project-detail.tsx` and `plugins/messaging/components/session-chat.tsx`:

```ts
const onSend: BrainstormOnSend = async (prompt, history, { signal, onToken, onCustom }) => {
  const res = await fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, history }) })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = '', currentEvent = '', accumulated = '', finalContent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event: ')) currentEvent = line.slice(7).trim()
      else if (line.startsWith('data: ') && currentEvent) {
        const data = JSON.parse(line.slice(6))
        if (currentEvent === 'token') { accumulated += data.text; onToken(data.text) }
        else if (currentEvent === 'done') finalContent = data.content ?? accumulated
        else if (currentEvent === 'proposal') onCustom?.('proposal', data.proposal)
        currentEvent = ''
      }
    }
  }
  return { content: finalContent || accumulated }
}
```

The server-side helpers live in `src/core/openclaw-client.ts`: `streamMessage()` returns a raw `Response` with an SSE body; `chatCompletion()` is the non-streaming fallback used by both messaging and projects when the gateway returns non-streaming.

### Architecture notes

- State lives in `use-brainstorm-state.ts` — a small `idle → sending → streaming → idle` machine. Optimistic user-message append, concurrent-send guard via ref (not state), culinary thinking verb stable per request, error-bubble rendering.
- Auto-growing textarea uses `use-auto-grow.ts` — `scrollHeight` measurement on every input change, capped at `maxInputHeight`, overflow-y auto past the cap. No native `resize-y` grip (removed — it conflicted with the outer panel drag).
- Outer panel drag handle is wired via `useVerticalResize` from `@bakin/sdk/hooks` — same hook as messaging input panel and the prior brainstorm. Auto-expand to `conversationStartHeight` is one-shot on first send; subsequent height is user-owned (drag) and optionally persisted via `storageKey`.
- Send button is embedded inside the textarea's bottom-right (claude.ai pattern) — hidden when input is empty, visible with spinner during send, disabled when not ready.

### Test coverage

`tests/components/integrated-brainstorm/` — ~95 unit cases across 10 files: collapse, empty state, message rendering, send state machine, streaming, keyboard + IME + abort, textarea auto-grow, outer panel resize, read-only, transform, onCustom pass-through, focus, scroll, agent picker, accessibility, edge cases, fit-parent, aborted-notice. Plugin-level integration at `tests/plugins/projects/routes.test.ts` (SSE `/ask` route) and `tests/plugins/messaging/session-chat-proposals.test.tsx` (proposal forwarding end-to-end).

## Key Files

```
src/components/bakin-drawer.tsx          — Resizable drawer shell
src/components/agent-filter.tsx          — Single-select agent pill strip
src/components/agent-select.tsx          — Agent picker with avatars
src/components/model-select.tsx          — Model picker grouped by tier
src/components/plugin-header.tsx         — Page header with search + actions
src/components/facet-filter.tsx          — Multi-select filter with optional Antfly counts
src/components/sortable-head.tsx         — Generic sortable table header cell
src/components/integrated-brainstorm/    — Unified streaming agent-chat surface
src/hooks/use-search.ts                  — Search hook (Antfly-backed) with debounce + fallback
src/hooks/use-gateway-status.ts          — Gateway restart sync checker
src/hooks/use-vertical-resize.ts         — Drag-to-resize hook (messaging panels + brainstorm)
src/components/ui/dropdown-menu.tsx      — Base dropdown (focus: bg-secondary)
src/components/ui/sheet.tsx              — Sheet primitive (used by BakinDrawer)
src/core/openclaw-client.ts              — streamMessage + chatCompletion (SSE & JSON variants)
```
