---
title: Assets
description: Use Bakin assets to store files, sidecar metadata, inbox items, trash, and task/project attachments.
---

Assets keep files and metadata available to operators, plugins, and agents. The assets plugin manages stored files, sidecars, previews, task links, project links, and trash recovery.

## Asset Areas

- `assets/store`: long-term asset storage.
- `assets/inbox`: ingestion landing area.
- `assets/.trash`: soft-deleted assets.

## Operator Notes

- Attach assets to tasks or projects when they are part of the work context.
- Use sidecar metadata to keep type, summary, tags, and relationship data close to the file.
- Use trash restore when a deleted asset still falls inside the soft-delete window.

## Reference

- [Runtime Paths](/docs/reference/generated/runtime-paths/)
- [Exec and MCP Tool Reference](/docs/reference/generated/exec-tools/)
