---
title: Build a Plugin
description: Walk through the practical path for building, testing, and sharing a Bakin plugin.
---

This is the builder path. Use it when you are ready to turn an idea into a plugin and want the order of operations.

## 1. Name the Job

Write down what the plugin does in one sentence:

- "Pull leads from HubSpot, score them, and let agents qualify the good ones."
- "Show campaign performance in a Bakin dashboard."
- "Give agents a tool that turns a task brief into a publish-ready asset checklist."

That sentence tells you the ingredients. A human-facing workflow needs UI. An external system needs routes and settings. Agent action needs an MCP tool. Durable records probably need search.

## 2. Pick Ingredients

<div class="table-light-full table-label-wrap">

| If the plugin needs to... | Add this |
| --- | --- |
| Show something in Bakin | UI |
| Talk to another system | Routes and settings |
| Let agents take action | MCP tools |
| Let other plugins participate | Hooks |
| Make plugin data retrievable | Search |
| Explain broken setup | Health checks |
| Teach a repeatable procedure | Skills |
| Run a repeatable process | Workflows |

</div>

Keep the first version small. A useful plugin with one page and one tool beats a giant plugin nobody can install with confidence.

## 3. Scaffold

```sh
bakin plugins scaffold my-plugin
cd my-plugin
bun install
bakin plugins install --dev .
bakin dev
```

`--dev` symlinks the local source into Bakin and participates in the dev reload loop. Use normal install only when you want Bakin to copy the plugin into the user's plugin directory:

```sh
bakin plugins install <path|github:user/repo[@ref][#subpath]>
```

## 4. Declare the Manifest

Every plugin starts with `bakin-plugin.json`. The manifest tells Bakin what is being installed before code runs.

At minimum, define identity and entry points:

```json
{
  "id": "lead-intel",
  "name": "Lead Intel",
  "version": "0.1.0",
  "bakin": ">=0.1.0",
  "description": "Lead scoring and qualification for Bakin agents.",
  "entry": {
    "server": "src/index.ts",
    "client": "src/client.tsx"
  }
}
```

Then add permissions and public contributions as the plugin grows. Routes, client pages, MCP tools, CLI commands, settings, and docs should be visible in `contributes` where the manifest supports them.

Full field details live in [Manifest](/docs/extending/plugins/manifest/).

## 5. Build the Client Surface

If humans need a place to work, add a client entry.

```tsx
import { registerPlugin } from '@bakin/sdk'

function LeadIntelPage() {
  return <div>Lead Intel</div>
}

registerPlugin({
  id: 'lead-intel',
  navItems: [
    {
      id: 'lead-intel',
      label: 'Lead Intel',
      icon: 'Radar',
      href: '/lead-intel',
    },
  ],
  routes: {
    '/lead-intel': LeadIntelPage,
  },
})
```

Use `routes` for plugin-owned pages. Use slots when the host already owns the page and your plugin is adding a focused panel or widget.

Full UI details live in [Client UI](/docs/extending/plugins/client-ui/).

## 6. Build the Server Surface

The server entry exports a plugin. Use declarative routes for HTTP APIs and `activate(ctx)` for registrations such as MCP tools, hooks, search, health checks, skills, and workflows.

```ts
import { definePlugin, defineRoute } from '@bakin/sdk'

const plugin = definePlugin({
  id: 'lead-intel',
  name: 'Lead Intel',
  version: '0.1.0',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/leads',
      summary: 'List leads',
      handler: async () => Response.json({ leads: [] }),
    }),
  ],
  async activate(ctx) {
    ctx.registerExecTool({
      name: 'lead_intel_score',
      description: 'Score a lead for sales readiness.',
      parameters: {},
      handler: async () => ({ ok: true, score: 0 }),
    })
  },
})

export default plugin
```

Full server details live in [Server Contracts](/docs/extending/plugins/server-contracts/).

## 7. Keep the Runtime Clean

Plugins reload during development and shut down with Bakin. Keep module import side effects boring. Timers, sockets, watchers, EventSources, subscriptions, and background work should start inside `activate(ctx)` or a narrower handler and clean up in `onShutdown()`.

If settings change runtime behavior, use `onSettingsChange(settings)` instead of making users restart Bakin.

## 8. Check and Share

Run targeted tests while building. Before sharing or opening a PR:

```sh
bun run typecheck
bun run docs:check
```

If your plugin changes a public route, hook, MCP tool, SDK surface, setting, or manifest contribution, update the docs in the same change.

The shell commands in docs are checked against the CLI registry. Longer guide examples should either come from `docs/snippets` or stay clearly illustrative.

## Next

- [Manifest](/docs/extending/plugins/manifest/)
- [Client UI](/docs/extending/plugins/client-ui/)
- [Server Contracts](/docs/extending/plugins/server-contracts/)
