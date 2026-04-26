---
title: Client UI
description: Register plugin navigation, pages, slots, and shell-integrated UI through @bakin/sdk.
---

Client entries use `registerPlugin()` from `@bakin/sdk`. Keep UI contributions small, predictable, and built from SDK components whenever possible.

The tested minimal client entry lives at `apps/docs/snippets/plugin-basic/client.tsx`.

```tsx
import { registerPlugin } from '@bakin/sdk'

function HelloPage() {
  return <div>Hello from Bakin</div>
}

registerPlugin({
  id: 'hello-plugin',
  navItems: [
    {
      id: 'hello-plugin.home',
      label: 'Hello',
      icon: 'Sparkles',
      href: '/hello-plugin',
    },
  ],
  slots: {
    'page:/hello-plugin': HelloPage,
  },
})
```

## Navigation

Navigation items should be stable and specific to the plugin. Use lucide icon names and include `order` only when the plugin has a strong placement requirement.

| Field | Meaning |
| --- | --- |
| `id` | Stable item id. Prefix with the plugin id. |
| `label` | Sidebar label. |
| `icon` | Lucide icon name. |
| `href` | Route path. |
| `order` | Optional sort order. Defaults to `100`. |
| `children` | Nested nav items. |

## Pages

Page slots use `page:/route`. Prefer one top-level route per plugin area, then manage local tabs or filters inside that page.

Use SDK UI primitives first. Custom UI is allowed when the domain needs it, but it should preserve Bakin keyboard behavior, spacing, contrast, and loading states.

## Slots

Slots let plugins add focused UI to existing Bakin workflows.

| Slot | Use it for |
| --- | --- |
| `asset-preview` | Custom asset card preview content. |
| `asset-detail-modal` | Asset detail panels. |
| `task-assets` | Task drawer asset attachments. |
| `task-sidebar` | Task-specific side panels. |
| `home-widget` | Dashboard widgets. |
| `page:/<route>` | Full page plugin mount. |

## Runtime Cleanup

During development, Bakin can unregister and reload client contributions. If a plugin maintains a client-side registry outside `registerPlugin()`, enroll cleanup with `registerPluginCleanup(id, fn)`.

```ts
import { registerPluginCleanup } from '@bakin/sdk'

registerPluginCleanup('hello-plugin', () => {
  // Clear plugin-owned client registries here.
})
```

## Import Rule

Import supported surfaces only:

```ts
import { registerPlugin } from '@bakin/sdk'
import { Button } from '@bakin/sdk/ui'
import type { NavItem } from '@bakin/sdk'
```

Host internals can change without warning. SDK exports are the contract.
