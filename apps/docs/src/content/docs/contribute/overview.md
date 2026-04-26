---
title: Contribute
description: Contribute to Bakin, run the repo locally, update docs metadata, and prepare documentation changes.
---

# Contribute

Bakin's public docs launch alongside the open-source repository. Contributor docs cover source setup, tests, docs authoring, metadata requirements, examples, and release docs.

## Development Setup

End-user install uses the released binary. Contributor setup uses the source tree.

```sh
bun install
bun run dev
```

## Docs Rules

- Public surfaces need metadata and examples.
- Generated human-readable docs are committed.
- Volatile intermediate inventories are not committed.
- Non-trivial examples live in external snippet fixtures.
- Broken docs examples fail CI.

## Source Links

User and reference docs link to release-tag source. Contributor docs may link to `main` when describing current development.
