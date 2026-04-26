---
title: Tasks
description: Use Bakin tasks to create, assign, move, block, log, and complete agent work.
---

Tasks are the core work unit in Bakin. A task records what needs to happen, who owns it, what column it is in, and the activity that led to completion.

## Common Commands

<!-- docs:cli-commands tasks -->
| Command | Purpose |
| --- | --- |
| `bakin tasks list [--column=<column>]` | List tasks. |
| `bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow=<reason>]` | Create a task. |
| `bakin tasks move <id> <column>` | Move a task. |
| `bakin tasks log <id> <message>` | Log task progress. |
| `bakin tasks block <id> <reason>` | Block a task. |
| `bakin tasks depend <id> <dependsOn>` | Register a task dependency. |
| `bakin tasks complete <id> <summary>` | Complete a task. |
<!-- /docs:cli-commands -->

## Operator Notes

- Use tasks for work that should be visible, assignable, and auditable.
- Use logs for progress that should survive outside chat history.
- Use blocked state when an agent needs human input or another dependency.
- Use completion summaries to make later review and memory search useful.

## Reference

- [CLI Reference](/docs/reference/generated/cli/)
- [Core Plugin Catalog](/docs/reference/generated/core-plugins/)
