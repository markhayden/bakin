---
title: Client UI
description: Register plugin navigation, pages, routes, slots, and shell-integrated UI through @makinbakin/sdk.
---

Client entries use `registerPlugin()` from `@makinbakin/sdk`. Keep UI contributions predictable and built from SDK components where practical. Plugin UI should feel like part of Bakin: dense enough for repeated work, accessible, and clear about loading, empty, error, and permission states.

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

## Navigation

Navigation items should be stable and specific to the plugin. Use lucide icon names. Include `order` only when the plugin has a strong placement requirement.

<div class="table-light-full table-label">

| Field | Meaning |
| --- | --- |
| `id` | Stable item ID. Prefix with the plugin ID. |
| `label` | Sidebar label. |
| `icon` | Lucide icon name. |
| `href` | Route path. |
| `order` | Optional sort order. Defaults to `100`. |
| `children` | Nested nav items. |

</div>

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

Patterns support exact paths and dynamic segments in `:id`, `[id]`, or `$id` form. If a route is visible in navigation, also declare it in `bakin-plugin.json` `contributes.clientRoutes`.

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
