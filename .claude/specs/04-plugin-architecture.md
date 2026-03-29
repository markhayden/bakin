# Phase 4: Plugin Architecture Hardening

**Status:** Pending
**Dependencies:** Phases 0-1. Phase 2 makes boundaries cleaner but not strictly blocking.

## Purpose

Formalize the plugin system for extensibility and production use. This phase addresses five critical gaps: plugin lifecycle, cross-plugin hooks, plugin-scoped scripts, activity transparency, and per-plugin settings.

## Current State

- Plugins activate in config order (no dependency resolution)
- No lifecycle hooks beyond `activate()`
- Cross-plugin interaction via direct imports (tight coupling) or barely-used event bus
- Exec tool handlers receive `(params, agent)` — no plugin context
- Activity reporting is ad-hoc (some use SSE broadcast directly, some use `logProgress()`)
- No per-plugin settings system
- Agents hardcoded in `src/lib/agents-data.ts`
- Routes use query params for resource IDs (no deep linking)

## Deliverables

### 1. Plugin Lifecycle Hooks

Extend `BakinPlugin` interface (renamed from `MCPlugin`):

```typescript
interface BakinPlugin {
  id: string
  name: string
  version: string

  // Settings schema — auto-rendered into config UI
  settingsSchema?: Record<string, SettingsField>

  // Lifecycle
  activate(ctx: PluginContext): void | Promise<void>     // existing
  onReady?(): void | Promise<void>                       // after ALL plugins activated
  onShutdown?(): void | Promise<void>                    // graceful shutdown
  onSettingsChange?(settings: unknown): void             // settings updated

  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}
```

**Registry changes:**
1. Load all plugins (call `activate()`)
2. After all loaded, iterate and call `onReady()` on each
3. On SIGTERM/SIGINT, call `onShutdown()` on each (reverse order)
4. On settings file change, call `onSettingsChange()` with new values

### 2. Cross-Plugin Hooks

Replace direct imports with a typed hook system. Plugins declare what hooks they provide and what they consume.

```typescript
// Extended PluginContext
interface PluginContext {
  // ... existing methods ...
  hooks: HookRegistry
}

interface HookRegistry {
  // Provider: register a hook this plugin offers
  provide<T>(name: string, schema?: z.ZodSchema<T>): void

  // Consumer: listen for a hook from another plugin
  on<T>(name: string, handler: (data: T) => void | Promise<void>): void

  // Caller: invoke a hook (returns results from all handlers)
  call<T, R = void>(name: string, data: T): Promise<R[]>
}
```

**Core hooks to define:**

| Hook | Provider | Consumers | Data |
|------|----------|-----------|------|
| `task:create` | tasks | schedule, workflows | `{ title, agent, workflow?, parentId? }` → returns `{ taskId }` |
| `task:created` | tasks | projects, memory | `{ taskId, title, agent }` |
| `task:completed` | tasks | schedule, projects, workflows | `{ taskId, title, agent }` |
| `task:moved` | tasks | projects, health | `{ taskId, from, to }` |
| `task:blocked` | tasks | health, schedule | `{ taskId, reason }` |
| `asset:created` | assets | projects, memory | `{ path, type, taskId, agent }` |
| `asset:deleted` | assets | projects | `{ path }` |
| `workflow:step:completed` | workflows | tasks, memory | `{ instanceId, stepName, taskId }` |
| `workflow:gate:reached` | workflows | health | `{ instanceId, gateName, taskId }` |
| `project:item:checked` | projects | tasks | `{ projectId, itemIndex, checked }` |
| `project:updated` | projects | health | `{ projectId, status }` |

**Migration from direct imports:**
- `import { createTaskWithEffects }` → `ctx.hooks.call('task:create', { ... })`
- `import { autoCheckLinkedItem }` → `ctx.hooks.call('project:item:check', { ... })`
- `import { readTaskboard }` (read-only) → stays as import OR add `task:query` hook

### 3. Plugin-Scoped Scripts

Enhance exec tool registration so plugins can bundle scripts with full context access.

**Current handler signature:**
```typescript
handler: (params: Record<string, unknown>, agent: string) => Promise<ExecToolResult>
```

**New handler signature:**
```typescript
handler: (params: Record<string, unknown>, agent: string, ctx: PluginToolContext) => Promise<ExecToolResult>
```

Where `PluginToolContext` is a subset of `PluginContext`:
```typescript
interface PluginToolContext {
  storage: StorageAdapter
  events: EventBus
  hooks: HookRegistry
  activity: ActivityAPI
  vault: { get(key: string): string | null }
  getSettings<T>(): T
}
```

**Plugin manifest declares scripts:**
```json
{
  "scripts": ["scripts/*.ts"]
}
```

Script files in a plugin's `scripts/` directory auto-register during activation. The plugin registry reads the glob, imports each file, and registers tools with the plugin's context.

**Naming convention enforced:** Tools registered by a plugin MUST start with `bakin_exec_{pluginId}_`. Registry rejects tools that don't match.

### 4. Activity & Transparency API

Standard interface so every plugin feeds the live activity feed consistently:

```typescript
interface ActivityAPI {
  // Log a human-readable message to the activity feed
  log(agent: string, message: string, opts?: {
    taskId?: string
    category?: 'START' | 'PROGRESS' | 'MILESTONE' | 'BLOCKED' | 'COMPLETE'
    stage?: string
  }): void

  // Log a structured audit event
  audit(event: string, agent: string, data: Record<string, unknown>): void
}
```

Added to `PluginContext` as `ctx.activity`:
- `ctx.activity.log(...)` wraps `logProgress()` from task-service
- `ctx.activity.audit(...)` wraps `appendAudit()` from audit module
- Plugins never need to know about SSE, globalThis, or broadcast internals

**Migration:** Replace all direct `broadcast()` calls in plugins with `ctx.activity.log()`. Replace all `appendAudit()` calls with `ctx.activity.audit()`.

### 5. Per-Plugin Settings

Settings schema declared on the plugin object, auto-rendered into a config UI (Phase 3 builds the renderer).

```typescript
interface SettingsField {
  type: 'boolean' | 'string' | 'number' | 'select'
  default: unknown
  label: string
  description: string
  options?: string[]        // for 'select' type
  min?: number              // for 'number' type
  max?: number              // for 'number' type
}
```

**Storage:** `~/.bakin/plugin-settings/{pluginId}.json`

**API on PluginContext:**
```typescript
ctx.getSettings<T>(): T           // returns merged defaults + saved values
ctx.updateSettings<T>(partial: Partial<T>): void  // deep merge + persist
```

**Settings change flow:**
1. UI calls `POST /api/plugins/{id}/settings` with partial update
2. Core merges with existing, writes to file
3. Calls `plugin.onSettingsChange(newSettings)` if defined
4. Broadcasts settings change event via SSE

### 6. Dependency Resolution

Plugin registry sorts plugins topologically by manifest `dependencies` before activation:

```typescript
// In plugin-registry.ts initialize():
const sorted = topologicalSort(config.plugins, (plugin) => manifest.dependencies || [])
for (const entry of sorted) {
  await this.loadPlugin(entry.path, storage, events)
}
```

- Missing dependency: log warning, skip the plugin (don't crash)
- Circular dependency: detect and error with clear message listing the cycle
- Dependency of a disabled plugin: warn but don't fail

### 7. Route Standardization

All plugin resources accessible by path segment ID for deep linking:

**API routes:**
| Current | New |
|---------|-----|
| `GET /api/plugins/projects/get?id=proj-123` | `GET /api/plugins/projects/proj-123` |
| `GET /api/plugins/assets/file?path=...` | `GET /api/plugins/assets/files/{encoded-path}` |
| `GET /api/plugins/schedule/job?jobId=daily` | `GET /api/plugins/schedule/jobs/daily` |

**Page routes:**
| Current | New |
|---------|-----|
| `/tasks` (no detail view) | `/tasks` + `/tasks/{taskId}` |
| `/projects` (query param) | `/projects` + `/projects/{projectId}` |
| `/workflows` (query param) | `/workflows` + `/workflows/{instanceId}` |
| `/assets` (query param) | `/assets` + `/assets/{type}/{path}` |

Requires Next.js dynamic route segments: `src/app/tasks/[id]/page.tsx`, etc.

### 8. Agents as Data

Move agent definitions from hardcoded `agents-data.ts` to loadable files:

**Core agents:** Ship as YAML files in a `data/agents/` directory within the repo (or within an agents plugin).

```yaml
# data/agents/pixel.yaml
id: pixel
name: Pixel
role: Image Generation
title: Image Artist
headshot: /headshots/pixel.webp
model: claude-sonnet-4-6
definition: >
  Pixel generates images for social media, blog posts, and marketing materials.
shouldDo:
  - Generate images matching the brief
  - Use correct aspect ratios for each platform
shouldNotDo:
  - Write copy or captions
  - Publish without orchestrator approval
tools:
  - bakin_exec_save_asset
  - bakin_exec_generate_image
```

**Addon agents:** YAML files in `~/.bakin/agents/{id}.yaml` — same schema, picked up automatically.

**Agent loader:**
```typescript
function loadAgents(): AgentProfile[] {
  const core = loadYamlDir('data/agents/')
  const addon = loadYamlDir(join(getContentDir(), 'agents/'))
  // Addon overrides core by ID
  return mergeById(core, addon)
}
```

**AgentProfile gains `source` field:** `'core' | 'addon'`

**Main agent:** Still resolved via `getMainAgentId()` from settings — the YAML files just provide the persona data.

### 9. Version Control & Migrations

**Plugin version tracking:**
- `~/.bakin/plugin-versions.json`: `{ "tasks": "1.0.0", "assets": "1.2.0" }`
- On startup, compare installed version with manifest version
- If manifest version > installed version, run pending migrations

**Migration format:**
```
plugins/tasks/migrations/
  001-add-priority-field.ts
  002-normalize-agent-names.ts
```

Each migration exports:
```typescript
export const version = '1.1.0'  // version this migration brings you to
export async function up(storage: StorageAdapter): Promise<void> {
  // transform data
}
```

**Migration runner:** On startup, for each plugin:
1. Read installed version from `plugin-versions.json`
2. List migration files, filter to those > installed version
3. Run in order
4. Update `plugin-versions.json`

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/lib/plugin-types.ts` | Add lifecycle hooks, hooks registry, activity API, settings to interfaces |
| `src/lib/plugin-registry.ts` | Add dependency resolution, lifecycle management, settings wiring |
| `scripts/lib/registry.ts` | Update handler signature, add naming validation |
| `src/core/mcp-server.ts` | Pass PluginToolContext to exec tool handlers |
| `src/core/task-service.ts` | Emit hooks instead of direct cross-plugin calls |
| `plugins/schedule/index.ts` | Replace direct task imports with hooks |
| `plugins/projects/index.ts` | Replace direct task imports with hooks |
| `src/lib/agents-data.ts` | Replace with YAML loader |
| All plugin `index.ts` files | Add settingsSchema, use ctx.activity, use ctx.hooks |

## Verification

- [ ] Plugin activation order respects dependency graph (visible in startup logs)
- [ ] `onReady()` fires after all plugins are loaded
- [ ] `onShutdown()` fires on SIGTERM
- [ ] Schedule plugin creates tasks via `ctx.hooks.call('task:create')`, not direct import
- [ ] Plugin settings can be read/written via API and auto-rendered UI
- [ ] Exec tool handlers receive PluginToolContext
- [ ] `ctx.activity.log()` and `ctx.activity.audit()` feed SSE correctly
- [ ] All deep links work: `/tasks/{id}`, `/projects/{id}`, `/workflows/{id}`
- [ ] Agent YAML files in `~/.bakin/agents/` are picked up without code changes
- [ ] Plugin migration runs on version bump
- [ ] No direct cross-plugin `import` statements remain (except core utilities)
