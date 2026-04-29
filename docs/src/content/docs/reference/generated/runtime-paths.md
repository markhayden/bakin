---
title: Runtime Paths
description: Reference for Bakin runtime files under the resolved Bakin home directory.
---

Docs version: Bakin 1.0.0

This page documents the well-known paths returned by `getBakinPaths()` in `packages/core/src/content-dir.ts`.

Resolution order:

1. `BAKIN_HOME` environment variable.
2. `~/.bakin/`.

| Key | Purpose |
| --- | --- |
| `home` | Resolved Bakin home/content directory. |
| `settings` | Runtime settings JSON file. |
| `memoryLog` | Bakin memory log markdown file. |
| `audit` | Append-only audit log. |
| `logs` | Server and runtime log directory. |
| `assets` | Asset plugin root. |
| `assets.store` | Month-sharded asset storage. |
| `assets.inbox` | Asset ingestion inbox. |
| `assets.trash` | Soft-deleted assets. |
| `agents` | Agent UI/runtime assets. |
| `team` | Team plugin runtime data. |
| `personas` | Agent persona files. |
| `heartbeats` | Agent heartbeat files. |
| `inbox` | General inbox directory. |
| `tasks` | Bakin-owned task metadata store. |
| `workflows` | Workflow definitions, skills, and instances. |
