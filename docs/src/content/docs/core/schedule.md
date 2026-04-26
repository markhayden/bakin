---
title: Schedule
description: Use Bakin schedule jobs to trigger recurring prompts or agent work.
---

Scheduled jobs let Bakin trigger recurring work. Jobs can be listed, created, paused, resumed, removed, run immediately, and inspected through run history.

## Common Commands

<!-- docs:cli-commands schedule -->
| Command | Purpose |
| --- | --- |
| `bakin schedule [list|add|pause|resume|remove|run|runs] ...` | Manage scheduled jobs. |
<!-- /docs:cli-commands -->

## Operator Notes

- Use schedules for routine work that should not depend on a person remembering it.
- Pause jobs instead of deleting them when the cadence is temporarily wrong.
- Check run history when scheduled work appears stale or duplicated.

## Reference

- [CLI Reference](/docs/reference/generated/cli/)
