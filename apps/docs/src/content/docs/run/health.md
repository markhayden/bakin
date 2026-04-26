---
title: Health
description: Use Bakin health checks and doctor diagnostics to inspect system readiness and recoverable problems.
---

# Health

Health checks show whether Bakin, OpenClaw, plugins, dependencies, search, and runtime services are operating as expected.

## Common Commands

```sh
bakin doctor
bakin status
```

## Operator Notes

- Run `bakin doctor` after install, update, or plugin changes.
- Treat warnings as degraded capability, not necessarily failure.
- Review health output before debugging individual plugins.
- Plugin health checks should be isolated so one bad plugin does not crash the sweep.

## Reference

- [CLI Reference](/reference/generated/cli/)
- [Settings Reference](/reference/generated/settings/)
