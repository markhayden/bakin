---
title: Client UI
description: Register plugin navigation, pages, routes, slots, and shell-integrated UI through @makinbakin/sdk.
---

Client entries use `registerPlugin()` from `@makinbakin/sdk`. Beyond `navItems`/`routes`/`slots`, a plugin can register `search: { hitRenderers }` — plain data-mapping functions (`(hit) => { title, subtitle?, href, thumbnailUrl?, icon?, meta? }`; `meta` is the small type · agent · date line under the subtitle) that render its content type in the global ⌘K search overlay; unknown types get a default renderer (see [Search](/docs/extending/plugins/search/)). For live UI updates when server-side data changes, subscribe with `usePluginEvent` — see [Realtime Events](/docs/extending/plugins/realtime/). Keep UI contributions predictable and compose them from the focused SDK contracts: `PageShell`/`PageHeader`, `SystemState`, `ConfirmDialog`, and `TurnOutputView` cover the common examples. The reference plugin's [`client-registration.tsx`](https://github.com/markhayden/bakin/blob/main/examples/reference-plugin/client-registration.tsx), [`BookmarksPage`](https://github.com/markhayden/bakin/blob/main/examples/reference-plugin/components/bookmarks-page.tsx), and [`ui.fixture.tsx`](https://github.com/markhayden/bakin/blob/main/examples/reference-plugin/tests/ui.fixture.tsx) are the worked production registration, page, slot, and browser-test examples. Plugin UI should feel like part of Bakin: dense enough for repeated work, accessible, and clear about loading, empty, error, and permission states.

The tested minimal client entry lives at `docs/snippets/plugin-basic/client.tsx`.

<!-- docs:snippet plugin-basic-client -->
Source: `docs/snippets/plugin-basic/client.tsx`

```tsx
import { registerPlugin } from '@makinbakin/sdk'

function DocsBasicPage() {
  return <div>Hello from a Bakin plugin.</div>
}

registerPlugin({
  id: 'docs-basic',
  navItems: [
    {
      id: 'docs-basic',
      label: 'Docs Basic',
      icon: 'Puzzle',
      href: '/docs-basic',
      order: 100,
    },
  ],
  routes: {
    '/docs-basic': DocsBasicPage,
  },
})
```
<!-- /docs:snippet -->

## Lazy Loading

The shell does not import every plugin's client bundle at boot. Declare your client's contributions in `bakin-plugin.json` — `contributes.nav` (sidebar items as JSON), `contributes.routes` (the patterns you pass to `registerPlugin({ routes })`), and `contributes.slots` (the slot names you fill) — and Bakin renders your nav immediately while loading `client.js` only on first navigation into one of your routes or first render of one of your slots.

Keep the manifest declarations and the `registerPlugin()` call in sync: Bakin runs a drift check after every client load and warns on mismatch. Clients that must run at boot (badge providers, conditional nav) set `contributes.eager: true` and may keep registering `navItems` at runtime — runtime nav overrides manifest nav while the plugin is registered. A client with no declarative metadata loads eagerly (legacy behavior).

## Navigation

Navigation items should be stable and specific to the plugin. Use a valid Lucide icon name; an unrecognized name falls back to `Puzzle`. Prefer declaring nav in `bakin-plugin.json` `contributes.nav` (same NavItem shape, JSON) so it renders before your client loads; pass `navItems` to `registerPlugin()` only when nav must be computed at runtime.

Choose `plan-and-automate`, `create`, or `operations` for a top-level item's `section`. Omit it for **Mix-ins**. Plugins cannot create headings or join the host-owned Chat/Tasks and utility regions. Official destinations stay first inside defined sections; custom items follow by `order` (default `100`), label, then ID. Children cannot declare a section.

<div class="table-light-full table-label">

| Field | Meaning |
| --- | --- |
| `id` | Stable item ID. Prefix with the plugin ID. |
| `label` | Sidebar label. |
| `icon` | Lucide icon name. |
| `href` | Route path. |
| `order` | Optional sort order. Defaults to `100`. |
| `section` | Optional top-level section: `plan-and-automate`, `create`, or `operations`; omitted means Mix-ins. |
| `children` | Nested nav items. |
| `badge` | Optional initial badge — runtime values flow through `setNavBadge`. |

</div>

Groups need no special expansion flag. Expanded sidebars render a disclosure button; the collapsed rail exposes every group's children through the same hover, focus, and click flyout. Active groups open automatically, and choosing a child navigates normally.

## Nav badges

A nav item can carry a runtime badge — a small count pill or a presence
dot — that updates live without re-registering the plugin. Use it for
"needs attention" surfaces such as a Messaging Plans review queue or an
inbox count.

The contract is identical for core and installed plugins.

```tsx
import { registerPlugin } from '@makinbakin/sdk'
import { useNavBadge } from '@makinbakin/sdk/hooks'

function PlansBadgeProvider() {
  // Use whatever data hook the plugin already has — REST, SSE, local cache.
  const { summary } = usePlansSummary()
  const needsReview = summary?.needsReview ?? 0
  // useNavBadge syncs the badge keyed on its value, so it only writes when
  // count/tone actually change. (setNavBadge is also idempotent if you call
  // it directly.)
  useNavBadge('messaging', 'messaging-plans',
    needsReview > 0 ? { count: needsReview, tone: 'attention' } : null)
  return null
}

registerPlugin({
  id: 'messaging',
  navItems: [
    { id: 'messaging-plans', label: 'Plans', icon: 'ClipboardList', href: '/messaging/plans' },
  ],
  // Background components rendered into the well-known nav-badge-providers
  // slot stay mounted while the plugin is registered, so their hooks run
  // even when you're on another page.
  slots: { 'nav-badge-providers': PlansBadgeProvider },
})
```

The `NavBadge` shape is `{ count?: number; tone?: 'error' | 'attention' | 'info' | 'success' }`.
Tones render by severity — `error` (red) > `attention` (amber) > `info`
(blue) > `success` (green) — and `error` wins a collapsed-parent rollup.
Counts greater than 99 render as `99+`. Passing `null` to `setNavBadge`
clears the badge. The `badge?` field on `NavItem` itself is only an
initial seed — runtime values from `setNavBadge` take precedence and are
what the sidebar reads.

Badges are cleaned up automatically when the owning plugin unregisters
or hot-reloads. A closed or collapsed parent renders one presence rollup
dot using the highest severity across its own badge and all child badges;
expanded children retain their real counts.

## Routes

Use `routes` for plugin-owned pages. The host catch-all route renders registered plugin routes and passes route params into the component.

```tsx
registerPlugin({
  id: 'docs-basic',
  routes: {
    '/docs-basic': DocsBasicPage,
    '/docs-basic/[id]': DocsBasicDetailPage,
  },
})
```

Patterns support exact paths and dynamic segments in `:id`, `[id]`, or `$id` form. Declare every registered pattern in `bakin-plugin.json` `contributes.routes` so direct navigation lazy-loads your client; if a route is visible in navigation, also declare it in `contributes.clientRoutes` for docs generation. Avoid patterns that collide with Bakin's own pages (`/tasks`, `/chat`, …) — core routes always win, and the shell logs a shadow warning at boot when a plugin pattern can never render.

## Navigating

Internal navigation must stay client-side — a raw `<a href="/…">` or `window.location` assignment reloads the whole shell (and fails Bakin's lint/architecture checks for in-tree plugins). Use:

```tsx
import { PluginLink, useRouter } from '@makinbakin/sdk/navigation'

// Links: a real anchor (copy / cmd-click / middle-click all work) that
// routes primary clicks through the client router.
<PluginLink to={`/docs-basic/${item.id}`}>{item.name}</PluginLink>

// Programmatic:
const router = useRouter()
router.push(`/docs-basic/${item.id}`)          // history entry; scrolls to top
router.push(url, { scroll: false })            // keep scroll position
router.replace(`/docs-basic?view=grid`)        // no history entry; keeps scroll
```

:::note[One browser navigation boundary]
`@makinbakin/sdk/navigation` also publishes URL-state hooks, history-aware back
behavior, and the complete unsaved-changes guard. Keep server HTTP declarations
in `@makinbakin/sdk/routing`; do not copy either implementation or add another
router abstraction.
:::

Query values are always plain strings (`?id=123` reads back as `'123'`), and multiple `useQueryState` setter calls in one handler compose into a single navigation.

## Calling your API routes

Never hand-build `/api/plugins/<id>/...` strings — use `pluginFetch` (raw
`Response`, JSON defaults; plain-object bodies are stringified with the JSON
content type) or `usePluginJsonFetch` (the `{ data, loading, error, refresh }`
lifecycle) scoped to your plugin id:

```tsx
import { pluginFetch } from '@makinbakin/sdk/utils'
import { usePluginJsonFetch } from '@makinbakin/sdk/hooks'

// component lifecycle
const { data, loading, refresh } = usePluginJsonFetch<{ items: Item[] }>('docs-basic', 'items')

// imperative mutation
await pluginFetch('docs-basic', 'items', { method: 'POST', body: { name: 'New item' } })
```

Both compose with the host's dev-mode hot-reload fetch instrumentation
automatically.

## Page Slots

Use `page:/...` slots when the host already owns the route and the plugin fills that route. Core plugins use this for built-in pages such as Tasks, Assets, Schedule, Team, Models, Health, Workflows, and Memory.

```tsx
registerPlugin({
  id: 'tasks',
  slots: {
    'page:/tasks': KanbanBoard,
  },
})
```

For a new route owned by your plugin, prefer `routes`.

## Slots

Slots let plugins add focused UI to existing Bakin workflows.

<div class="table-light-full table-label-wrap">

| Slot | Use it for |
| --- | --- |
| `asset-preview` | Custom asset card preview content. |
| `asset-detail-modal` | Asset detail panels. |
| `task-assets` | Task drawer asset attachments. |
| `task-sidebar` | Task-specific side panels. |
| `home-widget` | Dashboard widgets. |
| `page:/<route>` | Host-owned page mount. |

</div>

Register with `registerSlot()` directly when you need a custom order. Lower order renders first.

## UI Primitives

Import primitives from `@makinbakin/sdk/ui`, layout from
`@makinbakin/sdk/layout`, and application patterns from
`@makinbakin/sdk/patterns`. New UI must not consume the frozen
`@makinbakin/sdk/components` barrel.

```tsx
import { Button } from '@makinbakin/sdk/ui'
import { PageShell } from '@makinbakin/sdk/layout'
import { PageHeader } from '@makinbakin/sdk/patterns'
```

Custom UI is fine when the domain needs it, but keep Bakin conventions: small radii, clear tables and filters, keyboard-friendly controls, visible empty states, and no layout shift when data loads.

Start in the public Storybook catalog and record any deliberate exception in
the change. The explanation must name the domain requirement, the closest
defined pattern, why that pattern does not fit, and the smallest accessible
exception being introduced. The reference plugin's `bun run test:ui` command
is the copyable page-and-slot conformance setup for external packages.

## Agent Chat Surfaces

Use the conversation kit's `ConversationPanel` when a plugin needs a durable
agent chat panel inside its own page. Keep the plugin-owned record as the
source of truth for visible messages. Create the server-owned background turn
with `ctx.conversations.createTurnService(...)`, and use
`useConversationThread` to load the transcript and consume the service's
plugin-namespaced events. The turn survives navigation and request teardown.

`transformText` lets the plugin post-process assistant text and render
structured artifacts below it without forking the chat component. For
example, a content planning plugin can strip proposal JSON from an assistant
message and render a review badge inline:

```tsx
import {
  ConversationPanel,
  useConversationThread,
  type ConversationMessage,
} from '@makinbakin/sdk/conversation'
import { pluginFetch } from '@makinbakin/sdk/utils'

function PlanningChat({ sessionId, agentId }) {
  const thread = useConversationThread({
    threadKey: sessionId,
    events: {
      chunk: 'messaging.plan.chunk',
      done: 'messaging.plan.done',
      error: 'messaging.plan.error',
    },
    keyOf: (payload) => payload.sessionId,
    load: async () => {
      const response = await pluginFetch('messaging', `sessions/${sessionId}`)
      if (!response.ok) return null
      return response.json() as Promise<{
        messages: ConversationMessage[]
        streaming?: boolean
        streamingText?: string
      }>
    },
    post: async (_key, content) => {
      const response = await pluginFetch('messaging', `sessions/${sessionId}/messages`, {
        method: 'POST',
        body: { content },
      })
      return response.ok
        ? { ok: true }
        : { ok: false, status: response.status }
    },
  })

  return (
    <ConversationPanel
      messages={thread.messages}
      liveChunks={thread.liveChunks}
      streaming={thread.streaming}
      agent={{ id: agentId, name: agentId }}
      onSend={thread.send}
      onAbort={() => {
        void pluginFetch('messaging', `sessions/${sessionId}/abort`, {
          method: 'POST',
        })
      }}
      storageKey={`messaging:${sessionId}`}
      fitParent
      showHeader={false}
      transformText={(text) => ({
        text: text.replace(/```json[\s\S]*?```/g, '').trim(),
        extras: <ProposalBadge />,
      })}
    />
  )
}
```

Persist `ConversationMessage` rows and parsed artifacts in plugin storage for
reloads. Do not replay the whole stored transcript into every agent call
unless the agent task explicitly needs that context.

## Runtime Cleanup

During development, Bakin can unregister and reload client contributions. If a plugin maintains a client-side registry outside `registerPlugin()`, enroll cleanup with `registerPluginCleanup(id, fn)`.

```ts
import { registerPluginCleanup } from '@makinbakin/sdk'

registerPluginCleanup('docs-basic', () => {
  // Clear plugin-owned client registries here.
})
```

## Import Rule

Import supported surfaces only:

```ts
import { registerPlugin } from '@makinbakin/sdk'
import { Button } from '@makinbakin/sdk/ui'
import type { NavItem } from '@makinbakin/sdk'
```

Host internals can change without warning. SDK exports are the contract.
