---
title: Server Contracts
description: Register plugin routes, tools, settings, workflows, hooks, search types, health checks, and cleanup from the server entry.
---

The server entry exports a plugin object. Bakin loads it, registers any declarative `routes`, then calls `activate(ctx)`. Use declarative routes for HTTP APIs when you can. Use `activate(ctx)` for runtime registrations and services that need the full plugin context.

The tested minimal server entry lives at `docs/snippets/plugin-basic/index.ts`.

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

Legacy `ctx.registerRoute()` still works for migration compatibility, but new plugin APIs should use declarative routes.

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

  await ctx.runtime.cron.create({
    id: 'reports-refresh',
    name: 'Reports refresh',
    schedule: '*/15 * * * *',
    command: 'bakin:reports:refresh',
    metadata: {
      source: 'bakin',
      isBakinJob: true,
      description: 'Refresh plugin-owned report snapshots.',
    },
  })
}
```

Reserve `bakin:schedule:*` for the schedule plugin itself. If the hook is not
registered or returns `{ ok: false, error }`, the run is recorded as a failure.

## Health Checks

Doctor checks are plugin-registered. Each `ctx.registerHealthCheck()` call adds one row to the registry; the doctor sweep runs registered checks and isolates failures.

```ts
ctx.registerHealthCheck({
  id: 'storage',
  name: 'Docs Basic storage',
  autoFix: false,
  run: async () => [
    {
      check: 'docs-basic.storage',
      status: 'ok',
      message: 'Storage is reachable.',
      autoFixable: false,
    },
  ],
})
```

The registered ID is auto-namespaced to `{pluginId}.{id}`. A throwing check becomes a synthetic error result and does not crash the sweep.

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

## Search

Register search content through `ctx.search`. File-backed content should use Bakin content paths, not absolute host paths. External content types need a complete `reindex()` generator and a `verifyExists()` check so orphan cleanup can work.

Search definitions should name stable tables, list searchable fields, provide facets where useful, and define embedding input that matches the way users and agents will query the content.

## Cleanup

Use lifecycle hooks deliberately:

- `onReady()` runs after all plugins activate.
- `onSettingsChange(settings)` runs after this plugin's settings change.
- `onShutdown()` runs during reload or graceful shutdown.
- `onUninstall(ctx)` runs before Bakin removes plugin-owned bookkeeping.

Clear interval and timeout handles, close sockets and watchers, and call unsubscribe functions from event buses or external libraries. A plugin should not require a Bakin restart for ordinary setting changes unless the underlying service really requires it.
