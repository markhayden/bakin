---
title: Plugin Authoring
description: Build Bakin plugins with manifests, server routes, client pages, slots, hooks, and SDK components.
---

Bakin plugins are source trees with a manifest, a server entry, and a client entry. Core plugins ship with Bakin. Third-party plugin docs are not published on this site, but plugin metadata validation uses the same contract model.

## Quick Start

```sh
bakin plugins scaffold my-plugin
cd my-plugin
bun install
bakin plugins install --dev .
```

Use `--dev` while authoring. It symlinks the local source into Bakin, activates it immediately, and participates in the dev reload loop. Use a normal `bakin plugins install <path|github:user/repo[@ref][#subpath]>` when you want a copied install, and add `--ref <tag|branch|sha>` when you want to pin the git source.

Run Bakin with `bakin dev` while editing linked plugins. Client components, routes, server registrations, hooks, exec tools, and most search wiring rebuild and hot-swap from the linked source tree. Manifest, durable schema, and startup-only contract changes can still require `bakin restart`.

## Tested Example

The minimal server and client entries used by these docs live in `docs/snippets/plugin-basic/` and are typechecked with the repo. Use that fixture as the source of truth for basic plugin shape.

## Build Path

1. Define `bakin-plugin.json`.
2. Implement the server entry and register contracts from `activate(ctx)`.
3. Implement the client entry with `registerPlugin()`.
4. Run the plugin tests and docs checks before publishing.

Use these pages for the details:

- [Plugin Manifest](/docs/extending/plugins/manifest/)
- [Server Contracts](/docs/extending/plugins/server-contracts/)
- [Client UI](/docs/extending/plugins/client-ui/)

## Import Rule

Use SDK imports:

```ts
import { registerPlugin } from '@bakin/sdk'
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'
```

Do not import from host internals or another plugin's internals.

## Public Plugin Contracts

Public plugin routes, hooks, slots, settings, and exec/MCP tools require:

- summary and description
- visibility and stability
- Zod input schemas
- output schemas where practical
- examples
- source path metadata

## For Coding Agents

When writing or modifying a plugin, update the contract metadata in the same change as the runtime behavior. A public surface without docs metadata should fail CI.
