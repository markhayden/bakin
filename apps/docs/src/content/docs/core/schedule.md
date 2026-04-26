---
title: Schedule
description: Use Bakin schedule jobs to trigger recurring prompts or agent work.
---

Scheduled jobs let Bakin trigger recurring work. Jobs can be listed, created, paused, resumed, removed, run immediately, and inspected through run history.

## Common Commands

```sh
bakin schedule list
bakin schedule add "Weekly review" "0 9 * * MON" --agent patch --prompt "Review open work"
bakin schedule pause job-123
bakin schedule resume job-123
bakin schedule run job-123
bakin schedule runs job-123
```

## Operator Notes

- Use schedules for routine work that should not depend on a person remembering it.
- Pause jobs instead of deleting them when the cadence is temporarily wrong.
- Check run history when scheduled work appears stale or duplicated.

## Reference

- [CLI Reference](/reference/generated/cli/)
