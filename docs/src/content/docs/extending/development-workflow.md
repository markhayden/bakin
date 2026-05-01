---
title: Bakin' Core
description: Set up the Bakin source tree, choose a contribution path, run checks, and keep docs and contracts in sync.
---

This page is for people changing Bakin or authoring extensions from the repo. End-user install uses the released binary. Contributor work uses the source tree, local plugin installs, and the docs generator.

## Source Setup

```sh
bun install
bun run dev
```

The dev server builds the host, watches linked plugins, and runs the local Bakin app. Use `BAKIN_URL` only when a CLI command should talk to a server somewhere other than `http://localhost:3737`.

## Choose a Loop

<div class="table-light-full table-label-wrap">

| Work | Local loop |
| --- | --- |
| Core app or core plugin change | `bun run dev`, then test the app and targeted `bun test --isolate ...` files |
| External plugin | `bakin plugins scaffold my-plugin`, then `bakin plugins install --dev ./my-plugin` |
| Plugin lifecycle or installer change | targeted lifecycle tests under `tests/plugins/lifecycle` plus docs checks |
| Agent package change | `bakin agents install <path> --install-as <id>` against a disposable local runtime |
| Docs-only change | `bun run docs:check` |

</div>

Use `bakin plugins install --dev <path>` for plugin authoring. It symlinks the source into `~/.bakin/plugins/<id>` and participates in the dev reload loop. A normal `bakin plugins install <path|github:user/repo[@ref][#subpath]>` copies the plugin for installed use.

## What to Update Together

Public contracts move as a set. If behavior changes, update the contract next to it:

- CLI metadata in `src/core/cli/registry.ts`
- route metadata on declarative routes or manifest `contributes.apiRoutes`
- hook metadata where `ctx.hooks.register()` is called
- exec tool descriptions and schemas where `ctx.registerExecTool()` is called
- plugin manifest `permissions`, `runtimeCapabilities`, and `contributes`
- SDK export docs and TSDoc when adding an SDK surface
- snippet fixtures under `docs/snippets` when a guide shows runnable code
- shared docs tables that are generated from source, such as plugin permissions

Then regenerate:

```sh
bun run docs:generate
bun run docs:check
```

Generated pages live under `docs/src/content/docs/reference/generated` and `docs/public/llms`. Generated blocks inside guide pages use `docs:*` markers and are checked for drift by `bun run docs:check`. Commit them when they change.

## Check Before PR

Run the smallest targeted tests while editing, then the repo checks before review:

```sh
bun run typecheck
bun test --isolate
bun run docs:check
```

For a narrow plugin or docs change, targeted tests are fine while iterating. Before merging, the full checks should pass or the PR should explain the known gap.

## Contribution Shape

Good Bakin contributions are boring in the places that matter:

- stable IDs and route paths
- narrow permissions
- explicit cleanup in `onShutdown()` for timers, sockets, watchers, and subscriptions
- no top-level lifetime side effects in plugins
- no imports from `packages/host`, `src`, or another plugin from extension code
- examples that are either tested fixtures or marked illustrative with a reason

When the public docs and generated reference disagree, trust the source contract, fix the docs, and regenerate.

## Related

- [Contribute](/docs/contribute/overview/): repo-wide contribution basics
- [Plugins](/docs/extending/plugins/overview/): plugin build path
- [Agent Kits](/docs/extending/agents/overview/): agent kit build path
- [Reference](/docs/reference/generated/coverage/): generated documentation coverage
