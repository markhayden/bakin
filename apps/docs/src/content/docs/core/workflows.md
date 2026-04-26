---
title: Workflows
description: Use Bakin workflows to coordinate multi-step work, gates, and structured agent handoffs.
---

Workflows coordinate multi-step work around a task. They can define steps, gates, expected outputs, notifications, and handoffs between agents or people.

## Common Commands

<!-- docs:cli-commands workflows -->
| Command | Purpose |
| --- | --- |
| `bakin workflows list` | List workflow definitions. |
| `bakin workflows start <taskId> <workflowId>` | Start a workflow. |
| `bakin workflows step <taskId>` | Get current workflow step. |
| `bakin workflows submit <taskId> <stepId> <json>` | Submit workflow step output. |
<!-- /docs:cli-commands -->

## Operator Notes

- Use workflows when work needs repeatable structure.
- Use gates for human approval or review points.
- Use structured output where downstream steps depend on predictable data.
- Keep workflow definitions small enough that operators can understand failure state quickly.

## Reference

- [CLI Reference](/docs/reference/generated/cli/)
- [Hook Reference](/docs/reference/generated/hooks/)
