---
title: Plugins
description: Extend Bakin with product surfaces, server behavior, hooks, MCP tools, settings, search, health checks, skills, and workflows.
---

Plugins add new functionality to Bakin. Reach for one when the built-in app almost does what you need, but your operation has its own shape: an SDR pipeline, a CRM sync, a business intelligence view, a launch tracker, an approval queue, or a new tool your agents should be able to call.

A plugin can be tiny. It can be a single MCP tool. It can also be a full product surface with pages, routes, settings, search, health checks, hooks, skills, and workflows.

## What Plugins Ship

<div class="table-light-full table-label-wrap">

| Ingredient | What it adds |
| --- | --- |
| UI | Pages, dashboards, panels, task sidebars, widgets, and custom views. |
| Routes | Plugin-owned HTTP APIs, webhooks, sync endpoints, and callbacks. |
| Hooks | Cross-plugin connection points without importing another plugin's files. |
| MCP tools | Actions agents can call while they work. |
| Settings | User-configurable behavior. |
| Search | Plugin-owned content that users and agents can retrieve later. |
| Health checks | Diagnostics for broken credentials, missing files, stale syncs, or bad state. |
| Skills and workflows | Plugin-owned procedures and repeatable flows. |

</div>

## How to Think About It

Start with the job, not the API.

If you are building an SDR pipeline, you probably need a page for leads, routes to sync and update records, settings for provider keys and thresholds, search so agents can retrieve account context, and an MCP tool so an agent can score or qualify a lead.

If you are building a launch tracker, you might only need a page, a small storage model, and a health check that warns when the tracker cannot read its source files.

If you are building an agent capability with no UI, you may only need an MCP tool, a skill, and a workflow.

## Build Path

1. Sketch the ingredients: UI, routes, tools, hooks, settings, search, health checks, skills, workflows.
2. Scaffold the plugin and install it in dev mode.
3. Declare the manifest so Bakin knows what is being installed.
4. Build the client UI if humans need a surface.
5. Build server contracts for routes, tools, hooks, search, health checks, skills, and workflows.
6. Run docs and type checks before sharing.

Walk the full path in [Build a Plugin](/docs/extending/plugins/build/).

## Import Rule

Plugin code imports from the SDK:

```ts
import { definePlugin, registerPlugin } from '@makinbakin/sdk'
import { Button } from '@makinbakin/sdk/ui'
import type { PluginContext } from '@makinbakin/sdk/types'
```

Do not import host files, `src`, `packages/host`, another plugin's internals, or Bakin path aliases. If a plugin needs something that is not in `@makinbakin/sdk`, that is an SDK gap.

## Related

- [Build a Plugin](/docs/extending/plugins/build/): the full authoring path
- [Manifest](/docs/extending/plugins/manifest/): install-time metadata and permissions
- [Client UI](/docs/extending/plugins/client-ui/): pages, navigation, slots, and UI conventions
- [Server Contracts](/docs/extending/plugins/server-contracts/): routes, tools, hooks, search, health checks, skills, workflows, and cleanup
- [Ingredients](/docs/extending/ingredients/): glossary of plugin and agent kit parts
