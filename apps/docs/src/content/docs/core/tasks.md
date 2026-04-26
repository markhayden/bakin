---
title: Tasks
description: Use Bakin tasks to create, assign, move, block, log, and complete agent work.
---

Tasks are the core work unit in Bakin. A task records what needs to happen, who owns it, what column it is in, and the activity that led to completion.

## Common Commands

```sh
bakin tasks list
bakin tasks create "Fix the docs" patch
bakin tasks move task-123 done
bakin tasks log task-123 "Updated the generated reference"
bakin tasks block task-123 "Waiting on review"
bakin tasks complete task-123 "Published the docs update"
```

## Operator Notes

- Use tasks for work that should be visible, assignable, and auditable.
- Use logs for progress that should survive outside chat history.
- Use blocked state when an agent needs human input or another dependency.
- Use completion summaries to make later review and memory search useful.

## Reference

- [CLI Reference](/reference/generated/cli/)
- [Core Plugin Catalog](/reference/generated/core-plugins/)
