# Authoring a Bakin plugin

This guide walks through writing a Bakin plugin — the shape, the import rules,
the registration contract, and how to install + debug one locally. It reflects
the plugin system after the issue #141 client-side UI refactor: plugins import
exclusively from `@bakin/sdk` and register their UI contributions through
slots and server-side ctx methods.

The **only supported import path** from a plugin is `@bakin/sdk/*`. Direct
imports from other plugins (`@bakin/tasks/...`, `@bakin/workflows/...`) or from
Bakin's internals (`@/components/*`, `@/hooks/*`) are blocked by lint and will
fail CI. Cross-plugin communication goes through `@bakin/sdk/hooks` re-exports
for client-side data and `ctx.hooks.invoke(...)` for server-side calls.

## Directory layout

```
my-plugin/
├── bakin-plugin.json       ← manifest (id, name, version, permissions)
├── index.ts                ← server entry — exports BakinPlugin
├── client.tsx              ← client entry — registers nav items + slots
└── components/
    └── my-page.tsx         ← plugin-owned React components
```

## Manifest (`bakin-plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "One-line description shown in the admin UI",
  "author": "Your Name <you@example.com>",
  "bakinVersion": "^1.0.0",
  "permissions": ["storage.read", "storage.write", "events.emit"]
}
```

The `id` must match `/^[a-z0-9][a-z0-9-_]{0,39}$/i`. Everything else is
advisory for v1 — the `permissions` field is logged at activation but not yet
enforced at runtime (tracked in issue #142).

## Server entry (`index.ts`)

```ts
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'

const plugin: BakinPlugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '0.1.0',

  async activate(ctx: PluginContext) {
    // Register a REST route under /api/plugins/my-plugin/
    ctx.registerRoute({
      path: '/',
      method: 'GET',
      description: 'List things',
      handler: async () => Response.json({ ok: true }),
    })

    // Register an exec tool callable by agents as bakin_exec_my-plugin_foo
    ctx.registerExecTool({
      name: 'bakin_exec_my-plugin_foo',
      label: 'Called the foo thing',
      description: 'Does the foo',
      parameters: { /* zod schema */ },
      handler: async (params, agentId) => ({ ok: true }),
    })

    // Read from another plugin via the hook registry — never import directly
    const board = await ctx.hooks.invoke('tasks.readTaskboard', {})

    // Register a hook so other plugins can call into us
    ctx.hooks.register('my-plugin.someOperation', async (data) => {
      return { result: 'ok', input: data }
    })

    // Register a health check surfaced in /health
    ctx.registerHealthCheck({
      id: 'reachability',
      name: 'My plugin reachability',
      run: async () => [
        { check: 'my-plugin.reachability', status: 'ok', message: 'All good', autoFixable: false },
      ],
    })
  },
}

export default plugin
```

## Client entry (`client.tsx`)

```tsx
import type { NavItem } from '@bakin/sdk/types'
import { registerSlot } from '@bakin/sdk/slots'
import { MyPage } from './components/my-page'

// Sidebar nav entries
export const navItems: NavItem[] = [
  { id: 'my-plugin', label: 'My Plugin', icon: 'Sparkles', href: '/my-plugin', order: 80 },
]

// Register the page component. The shell renders it via <Slot name="page:/my-plugin" />
// at src/app/my-plugin/page.tsx (you can reuse the thin-wrapper pattern the core plugins use).
registerSlot('page:/my-plugin', MyPage)
```

For parameterized routes, register under the Next.js pattern name and accept
the router-derived props in your component:

```tsx
// /my-plugin/[id] — wrapper passes the id + router callbacks as slot props
registerSlot('page:/my-plugin/[id]', MyDetail)

// Your component signature
export function MyDetail({ thingId, onBack }: { thingId: string; onBack: () => void }) { ... }
```

Slots are additive — if you want to augment another plugin's UI, register
against its slot name with a lower `order` to take priority:

```ts
// Override the default asset preview for .glb files
registerSlot('asset-preview', GlbRenderer, 50)  // default built-in is 100
```

Existing slot names used by core plugins:

- `asset-preview` — `{ asset: AssetMeta }` → render an inline preview
- `asset-detail-modal` — `{ filename?: string; assetPath?: string; onClose: () => void }`
- `task-assets` — `{ taskId: string; readOnly?: boolean }`
- `page:<route>` — the shell's route wrappers render this

## Using the SDK

Import UI primitives, hooks, components, types, utils, and slots from
`@bakin/sdk/*`. Full map:

| Path | What it exports |
|------|-----------------|
| `@bakin/sdk/ui` | shadcn primitives — Button, Card, Dialog, Input, Select, Table, Tabs, Tooltip, ... |
| `@bakin/sdk/hooks` | useAgent, useAgentList, useSSE, useSearch, useQueryState, useDebug, useNotificationChannels, ... |
| `@bakin/sdk/components` | PluginHeader, FacetFilter, MarkdownContent/Editor, PageLayout, AgentAvatar, AgentSelect, ChannelIcon, ... |
| `@bakin/sdk/slots` | Slot, registerSlot, __clearSlot (test helper) |
| `@bakin/sdk/types` | PluginContext, BakinPlugin, AssetMeta, Task, TaskBoard, AvailableModel, WorkflowDefinition, NavItem, ... |
| `@bakin/sdk/utils` | cn (tailwind merger), formatAge, formatSize, isStale |

Never reach past the SDK into `@/components/*`, `@/hooks/*`, `@/lib/*`, or
another plugin's internals — the `no-restricted-imports` lint rule will reject
the PR.

## Installing a plugin

Today plugin install is restart-required (tracked as future work in
`.claude/specs/plugin-client-ui-loader.md`):

```bash
# Local — copies a local directory into ~/.bakin/plugins/<id>/
bakin plugins install /path/to/my-plugin

# GitHub — git clones into ~/.bakin/plugins/<id>/
bakin plugins install github:your-user/my-plugin

# Remove
bakin plugins remove my-plugin
```

After install, restart Bakin (`bakin stop && bakin start`). Server-side routes,
hooks, exec tools, search content types, and health checks activate at boot.
Nav items, page components, and slot contributions appear after browser
reload.

## Testing your plugin

Use the helpers in `tests/plugins/test-helpers.ts` (when copied into your
plugin repo):

```ts
import { activatePlugin, callRoute, callTool } from './test-helpers'
import myPlugin from '../index'

const { ctx, routes, execTools } = await activatePlugin(myPlugin, testDir)
const { status, body } = await callRoute(routes[0], ctx, { /* ... */ })
```

For slot tests, use `__clearSlot('slot-name')` between tests to reset
registrations.

## What's next (not yet supported)

- **No-restart install.** A plugin install today requires a Bakin restart.
  The runtime client-side bundle loader is deferred — see
  `.claude/specs/plugin-client-ui-loader.md` Phase 3+4.
- **Runtime permission enforcement.** The `permissions` manifest field is
  logged but not enforced. Tracked in issue #142.
- **Plugin registry / marketplace.** `bakin plugins install github:...`
  works today for any public repo; a curated index is future work.
