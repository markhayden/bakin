# Shared UI Patterns

## BakinDrawer

`src/components/bakin-drawer.tsx` — Resizable right-side drawer used by all detail views.

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

## Key Files

```
src/components/bakin-drawer.tsx      — Resizable drawer shell
src/components/agent-select.tsx      — Agent picker with avatars
src/components/plugin-header.tsx     — Page header with search + actions
src/components/ui/dropdown-menu.tsx  — Base dropdown (focus: bg-secondary)
src/components/ui/sheet.tsx          — Sheet primitive (used by BakinDrawer)
```
