# @bakin/sdk

SDK for building [Bakin](https://github.com/markhayden/bakin) plugins.
Gives you the `registerPlugin` helper, shared UI components, slot
types, and React hooks the Bakin host shell already ships at runtime.

Your plugin bundles use this package as a TypeScript source, but at
runtime React + `@bakin/sdk/*` are externalized and resolved through
the host's import map — so plugins don't ship a second copy of any of
them.

## Install

```sh
bun install @bakin/sdk
# or
npm install @bakin/sdk
```

`react` and `react-dom` are peer dependencies; the Bakin host provides
the actual instances at runtime.

## Quickstart

```sh
bakin plugins scaffold my-plugin
cd my-plugin
bun install
bakin plugins install .
```

## Minimal client entry

```tsx
// src/client.tsx
import { registerPlugin } from '@bakin/sdk'

registerPlugin({
  id: 'my-plugin',
  navItems: [
    { title: 'My plugin', path: '/my-plugin' },
  ],
  pages: {
    '/my-plugin': () => <div>Hello from my plugin</div>,
  },
})
```

## Minimal server entry

```ts
// src/index.ts
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'

const plugin: BakinPlugin = {
  id: 'my-plugin',
  name: 'My plugin',
  version: '0.1.0',
  async activate(ctx: PluginContext) {
    ctx.registerRoute({
      method: 'GET',
      path: '/hello',
      handler: async () => Response.json({ ok: true }),
    })
  },
}

export default plugin
```

## Slots

Bakin surfaces these extensibility slots by default. Register a
component for a slot via `registerPlugin({ slots: { 'slot-name': Component } })`.

| Slot                  | Where it renders                                         |
| --------------------- | -------------------------------------------------------- |
| `asset-preview`       | Asset card previews on the Assets page                   |
| `asset-detail-modal`  | Asset detail modal                                       |
| `task-assets`         | Task drawer, asset attachments section                   |
| `task-sidebar`        | Task drawer sidebar (custom panels for a plugin's tasks) |
| `home-widget`         | Dashboard home widget grid                               |
| `page:/<route>`       | Full-page mount at `<route>`                             |

## Sub-path imports

The `exports` map covers these sub-paths:

| Import path              | What it exposes                              |
| ------------------------ | -------------------------------------------- |
| `@bakin/sdk`             | `registerPlugin`, top-level re-exports       |
| `@bakin/sdk/ui`          | Base UI components (buttons, cards, inputs)  |
| `@bakin/sdk/hooks`       | Shared React hooks (useQueryState, useDebug) |
| `@bakin/sdk/components`  | Higher-level shell components                |
| `@bakin/sdk/slots`       | Slot runtime + provider                      |
| `@bakin/sdk/types`       | TypeScript types (`BakinPlugin`, `PluginContext`, etc.) |
| `@bakin/sdk/utils`       | Shared utilities                             |

## Repository

This package is developed alongside Bakin in the
[markhayden/bakin](https://github.com/markhayden/bakin) monorepo, under
`packages/sdk`. File issues and PRs on the main repository.

## License

MIT © madeinwyo
