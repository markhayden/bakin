---
title: Quality Control
description: Keep Bakin extensions reviewable, source-backed, tested, and easy for future authors to maintain.
---

Good contributions make the next author faster. The code should work, but the shape around it matters just as much: names stay stable, public contracts are documented, examples are checked, and reviewers can see what changed without spelunking.

## Review Standard

A plugin, agent kit, or core change is ready when someone else can inspect it, install it, and maintain it without guessing.

Before you share it:

- Keep behavior, metadata, tests, and docs in the same change.
- Make IDs, route paths, command names, tool names, and package IDs stable.
- Keep permissions narrow enough to explain in one sentence.
- Put durable behavior where it belongs: plugin code for app functionality, skills and workflows for repeatable work, lesson blocks for agent context.
- Clean up timers, sockets, watchers, EventSources, subscriptions, and background work in `onShutdown()`.
- Avoid imports from host internals, another plugin's files, or repo paths that are not part of the supported SDK surface.

## Public Contracts

If a change adds or renames a public surface, update the contract next to it.

<div class="table-light-full table-label-wrap">

| Surface | Update |
| --- | --- |
| CLI command | Metadata in `src/core/cli/registry.ts` |
| API route | Declarative route metadata or `contributes.apiRoutes` |
| Hook | Metadata where the hook is registered |
| MCP tool | Tool description, parameter schema, and manifest contribution |
| Setting | Settings schema, summary, and generated docs |
| SDK export | Public export, TSDoc, and generated SDK reference |
| SDK UI contract | Public catalog story, interaction/a11y coverage, responsive states, and SDK-only imports |
| Plugin manifest field | Parser, fixture, docs, and generated snippets |
| Agent kit field | Package schema, fixture, docs, and install behavior |

</div>

Then regenerate and check:

```sh
bun run docs:generate
bun run docs:check
```

Generated docs live under `docs/src/content/docs/reference/generated` and `docs/public/llms`. Generated blocks inside guide pages use `docs:*` markers. `bun run docs:check` also builds and validates the public SDK component catalog under `/docs/ui/`; it fails when generated content, route contracts, public-story boundaries, or the combined artifact drift.

## Examples

Examples should either be real fixtures or clearly illustrative.

Use `docs/snippets` when a guide shows a runnable file. `bun run docs:check` verifies those snippet blocks stay in sync, JSON fences parse, `bakin` shell commands point at real CLI commands, generated blocks are current, route metadata is valid, and the docs site builds.

If an example is intentionally small or conceptual, keep it honest. Do not imply it is a complete plugin, agent kit, or workflow when it is only showing the shape.

## Docs Boundaries

Public docs should teach users, plugin authors, and agent kit authors how to work with supported surfaces. Internal helper material for coding agents belongs outside public docs.

Use public docs for:

- installable behavior
- supported SDK and manifest contracts
- workflows users can repeat
- reference material generated from source

Keep out of public docs:

- volatile inventories that change while developing
- private planning notes
- coding-agent helper material
- unreleased implementation details that are not a supported contract

## Source Links

User and reference docs should link to release-tag source when they point at code. Maintainer-facing or contributor-facing docs may link to `main` when they are describing active development.

When the public docs and generated reference disagree, trust the source contract, fix the docs, and regenerate.
