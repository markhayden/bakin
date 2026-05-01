---
title: Contribute
description: Contribute to Bakin, run the repo locally, update docs metadata, and prepare documentation changes.
---

Bakin's public docs launch alongside the open-source repository. Contributor docs cover source setup, tests, docs authoring, metadata requirements, examples, and release docs.

## Development Setup

End-user install uses the released binary. Contributor setup uses the source tree.

```sh
bun install
bun run dev
```

Run the core checks before opening a pull request:

```sh
bun run typecheck
bun test --isolate
bun run docs:check
```

For extension-specific work, start with [Extending: Development Workflow](/docs/extending/development-workflow/). It covers linked plugin installs, agent package installs, generated docs, and contract review.

## Docs Rules

- Public surfaces need metadata and examples.
- Generated human-readable docs are committed.
- Volatile intermediate inventories are not committed.
- Non-trivial examples live in external snippet fixtures.
- Broken docs examples fail CI.
- Extension docs should link to generated references instead of copying long schemas by hand.

## Documentation Workflow

Use the generator whenever touching CLI, API, SDK, hook, exec tool, settings, runtime path, or plugin metadata:

```sh
bun run docs:generate
bun run docs:check
```

Docs live in `docs`. Internal coding-agent helper material belongs in `.claude/knowledge`, not public docs.

## Review Expectations

Good PRs keep behavior, metadata, tests, and docs together. If a change adds or renames a CLI command, route, hook, exec tool, SDK export, setting, plugin contribution, or agent package field, update the generated docs in the same PR.

Use targeted tests while iterating, then run the full check set before review unless the PR clearly documents why a check could not run.

## Source Links

User and reference docs link to release-tag source. Contributor docs may link to `main` when describing current development.
