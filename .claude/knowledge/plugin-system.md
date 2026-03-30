# Plugin System — Deep Reference

## Overview

Bakin uses a custom plugin architecture where functionality is organized into self-contained plugins. Each plugin registers routes, MCP tools, UI navigation, and skills through a context object provided during activation.

## Plugin Lifecycle

```
bakin.config.ts defines enabled plugins
    ↓
PluginRegistryImpl.initialize() iterates list
    ↓
For each plugin: dynamic import → extract BakinPlugin → create PluginContext → call activate(ctx)
    ↓
After built-in plugins: scan ~/.bakin/plugins/ for user plugins (override by ID)
    ↓
All registrations stored in PluginState per plugin
```

**Key:** There is no dependency ordering yet. Plugins activate in config order. Phase 4 adds topological sort.

## Core Interfaces

### BakinPlugin (`packages/core/src/plugin-types.ts`, re-exported via `src/lib/plugin-types.ts`)
```typescript
interface BakinPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
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
  dependencies?: string[]      // other plugin IDs (not enforced yet)
  permissions?: string[]       // storage.read, storage.write, events.emit
}
```

## Route Handling

### Server-side registration
Plugins register routes in `activate()`:
```typescript
ctx.registerRoute({
  path: '/create',
  method: 'POST',
  handler: async (req, ctx) => {
    const body = await req.json()
    // ... do work ...
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
  description: 'Create a new item',
})
```

### Catch-all router
`src/app/api/plugins/[pluginId]/[...path]/route.ts` handles all plugin API requests.
Request to `/api/plugins/tasks/create` → extracts `pluginId=tasks`, `path=/create` → calls `pluginRegistry.findRoute('tasks', '/create', 'POST')`.

### Route rebuild on API calls
The catch-all route re-initializes the plugin registry if needed (handles Next.js hot reload).

## Exec Tool Registry

### How it works
1. `scripts/lib/registry.ts` — global `Map<string, ExecToolDefinition>`
2. Core tools self-register at import time (files in `scripts/lib/*.ts`)
3. Plugin tools register via `ctx.registerExecTool()` → calls `addExecTool()` with `source: 'plugin:{id}'`
4. `src/core/mcp-server.ts` imports core tool files, then calls `getAllExecTools()` to register all tools with the MCP server

### Tool handler signature
```typescript
handler: (params: Record<string, unknown>, agent: string) => Promise<ExecToolResult>
```
Handlers receive raw params + agent identity. They do NOT receive PluginContext (Phase 4 enhancement).

### Naming convention
`bakin_exec_{pluginId}_{action}` — e.g., `bakin_exec_project_list`, `bakin_exec_schedule_fire`

### Adding a new core tool
1. Create `scripts/lib/{tool-name}.ts`
2. Call `addExecTool()` at module scope
3. Add import in `src/core/mcp-server.ts`

## Client-Side Plugin Manifest

`src/lib/plugin-manifest.ts` — static imports of all plugin `client.tsx` files:
```typescript
import * as tasks from '../../plugins/tasks/client'
import * as projects from '../../plugins/projects/client'
// ... all plugins

export const allNavItems: NavItem[] = [
  ...tasks.navItems,
  ...projects.navItems,
  // ...
].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
```

This is NOT dynamic — new plugins must be added here manually. Phase 4 may add dynamic discovery.

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

**Currently underutilized.** Most plugins use direct imports or SSE broadcast instead. Phase 4 formalizes cross-plugin hooks on top of the event bus.

## User Plugin Override

`~/.bakin/plugins/` is scanned after built-in plugins. If a user plugin has the same ID as a built-in, it replaces it. This allows users to fork and customize any core plugin without modifying the repo.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/plugin-types.ts` | All interfaces (BakinPlugin, PluginContext, etc.) |
| `src/lib/plugin-types.ts` | Re-export shim for backward compat |
| `src/lib/plugin-registry.ts` | Singleton registry, plugin loading, route/nav/slot lookups |
| `src/lib/plugin-manifest.ts` | Client-side static imports, allNavItems |
| `bakin.config.ts` | Plugin enable list |
| `scripts/lib/registry.ts` | Exec tool registry (addExecTool, getAllExecTools) |
| `src/core/mcp-server.ts` | MCP server, tool registration, core tool imports |
| `src/core/plugin-installer.ts` | Install/remove plugins from ~/.bakin/plugins/ |
| `src/app/api/plugins/[pluginId]/[...path]/route.ts` | Catch-all API router |
