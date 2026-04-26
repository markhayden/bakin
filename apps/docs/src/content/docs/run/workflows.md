---
title: Workflows
description: Use Bakin workflows to coordinate multi-step work, gates, and structured agent handoffs.
---

# Workflows

Workflows coordinate multi-step work around a task. They can define steps, gates, expected outputs, notifications, and handoffs between agents or people.

## Common Commands

```sh
bakin workflows list
bakin workflows start task-123 default
bakin workflows step task-123
bakin workflows submit task-123 step-1 '{"ok":true}'
```

## Operator Notes

- Use workflows when work needs repeatable structure.
- Use gates for human approval or review points.
- Use structured output where downstream steps depend on predictable data.
- Keep workflow definitions small enough that operators can understand failure state quickly.

## Reference

- [CLI Reference](/reference/generated/cli/)
- [Hook Reference](/reference/generated/hooks/)
