# Plugin System — Deep Reference

## Overview

Bakin uses a custom plugin architecture where functionality is organized into self-contained plugins. Each plugin registers routes, MCP tools, UI navigation, hooks, and skills through a context object provided during activation. Cross-plugin communication is handled exclusively through the HookRegistry — no direct imports between plugins or between core and plugins.

## Plugin Lifecycle

```
bakin.config.ts defines enabled plugins
    ↓
PluginRegistryImpl.initialize():
  1. Read all bakin-plugin.json manifests (get dependencies)
  2. Topological sort (Kahn's algorithm) — respects dependencies
  3. Cycle detection → log error, skip cycle
  4. Missing dependency → log warning, load anyway (soft)
    ↓
For each plugin (in sorted order):
  dynamic import → extract BakinPlugin → run migrations → create PluginContext → call activate(ctx)
    ↓
After built-in plugins: scan ~/.bakin/plugins/ for user plugins (override by ID)
    ↓
All registrations stored in PluginState per plugin
    ↓
pluginRegistry.onAllReady() → calls plugin.onReady() on each plugin
    ↓
On shutdown (SIGTERM): pluginRegistry.shutdownAll() → calls plugin.onShutdown() in reverse order
```

## Core Interfaces

### BakinPlugin (`packages/core/src/plugin-types.ts`, re-exported via `src/lib/plugin-types.ts`)
```typescript
interface BakinPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
  onReady?(): void | Promise<void>                      // after ALL plugins activated
  onShutdown?(): void | Promise<void>                   // graceful shutdown (reverse order)
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  settingsSchema?: PluginSettingsSchema                  // auto-rendered settings UI
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}
```

### PluginContext (`packages/core/src/plugin-types.ts`)
Provided to `activate()`. This is the plugin's only interface to the system:

| Method | Purpose |
|--------|---------|
| `storage: StorageAdapter` | Read/write markdown files in `~/.bakin/` |
| `events: EventBus` | Pub/sub with pattern matching |
| `pluginId: string` | This plugin's ID |
| `registerNav(items)` | Add sidebar navigation items |
| `registerRoute(route)` | Add HTTP API route at `/api/plugins/{id}/{path}` |
| `registerSlot(reg)` | Register React component for a named UI slot |
| `registerExecTool(tool)` | Register MCP execution tool (agent-callable) |
| `registerSkill(skill)` | Register AI skill definition |
| `watchFiles(patterns)` | Request file watcher notifications |
| `getSettings<T>()` | Read this plugin's persisted settings from `plugin-settings/{id}.json` |
| `updateSettings(patch)` | Merge partial update into settings, persist, notify `onSettingsChange` |
| `activity.log(agent, message, opts?)` | SSE activity feed broadcast |
| `activity.audit(event, agent, data?)` | Structured audit trail (`appendAudit` + SSE) |
| `hooks.register(name, handler)` | Register a hook handler (returns unsubscribe fn) |
| `hooks.has(name)` | Check if any handlers registered for a hook |
| `hooks.invoke<R>(name, data)` | Invoke a hook and get its result (RPC-style) |

### PluginSettingsSchema
```typescript
interface SettingsField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  options?: { value: string; label: string }[]
  default?: unknown
}

interface PluginSettingsSchema {
  fields: SettingsField[]
}
```

All 10 plugins define `settingsSchema`. The settings page at `/settings` fetches schemas from `GET /api/plugin-settings/schemas` and renders them via `PluginSettingsRenderer`. Values are persisted at `~/.bakin/plugin-settings/{pluginId}.json` via `GET/PUT /api/plugin-settings/{pluginId}`.

### PluginManifest (`bakin-plugin.json`)
```typescript
interface PluginManifest {
  id: string
  name: string
  version: string
  bakin: string               // semver range for compatibility
  description: string
  entry: { server: string; client?: string }
  contentFiles?: string[]
  secrets?: string[]           // vault keys this plugin needs
  tests?: string
  dependencies?: string[]      // other plugin IDs — drives topological sort
  permissions?: string[]       // storage.read, storage.write, events.emit
}
```

## HookRegistry — Cross-Plugin Communication

`packages/core/src/hooks/hook-registry.ts` — singleton shared across all plugins and core.

### GlobalThis Backing
The hook registry singleton is backed by `globalThis.__bakinHookRegistry` to survive Next.js webpack module re-evaluation during HMR. Without this, the singleton reference would be lost on hot reload, breaking all hook-based operations (task creation, moves, etc.). The same pattern is used for the plugin registry (`globalThis.__bakinPluginRegistry`), SSE broadcasting (`globalThis.__bakinBroadcast`), and settings cache (`globalThis.__bakinSettingsCache` + `__bakinOpenClawMtime` + `__bakinOpenClawAgents`). See `src/lib/plugin-registry.ts` and `packages/core/src/settings.ts` for implementations.

### How it works
1. Plugins register hooks in `activate()` via `ctx.hooks.register(name, handler)`
2. Core modules and other plugins invoke hooks via `getHookRegistry().invoke<R>(name, data)`
3. Hooks are RPC-style: one handler per hook name, returns a result

### Hook naming convention
`{pluginId}.{operation}` — e.g., `tasks.readTaskboard`, `workflows.getCurrentStep`, `projects.readProject`

### Current hook registrations

| Plugin | Hooks | Examples |
|--------|-------|---------|
| tasks | 9 | `tasks.readTaskboard`, `tasks.createTask`, `tasks.moveTask`, `tasks.blockTask`, `tasks.addTaskLog`, `tasks.updateTask`, `tasks.deleteTask`, `tasks.setDependency`, `tasks.clearDependency` |
| workflows | 13 | `workflows.loadInstance`, `workflows.createInstance`, `workflows.getCurrentStep`, `workflows.completeStep`, `workflows.matchWorkflow`, `workflows.listDefinitions`, `workflows.loadDefinition`, `workflows.getActiveAgents`, `workflows.saveInstance`, etc. |
| assets | 8 | `assets.validateSidecar`, `assets.getSidecarPath`, `assets.createStub`, `assets.detectVariant`, `assets.getAssetTypes`, `assets.listTrash`, `assets.restoreAsset`, `assets.emptyTrash` |
| team | 7 | `team.listAgents`, `team.getAgent`, `team.getAgentIds`, `team.resolveProfile`, `team.getTeamMembers`, `team.getAgentTeam`, `team.getOrgStructure` |
| models | 5 | `models.configChanged`, `models.getEffectiveModel`, `models.getAvailableModels`, `models.markConfigDirty`, `models.markGatewayRestarted` |
| projects | 2 | `projects.readProject`, `projects.autoCheckLinkedItem` |

### Invoking hooks from core
```typescript
import { getHookRegistry } from '@/lib/plugin-registry'
const hooks = getHookRegistry()
const board = await hooks.invoke<TaskBoard>('tasks.readTaskboard', {})
```

### Hook parameter conventions
- Task mutation hooks use `identifier` (not `taskId`) for `blockTask`, `addTaskLog`, `moveTask`, `deleteTask`, `updateTask`
- `setDependency`/`clearDependency` use `taskId` and `dependsOnId`
- Workflow hooks use `taskId`, `contentDir`, `agentId` etc.

### Exec tool registrations by plugin

8 plugins register exec tools, 2 don't (memory, models):

| Plugin | Exec tools |
|--------|-----------|
| tasks | 11 |
| workflows | 10 |
| assets | 9 |
| schedule | 10 |
| calendar | 7 |
| projects | 15 |
| team | 8 |
| health | 2 |
| scripts (non-plugin) | 5 |
| **Total** | **77** (72 plugin + 5 script) |

**Critical:** No direct imports between plugins or from core → plugins. All cross-boundary calls go through hooks. Verified: `grep -r "from '../../plugins/" src/core/ scripts/lib/` returns 0 results.

## Exec Tool Registry

### How it works
1. `scripts/lib/registry.ts` — global `Map<string, ExecToolDefinition>`
2. Core tools self-register at import time (files in `scripts/lib/*.ts`)
3. Plugin tools register via `ctx.registerExecTool()` → calls `addExecTool()` with `source: 'plugin:{id}'`
4. `src/core/mcp-server.ts` imports core tool files, then calls `getAllExecTools()` to register all tools with the MCP server

### PluginToolContext
When the MCP server executes a tool handler, it builds a `PluginToolContext` via `getToolContext(toolName)`:

```typescript
interface PluginToolContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  hooks: HookAPI
  activity: ActivityAPI
  getSettings<T = Record<string, unknown>>(): T
}
```

Tool handlers receive it as an optional third argument:
```typescript
handler: (params: Record<string, unknown>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
```

The `getToolContext()` function in `scripts/lib/registry.ts` uses `eval('require')` to prevent Next.js webpack from tracing runtime-only imports (it's only called from the custom Node server's MCP handler, never from Next.js routes).

### Naming convention
`bakin_exec_{pluginId}_{action}` — e.g., `bakin_exec_project_list`, `bakin_exec_schedule_fire`

### Adding a new core tool
1. Create `scripts/lib/{tool-name}.ts`
2. Call `addExecTool()` at module scope
3. Add import in `src/core/mcp-server.ts`

## Route Handling

### Server-side registration
Plugins register routes in `activate()`:
```typescript
ctx.registerRoute({
  path: '/',
  method: 'POST',
  handler: async (req, ctx) => {
    const body = await req.json()
    // ... do work ...
    return Response.json({ ok: true })
  },
  description: 'Create a new item',
})

ctx.registerRoute({
  path: '/:taskId',
  method: 'DELETE',
  handler: async (req) => {
    // ... delete item ...
    return Response.json({ ok: true })
  },
  description: 'Delete an item by ID',
})
```

### Parameterized routes
Paths can include `:param` segments for RESTful naming:
```typescript
ctx.registerRoute({
  path: '/definitions/:name',
  method: 'GET',
  handler: async (req) => {
    const url = new URL(req.url)
    const name = url.searchParams.get('name') // injected from path param
    // ...
  },
})
```

### Catch-all router
`src/app/api/plugins/[pluginId]/[[...path]]/route.ts` handles all plugin API requests.
The router's `matchRoute()` tries exact match first, then falls back to segment-by-segment `:param` matching. Extracted path params are injected into the request URL's `searchParams` so handlers read them the same way as query params.

Request to `/api/plugins/workflows/definitions/my-workflow` → extracts `pluginId=workflows`, `path=/definitions/my-workflow` → matches route `/definitions/:name` → injects `name=my-workflow` into searchParams.

## Client-Side Plugin Manifest

`src/lib/plugin-manifest.ts` — static imports of all plugin `client.tsx` files:
```typescript
import { navItems as taskNav } from '../../plugins/tasks/client'
// ... all plugins
export const allNavItems: NavItem[] = [...taskNav, ...].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
```

This is NOT dynamic — new plugins must be added here manually.

## Storage Adapter

`src/lib/storage/markdown-adapter.ts` — `MarkdownStorageAdapter` implementing `StorageAdapter`:

| Method | Behavior |
|--------|----------|
| `read(path)` | Read file relative to content dir, returns null if missing |
| `write(path, content)` | Write file, creates directories as needed |
| `append(path, content)` | Append to file |
| `exists(path)` | Check file existence |
| `readAll()` | Read all files in content dir (flat) |

All paths relative to `~/.bakin/` (resolved via `getContentDir()`).

## Event Bus

`src/lib/events/event-bus.ts` — `BakinEventBus` implementing `EventBus`:

- `emit(event, data)` — broadcast to all matching subscribers
- `on(pattern, handler)` — subscribe with exact match or prefix glob (`task.*` matches `task.created`)
- `once(pattern, handler)` — one-time subscription

The event bus is used by the workflows plugin for notifications. Most cross-plugin communication uses the HookRegistry instead.

## User Plugin Override

`~/.bakin/plugins/` is scanned after built-in plugins. If a user plugin has the same ID as a built-in, it replaces it. This allows users to fork and customize any core plugin without modifying the repo.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/plugin-types.ts` | All interfaces (BakinPlugin, PluginContext, HookAPI, SettingsSchema, etc.) |
| `packages/core/src/hooks/hook-registry.ts` | HookRegistry class (register, invoke, has) |
| `src/lib/plugin-types.ts` | Re-export shim for backward compat |
| `src/lib/plugin-registry.ts` | Singleton registry, plugin loading, topo sort, hook registry, route/nav/slot lookups |
| `src/lib/plugin-manifest.ts` | Client-side static imports, allNavItems |
| `bakin.config.ts` | Plugin enable list |
| `scripts/lib/registry.ts` | Exec tool registry (addExecTool, getAllExecTools, getToolContext) |
| `src/core/mcp-server.ts` | MCP server, tool registration, core tool imports |
| `src/app/api/plugins/[pluginId]/[[...path]]/route.ts` | Catch-all API router |
| `src/app/api/plugin-settings/schemas/route.ts` | Serves all plugin settings schemas |
| `src/app/api/plugin-settings/[pluginId]/route.ts` | GET/PUT per-plugin settings values |
| `src/components/plugin-settings-renderer.tsx` | Auto-renders settings UI from schema |
