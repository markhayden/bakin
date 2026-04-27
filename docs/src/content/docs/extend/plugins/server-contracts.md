---
title: Server Contracts
description: Register plugin routes, tools, settings, workflows, hooks, search types, and health checks from activate().
---

The server entry exports a `BakinPlugin`. Bakin calls `activate(ctx)` once the plugin is loaded. Register server-side behavior there.

The tested minimal server entry lives at `docs/snippets/plugin-basic/index.ts`.

<!-- docs:snippet plugin-basic-server -->
Source: `docs/snippets/plugin-basic/index.ts`

```ts
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'

const plugin: BakinPlugin = {
  id: 'docs-basic',
  name: 'Docs Basic',
  version: '0.1.0',
  async activate(ctx: PluginContext) {
    ctx.registerRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Say hello',
      description: 'Returns a small JSON payload from the docs example plugin.',
      visibility: 'public',
      stability: 'stable',
      handler: async () => Response.json({ message: 'Hello from Bakin' }),
    })
  },
}

export default plugin
```
<!-- /docs:snippet -->

## `activate(ctx)`

Use `activate()` for registration, not for long-running background work. Keep side effects obvious and idempotent so plugin reload and test setup are predictable.

| API | Use it for |
| --- | --- |
| `ctx.registerRoute()` | HTTP routes under the plugin API mount. |
| `ctx.registerExecTool()` | Agent-callable execution tools exposed through MCP. |
| `ctx.registerSkill()` | Agent skills contributed by the plugin. |
| `ctx.registerWorkflow()` | Workflow definitions shipped with the plugin. |
| `ctx.registerNodeType()` | Custom workflow node kinds. |
| `ctx.registerNotificationChannel()` | Workflow notification targets. |
| `ctx.registerHealthCheck()` | Doctor checks shown by Health. |
| `ctx.registerSlot()` | Server-declared UI slots. |
| `ctx.search.registerFileBackedContentType()` | Search content whose source of truth is under `~/.bakin/`. |
| `ctx.search.registerContentType()` | Search content backed by an external source. |
| `ctx.hooks.register()` | Cross-plugin hook handlers. |

## Route Metadata

Public routes should include `summary`, `description`, `visibility`, `stability`, schemas, examples, source metadata, and permissions. New public routes without metadata should be treated as incomplete work.

Use `@bakin/sdk/metadata` helpers as the contract surface grows. The goal is one definition that powers validation, reference docs, and agent-facing bundles.

## Exec Tools

Exec tools are the API agents usually feel first. Keep tool names stable, parameter schemas strict, and result shapes boring.

```ts
ctx.registerExecTool({
  name: 'hello_plugin_echo',
  description: 'Echo a short message through the hello plugin.',
  parameters: {
    message: z.string().min(1).max(500),
  },
  handler: async (params) => ({
    ok: true,
    message: String(params.message),
  }),
})
```

Exec tool examples in public docs must either be tested or clearly marked illustrative with the reason they cannot run in CI.

## Health Checks

Doctor checks are plugin-registered. Each `ctx.registerHealthCheck` call adds one row to the registry; the doctor cron iterates and runs them in parallel.

```ts
import type { HealthCheckResult } from '@bakin/sdk'

function checkSomething(): HealthCheckResult[] {
  return [{ check: 'something', status: 'ok', message: '...', autoFixable: false }]
}

ctx.registerHealthCheck({
  id: 'something',
  name: 'Friendly description shown in admin UIs',
  autoFix: true, // metadata only — orchestrator runs every check
  run: () => Promise.resolve(checkSomething()),
})
```

The id is auto-namespaced to `{pluginId}.{id}`. Per-check try/catch lives in the orchestrator — throw freely. A throwing handler becomes one synthetic error result and never crashes the sweep.

`HealthCheckResult` has four fields: `{ check, status, message, autoFixable }`. `status` is `'ok' | 'warn' | 'error' | 'fixed'`. The result row's `check` field is whatever the implementation emits — it does not have to match the registered id.

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

## Shutdown

Use `onShutdown()` for graceful cleanup and `onSettingsChange()` for settings-driven updates. Do not make plugin consumers restart Bakin for ordinary configuration changes unless the underlying service truly requires it.
