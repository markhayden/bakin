---
title: Plugin Authoring
description: Build Bakin plugins with manifests, server routes, client pages, slots, hooks, and SDK components.
---

# Plugin Authoring

Bakin plugins are source trees with a manifest, a server entry, and a client entry. Core plugins ship with Bakin. Third-party plugin docs are not published on this site, but plugin metadata validation uses the same contract model.

## Quick Start

```sh
bakin plugins scaffold my-plugin
cd my-plugin
bun install
bakin plugins install .
```

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
