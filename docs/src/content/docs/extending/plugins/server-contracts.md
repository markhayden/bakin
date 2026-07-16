---
title: Server Contracts
description: Register plugin routes, tools, settings, workflows, hooks, search types, health checks, and cleanup from the server entry.
---

The server entry exports a plugin object. Bakin loads it, registers any declarative `routes`, then calls `activate(ctx)`. Use declarative routes for HTTP APIs when you can. Use `activate(ctx)` for runtime registrations and services that need the full plugin context.

The tested minimal server entry lives at `docs/snippets/plugin-basic/index.ts`.

**Server entries must not import client-only SDK subpaths** — `/slots`, `/components`, `/ui`, `/hooks` retain runtime React imports when inlined into the server bundle; React is host-provided to the **browser** only, so a binary install fails at activation. The build rejects such bundles with the offending specifier named. The SDK root, `/routing`, `/types`, `/utils`, and `/metadata` are server-safe.

<!-- docs:snippet plugin-basic-server -->
Source: `docs/snippets/plugin-basic/index.ts`

```ts
import { definePlugin, defineRoute } from '@makinbakin/sdk'

const plugin = definePlugin({
  id: 'docs-basic',
  name: 'Docs Basic',
  version: '0.1.0',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Say hello',
      description: 'Returns a small JSON payload from the docs example plugin.',
      visibility: 'public',
      stability: 'stable',
      handler: async () => Response.json({ message: 'Hello from Bakin' }),
    }),
  ],
  async activate() {},
})

export default plugin
```
<!-- /docs:snippet -->

## Declarative Routes

`defineRoute()` gives route handlers typed `params`, `query`, and `body` input from Zod schemas. The same metadata drives runtime dispatch and generated API docs.

```ts
defineRoute({
  method: 'POST',
  path: '/items/:id',
  summary: 'Update an item',
  body: z.object({ title: z.string().min(1) }),
  responses: {
    200: z.object({ ok: z.boolean() }),
  },
  handler: async (_req, ctx, parsed) => {
    ctx.storage.write(`${parsed.params.id}.json`, JSON.stringify(parsed.body))
    return Response.json({ ok: true })
  },
})
```

Plugin API paths are mounted under `/api/plugins/{pluginId}`. A plugin route with `path: '/hello'` becomes `/api/plugins/docs-basic/hello`.

The legacy `ctx.registerRoute()` API was removed — routes are always declared declaratively via `definePlugin({ routes })`. A typo'd `definePlugin` key or an excess property fails typecheck at the call site.

One side effect of that exactness: **generic wrappers around `definePlugin` fail to compile** — `function wrap<T extends DefinePluginInput>(p: T) { return definePlugin(p) }` trips the excess-key enforcement. Call `definePlugin` with a concrete object literal (or a concrete-typed factory), not through a generic passthrough.

Body specs accept only the supported `contentType` values (`application/json` — the default when you pass a schema — and the other members of the published union). An unknown value such as `'json'` is rejected loudly: at `defineRoute()` for literal specs, and at activation for anything that slips past — never a silent pass-through with an unparsed body.

For a complete route surface built the way these docs teach it (list/create/delete with zod params, query filters, and shared logic between a route and an exec tool), read the reference plugin's [`index.ts`](https://github.com/markhayden/bakin/tree/main/examples/reference-plugin).

## `activate(ctx)`

Use `activate()` for registration, not for long-running background work. Keep it idempotent so plugin reload and tests are predictable.

<div class="table-light-full table-label-wrap">

| API | Use it for |
| --- | --- |
| `ctx.registerExecTool()` | Agent-callable execution tools exposed through MCP. |
| `ctx.registerSkill()` | Agent skills contributed by the plugin. |
| `ctx.registerWorkflow()` | Workflow definitions shipped with the plugin. |
| `ctx.registerNodeType()` | Custom workflow node kinds. |
| `ctx.registerNotificationChannel()` | Workflow notification targets. |
| `ctx.registerHealthCheck()` | Doctor checks shown by Health. |
| `ctx.registerSlot()` | Server-declared UI slots. Most UI slots are client-side. |
| `ctx.search.registerFileBackedContentType()` | Search content whose source of truth is under the Bakin content directory. |
| `ctx.search.registerContentType()` | Search content backed by an external source. |
| `ctx.hooks.register()` | Cross-plugin hook handlers. |
| `ctx.watchFiles()` | Plugin-owned file patterns that should trigger rebuild or reload work. |

</div>

Do not create lifetime resources at module import time. Timers, process listeners, file watchers, sockets, EventSources, and event-target listeners belong inside `activate(ctx)` or a narrower handler and need a matching cleanup path.

## Storage

`ctx.storage` is the plugin's file store, and its root depends on where the plugin came from:

- **Installed (user) plugins are jailed** to `~/.bakin/plugin-data/<pluginId>/`. Every path you read or write — `read`, `write`, `readJson`, `writeJson`, `list`, `exists`, `remove` — is relative to that directory, and the adapter refuses traversal out of it.
- **Core plugins** see the whole Bakin content directory (they manage shared stores like tasks and assets).

Write your plugin against the jailed model: relative paths only, no assumptions about siblings. Two consequences worth knowing:

- File-backed search `filePatterns` match paths relative to the **content directory**, not your storage root. An installed plugin's files live under `plugin-data/<pluginId>/`, so a note stored at `data/notes/x.md` (storage-relative) is matched by the pattern `plugin-data/<pluginId>/data/notes/*.md`.
- Plugin **settings** are not in your storage. They live at `~/.bakin/plugin-settings/<pluginId>.json` and are reached through `ctx.getSettings()` / `ctx.updateSettings()` — never write settings files yourself.

Emitting a live UI update after a storage write is the normal pairing — see [Realtime Events](/docs/extending/plugins/realtime/).

## Exec Tools

Exec tools are the API agents usually feel first. Keep tool names stable, parameter schemas strict, and result shapes boring.

```ts
ctx.registerExecTool({
  name: 'bakin_exec_docs-basic_echo',
  description: 'Echo a short message through the docs basic plugin.',
  parameters: {
    message: z.string().min(1).max(500),
  },
  handler: async (params) => ({
    ok: true,
    message: String(params.message),
  }),
})
```

Use the enforced `bakin_exec_{pluginId}_{action}` prefix for user plugin tools. The tool must also be declared in `bakin-plugin.json` under `contributes.execTools`; duplicate names and cross-plugin prefixes fail plugin activation. Return an actionable `error` string when `ok` is false. If the tool mutates tasks, assets, workflows, or external systems, make that obvious in the name and description.

## Hooks

Hooks are cross-plugin contracts. Use them when the caller should not know which plugin handles the work.

```ts
const unsubscribe = ctx.hooks.register(
  'docs-basic.enrich',
  (data) => ({ ...data, source: 'docs-basic' }),
  {
    summary: 'Add docs basic metadata.',
    hookKind: 'waterfall',
    visibility: 'public',
    stability: 'stable',
  },
)
```

Store unsubscribe functions when a handler has a shorter lifetime than the plugin. Public hooks need metadata because generated docs and agent bundles depend on it.

### Hooks You Can Invoke

Core plugins expose cross-plugin hooks through the same registry — call them with `ctx.hooks.invoke(name, data)`. Hook contracts are currently **by-convention, not typed**: the shapes below reflect the current implementations, and you should treat a `null`/missing-handler result as "that plugin isn't installed" rather than an error.

<div class="table-light-full table-label-wrap">

| Hook | Payload → Result |
| --- | --- |
| `team.list` | `{}` → array of agents with display + team metadata |
| `team.getAgent` | `{ id }` → one agent record or `null` |
| `team.getAgentIds` | `{}` → `string[]` of runtime agent ids |
| `team.exists` | `{ teamId }` → boolean — TEAM existence (org teams), not agents |
| `team.getTeamMembers` | `{ teamId }` → agents assigned to a team |
| `workflows.definitions.list` | `{}` → available workflow definitions |
| `workflows.instances.list` | `{}` → workflow instances |
| `workflows.createInstance` | `{ taskId, workflowId, assignee? }` → new instance (start a workflow) |
| `workflows.approveGate` / `workflows.rejectGate` | gate id payload → gate decision applied |
| `schedule.ensureBakinJob` | job spec (see Plugin-Owned Cron Jobs below) → `{ ok, jobId }` |
| `assets.listByTask` | `{ taskId }` → `{assetId, description, type}[]` records for a task |
| `assets.describe` | `{ assetIds: string[] }` → `{ [id]: { description, caption?, type, exists } }` |
| `assets.saveFromSource` | source-file payload → saved/upserted asset |
| `models.getAvailableModels` | `{}` → the merged model catalog |
| `models.getEffectiveModel` | agent/context payload → the model routing would pick |
| `health.list` | `{}` → registered health checks |

</div>

The full, current list is discoverable from generated docs (hooks with `visibility: 'public'` metadata) — anything not listed there is an internal contract that may change without notice.

## Plugin-Owned Cron Jobs

Use `ctx.runtime.cron` for scheduled work owned by a plugin. When the schedule
should call back into the plugin instead of creating a Bakin task, register a
hook and create a cron command with the `bakin:<pluginId>:<action>` convention.
The schedule bridge invokes `${pluginId}.${action}.run`.

```ts
async activate(ctx) {
  ctx.hooks.register(
    'reports.refresh.run',
    async ({ jobId, runId }) => {
      await refreshReports({ jobId, runId })
      return { ok: true }
    },
    {
      hookKind: 'rpc',
      summary: 'Refresh report snapshots.',
      visibility: 'public',
      stability: 'stable',
    },
  )

  const result = await ctx.hooks.invoke('schedule.ensureBakinJob', {
    jobId: 'reports-refresh',
    name: 'Reports refresh',
    schedule: '*/15 * * * *',
    command: 'bakin:reports:refresh',
    metadata: {
      source: 'bakin',
      isBakinJob: true,
      description: 'Refresh plugin-owned report snapshots.',
    },
  })

  // Persist result.jobId if your plugin needs to reference the runtime job later.
  // Some runtimes generate provider ids even when jobId is supplied.
}
```

Reserve `bakin:schedule:*` for the schedule plugin itself. If the hook is not
registered or returns `{ ok: false, error }`, the run is recorded as a failure.

## Health Checks

Health checks are plugin-registered, owner-aware producers. Each `ctx.registerHealthCheck()` call adds one definition to the canonical registry. The runner isolates failures, validates the complete result, stamps ownership and freshness, and projects one immutable `HealthReport` for every consumer.

```ts
import { healthHealthy, healthObserved } from '@makinbakin/sdk/utils'

ctx.registerHealthCheck({
  id: 'storage',
  name: 'Docs Basic storage',
  description: 'Verifies that the plugin storage directory is readable.',
  group: { key: 'storage', label: 'Storage' },
  maxAgeMs: 60_000,
  run: async () => healthObserved([
    healthHealthy({
      key: 'directory',
      summary: 'Plugin storage is reachable.',
      evidence: { mode: 'read-write' },
    }),
  ]),
})
```

The registered ID is namespaced to `{pluginId}.{id}`. Observation and incident keys remain stable within that check; titles and messages are display text, never identity. Use structured resources and JSON-safe evidence so UI, CLI, delegation, and repair flows do not parse prose.

An observed run must contain at least one observation. Return `healthNotApplicable(reason)` when a check does not apply. Do not return an empty array, invent a healthy result after a failed read, or mutate state while diagnosing. A thrown or invalid result becomes a core-owned **Unable to verify** incident while unrelated checks continue.

Status and incident disposition are intentionally constrained:

- `healthHealthy(...)` has no incident.
- `healthWarning(...)` carries an advisory, watch, or action-required incident.
- `healthError(...)` always carries an action-required incident.
- `healthUnknown(...)` carries a watch incident for evidence that could not be verified.

Core stamps the plugin owner, full check and observation IDs, execution timestamps, snapshot freshness, and incident IDs. `maxAgeMs` controls when retained evidence becomes stale; stale last-known evidence is never presented as current health.

### Repair actions

Register deterministic repairs separately with `ctx.registerHealthRepairAction()`, then reference the owner-local action ID from an observation's repair resolution. A repair action has two phases:

1. `plan(target)` describes concrete changes, safety (`safe`, `manual`, or `destructive`), and affected evidence without mutating anything.
2. `apply(items)` performs only the selected plan items and returns applied/skipped/failed results plus affected check IDs.

The server stores the opaque plan, binds it to observation execution IDs and resolution keys, and expires it after ten minutes. Manual and destructive items require individual confirmation. If affected evidence changes or resolves before apply, the server returns `STALE_PLAN` and performs zero mutations. After apply, core reruns affected checks so “applied” and “verified” remain distinct.

Registration validates IDs and lengths, group metadata, same-origin navigation, resource shapes, evidence JSON safety and size, and owner-local repair references. Invalid registration fails plugin activation and appears in the plugin failure registry. Hot reload removes the plugin's checks, repair actions, and cached snapshots together.

## Settings

Use `settingsSchema` for plugin settings that should render in Bakin. The persisted shape belongs to the plugin, but the field schema is public because users and agents rely on it.

```ts
settingsSchema: {
  fields: [
    {
      key: 'enabled',
      type: 'boolean',
      label: 'Enabled',
      default: true,
    },
  ],
}
```

Read settings with `ctx.getSettings()` and persist partial updates with `ctx.updateSettings()`. Use `onSettingsChange(settings)` when a changed setting should update runtime behavior without a restart.

All supported field types:

<div class="table-light-full table-label-wrap">

| Type | Renders as | Extras |
| --- | --- | --- |
| `string` | Single-line text input | `default?: string` |
| `number` | Numeric input | `default?: number` |
| `boolean` | Toggle | `default?: boolean` |
| `select` | Dropdown | `options: { value, label }[]` (both fields required), `default?: string` |
| `list` | Repeatable rows | `itemShape` (a record of string/number/boolean/select fields per row), `addLabel?`, `minItems?`, `maxItems?`, `uniqueField?` |

</div>

Every field takes `key`, `label`, and optional `description` / `required`. The reference plugin's `settingsSchema` shows `number` and `string` fields being read back with `ctx.getSettings()` inside both a route and an exec tool.

## Search

Register search content through `ctx.search`. Every content type declares a required `schemaVersion` — bump it when the doc shape changes and the table migrates in the background (no manual reindex, no downtime). All content types need a side-effect-free, restartable `reindex()` generator and a `verifyExists()` check; writes journal through a durable outbox and are fire-and-forget safe.

The full authoring guide — registration, file-backed sync, hit renderers, honest degradation — lives at [Search](/docs/extending/plugins/search/).

## Cleanup

Use lifecycle hooks deliberately:

- `onReady()` runs after all plugins activate.
- `onSettingsChange(settings)` runs after this plugin's settings change.
- `onShutdown()` runs during reload or graceful shutdown.
- `onUninstall(ctx)` runs before Bakin removes plugin-owned bookkeeping.

Clear interval and timeout handles, close sockets and watchers, and call unsubscribe functions from event buses or external libraries. A plugin should not require a Bakin restart for ordinary setting changes unless the underlying service really requires it.
