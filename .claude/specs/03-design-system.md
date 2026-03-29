# Phase 3: Design System & Components

**Status:** Pending
**Dependencies:** Phase 0 (naming). Can overlap with Phase 2.

## Purpose

Audit and standardize all UI components for consistency across plugins. Establish a design system that every plugin follows — same buttons, inputs, forms, loading states, error handling, and agent representations everywhere.

## Current State

### Component Library
- **15 shadcn/ui v4 components** in `src/components/ui/`: avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, sheet, table, tabs, textarea, tooltip
- Built on `@base-ui/react` (Base UI) primitives via shadcn's `base-nova` style
- CVA (class-variance-authority) for variant management
- `cn()` utility from `src/lib/utils.ts` for class merging
- Tailwind CSS 4 via PostCSS

### Theme
- Dark-mode only
- Background: `#0a0a0a`, Surface: `#141414`/`#1a1a1a`
- Accent: `#5e6ad2` (indigo)
- 50+ CSS custom properties in `src/app/globals.css`
- Radius scale defined via `--radius` variable

### Agent Representation
- Headshots stored as `/public/headshots/{id}.webp`
- Some places use headshot images, others use emoji fallbacks
- No consistent `AgentAvatar` component — each usage is ad-hoc
- Agent colors mapped in `AGENT_AVATAR_COLORS` dict

### Plugin UI Consistency
- Each plugin has its own `components/` directory
- Most follow similar patterns (cards, lists, detail drawers)
- No enforced page layout template
- Form handling varies between plugins (no standard dirty state tracking)

## Deliverables

### 1. Commit to shadcn/ui v4

Stop importing `@base-ui/react` directly. All component primitives come through shadcn-generated files in `src/components/ui/`. If shadcn doesn't have a component we need, we generate one following the same pattern (CVA + cn() + data-slot).

### 2. Fill Component Gaps

Missing components needed across plugins:

| Component | Purpose | Priority |
|-----------|---------|----------|
| `form.tsx` | Form wrapper with dirty state, validation, submit/cancel | High |
| `switch.tsx` | Toggle switch (for plugin settings booleans) | High |
| `checkbox.tsx` | Checkbox (project checklists, multi-select) | High |
| `progress.tsx` | Progress bar (workflow steps, uploads) | Medium |
| `skeleton.tsx` | Loading skeleton placeholders | High |
| `alert.tsx` | Alert/banner messages (errors, warnings, info) | Medium |
| `toast.tsx` | Toast notifications | Medium |
| `popover.tsx` | Popover container (filter dropdowns, color pickers) | Medium |
| `command.tsx` | Command palette (Cmd+K for agent/task/page search) | Low |
| `collapsible.tsx` | Collapsible section (settings groups, accordions) | Low |

### 3. AgentAvatar Component

Replace all ad-hoc agent representations with a single `AgentAvatar` component:

```typescript
interface AgentAvatarProps {
  agentId: string
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  showStatus?: boolean    // show online/working/idle dot
  className?: string
}
```

**Rendering tiers:**
1. **Headshot** (primary): `/headshots/{id}.webp` — optimized thumbnails at 32/64/128/256px
2. **Letter fallback** (secondary): First letter of agent display name, circle with agent's accent color background
3. **Generic** (tertiary): Generic avatar icon — only if agent ID is unknown

**Size map:**
| Size | Pixels | Use case |
|------|--------|----------|
| `xs` | 24px | Inline badges, activity feed |
| `sm` | 32px | Task cards, dropdowns |
| `md` | 48px | List items, agent status |
| `lg` | 64px | Team grid cards |
| `xl` | 128px | Agent detail drawer/profile |

**Status dot:** Small colored circle overlaid on bottom-right corner. Colors follow the heartbeat status logic (green/yellow/gray/red).

**Migration:** `grep -r 'headshot\|emoji.*agent\|AGENT_AVATAR' src/ plugins/` — replace every instance with `<AgentAvatar>`. Emoji representations removed entirely.

### 4. Agent Management Screen

Extend the existing `/team` page (or add `/team/manage`):

- Grid of agent cards showing current avatar + name + role
- Click to edit: upload headshot (client-side crop/resize), set accent color, edit display name
- Thumbnail generation on upload: canvas API resizes to 32/64/128/256px WebP variants
- Stored in `~/.bakin/plugin-settings/agents.json` (per-agent overrides)
- Default data comes from agent definition files; UI overrides take precedence

### 5. Standardized Page Patterns

Every plugin page should follow consistent layouts:

#### Page Layout Template
```
┌─────────────────────────────────────────────┐
│  Breadcrumb: Home > Plugin > Detail         │
│  Page Title                    [Action Btns] │
├─────────────────────────────────────────────┤
│                                             │
│  Content Area                               │
│  (list view, detail view, canvas, etc.)     │
│                                             │
└─────────────────────────────────────────────┘
```

Create a `<PageLayout>` wrapper component:
```typescript
interface PageLayoutProps {
  title: string
  breadcrumbs?: { label: string; href: string }[]
  actions?: React.ReactNode    // action buttons top-right
  children: React.ReactNode
}
```

#### List/Detail Pattern
- List view with filters/search bar
- Click item → navigate to `/{plugin}/{id}` (deep link)
- Detail view with back button
- Side-by-side on wide screens (optional, per plugin)

#### Form Pattern
- `<Form>` wrapper tracks dirty state automatically
- Submit button disabled when form is clean
- Cancel button resets to last saved state
- Validation errors displayed inline below fields
- Loading state on submit (button shows spinner)

#### Empty State Pattern
```typescript
<EmptyState
  icon={IconComponent}
  title="No items yet"
  description="Create your first item to get started."
  action={<Button>Create Item</Button>}
/>
```

#### Loading State Pattern
Skeleton screens matching the expected data layout. Each plugin provides a skeleton variant that matches its actual content shape (not generic spinners).

#### Error State Pattern
```typescript
<ErrorState
  title="Failed to load"
  description={error.message}
  action={<Button onClick={retry}>Retry</Button>}
/>
```

### 6. Agent Colors & Theming

Agent accent colors are **configurable, not hardcoded**:

- Default palette: assign colors from a predefined set when agents are first created
- Stored in agent settings (per-agent `accentColor` in `~/.bakin/plugin-settings/agents.json`)
- CSS custom properties derived at runtime: `--agent-{id}-color`
- Used in: avatar letter fallback, task assignment badges, activity feed highlights, status indicators
- Fallback: if no color configured, derive from agent ID hash → consistent random color

### 7. Plugin Settings UI

Generic settings renderer (connects to Phase 4 `settingsSchema`):

```typescript
<PluginSettings pluginId="assets" />
```

- Reads `settingsSchema` from plugin definition
- Auto-renders form fields by type:
  - `boolean` → `<Switch>`
  - `string` → `<Input>`
  - `number` → `<Input type="number">`
  - `select` → `<Select>` with options
- Dirty state tracking, save/cancel buttons
- Settings page at `/settings` lists all plugins with settings

## Verification

- [ ] All 15 existing components still work after any refactoring
- [ ] New components (form, switch, checkbox, skeleton, etc.) follow shadcn patterns
- [ ] `AgentAvatar` used in every place an agent is represented (grep confirms no raw headshot/emoji usage)
- [ ] Every plugin page uses `<PageLayout>` wrapper
- [ ] Forms across all plugins use `<Form>` with dirty state
- [ ] Empty/loading/error states present in every plugin
- [ ] Agent colors configurable via settings UI
- [ ] `<PluginSettings>` auto-renders from schema for at least one plugin
- [ ] No direct `@base-ui/react` imports outside `src/components/ui/`
- [ ] No hardcoded color values in plugin components — all via Tailwind tokens
