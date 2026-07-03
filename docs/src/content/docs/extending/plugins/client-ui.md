---
title: Client UI
description: Register plugin navigation, pages, routes, slots, and shell-integrated UI through @makinbakin/sdk.
---

Client entries use `registerPlugin()` from `@makinbakin/sdk`. Beyond `navItems`/`routes`/`slots`, a plugin can register `search: { hitRenderers }` — plain data-mapping functions (`(hit) => { title, subtitle?, href, thumbnailUrl?, icon? }`) that render its content type in the global ⌘K search overlay; unknown types get a default renderer. Keep UI contributions predictable and built from SDK components where practical. Plugin UI should feel like part of Bakin: dense enough for repeated work, accessible, and clear about loading, empty, error, and permission states.

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

Navigation items should be stable and specific to the plugin. Use lucide icon names. Include `order` only when the plugin has a strong placement requirement. Prefer declaring nav in `bakin-plugin.json` `contributes.nav` (same NavItem shape, JSON) so it renders before your client loads; pass `navItems` to `registerPlugin()` only when nav must be computed at runtime.

<div class="table-light-full table-label">

| Field | Meaning |
| --- | --- |
| `id` | Stable item ID. Prefix with the plugin ID. |
| `label` | Sidebar label. |
| `icon` | Lucide icon name. |
| `href` | Route path. |
| `order` | Optional sort order. Defaults to `100`. |
| `children` | Nested nav items. |
| `badge` | Optional initial badge — runtime values flow through `setNavBadge`. |

</div>

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
or hot-reloads. The sidebar renders a presence rollup dot on the
collapsed parent when any child has a badge.

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

Patterns support exact paths and dynamic segments in `:id`, `[id]`, or `$id` form. Declare every registered pattern in `bakin-plugin.json` `contributes.routes` so direct navigation lazy-loads your client; if a route is visible in navigation, also declare it in `contributes.clientRoutes` for docs generation.

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

Import common UI from `@makinbakin/sdk/ui` and shared app components from `@makinbakin/sdk/components`.

```tsx
import { Button } from '@makinbakin/sdk/ui'
import { PluginHeader } from '@makinbakin/sdk/components'
```

Custom UI is fine when the domain needs it, but keep Bakin conventions: small radii, clear tables and filters, keyboard-friendly controls, visible empty states, and no layout shift when data loads.

## Agent Chat Surfaces

Use `IntegratedBrainstorm` when a plugin needs a durable agent chat panel
inside its own page. Keep the plugin-owned record as the source of truth for
visible messages and pass a stable thread id to the server route so the runtime
adapter can preserve conversation continuity.

`transformAssistantMessage` lets the plugin render structured artifacts below
assistant text without forking the chat component. For example, a content
planning plugin can parse proposal ids from an assistant message and render
review cards inline:

```tsx
import { IntegratedBrainstorm } from '@makinbakin/sdk/components'

function PlanningChat({ sessionId, agentId, proposalByMessageId }) {
  return (
    <IntegratedBrainstorm
      endpoint={`/api/plugins/messaging/sessions/${sessionId}/messages`}
      agentId={agentId}
      transformAssistantMessage={(message) => {
        const proposals = proposalByMessageId.get(message.id) ?? []
        return (
          <>
            <p>{message.content}</p>
            {proposals.map((proposal) => (
              <PlanProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </>
        )
      }}
    />
  )
}
```

Persist activity rows and parsed artifacts in plugin storage for reloads. Do
not replay the whole stored transcript into every agent call unless the agent
task explicitly needs that context.

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
