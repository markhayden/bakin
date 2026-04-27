---
title: Health
description: Use Bakin health checks and doctor diagnostics to inspect system readiness and recoverable problems.
---

Health checks show whether Bakin, OpenClaw, plugins, dependencies, search, and runtime services are operating as expected.

## Common Commands

<!-- docs:cli-commands health -->
| Command | Purpose |
| --- | --- |
| `bakin doctor` | Run health checks. |
| `bakin status` | Show dispatch and server status. |
<!-- /docs:cli-commands -->

## Operator Notes

- Run `bakin doctor` after install, update, or plugin changes.
- Treat warnings as degraded capability, not necessarily failure.
- Review health output before debugging individual plugins.
- Plugin health checks should be isolated so one bad plugin does not crash the sweep.

## Architecture

Every doctor check is plugin-registered via `ctx.registerHealthCheck`. The doctor cron in `src/core/doctor.ts` is just an orchestrator: it iterates the registry, runs every registered check in parallel with per-check try/catch isolation, summarizes the results, audits the run, and escalates unfixable issues to the main agent.

Plugin-owned checks ship with their owner plugin (`plugins/{owner}/lib/health-checks.ts`). System-level checks — content directory, OpenClaw gateway, Antfly daemon, mcporter config, LaunchAgent plist, managed-block sync, and so on — live under the health plugin at `plugins/health/lib/system-checks/`.

A check function returns one or more `HealthCheckResult` rows: `{ check, status, message, autoFixable }`. `status` is one of `'ok' | 'warn' | 'error' | 'fixed'`. Rows surface in the Health dashboard and the `bakin doctor` CLI output.

Plugin authors who want to add a new check: see the [Server Contracts → Health Checks](/docs/extend/plugins/server-contracts/#health-checks) section.

## Reference

- [CLI Reference](/docs/reference/generated/cli/)
- [Settings Reference](/docs/reference/generated/settings/)
