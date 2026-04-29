---
title: Health
description: "Live dashboard over Bakin's runtime: server stats, MCP sessions, doctor diagnostics, search index, and per-tool usage."
---

Health is the single pane that tells you whether everything's working. Server stats, active MCP sessions, doctor diagnostics, search engine state, plugin registry, and live usage feeds for every tool, endpoint, and agent. Pluggable so any plugin can register its own health check.

## The health view

<figure class="screenshot-frame">
  <figcaption>The health page with server stats on top, MCP sessions, doctor results, search engine status, and the usage tabs at the bottom.</figcaption>
</figure>

Sections from top to bottom:

- **Server stats** — port, pid, memory, uptime.
- **MCP sessions** — active agent connections and what they're doing.
- **Doctor diagnostics** — cached results from the last doctor sweep, refreshable.
- **Antfly health** — search engine status and per-table row counts.
- **Plugin registry** — every plugin loaded, with route counts.
- **Usage** — three tabs for tool, endpoint, and agent usage.

## Usage tabs

<figure class="screenshot-frame">
  <figcaption>The usage panel with three tabs (Tool / Endpoint / Agent), windowed to 5m, 1h, or 24h.</figcaption>
</figure>

Single in-memory recorder feeds all three tabs. Every MCP exec tool call, every REST endpoint hit, every agent dispatch lands in one place and gets aggregated.

- **Tool Usage** — by exec tool name, count + error rate per window.
- **Endpoint Usage** — by REST path, count + error rate.
- **Agent Usage** — by agent id, calls + errors per window.

Filter windows: 5 minutes, 1 hour, 24 hours.

## Doctor

`bakin doctor` runs the full diagnostic sweep — agent roster, skill sync, gateway, taskboard, assets, plugin assets, agent assets. Results cache for 30 minutes; the dashboard polls every ~10 seconds but reads from cache so re-running is cheap. Force a fresh sweep from the refresh button or by running `bakin doctor` from the CLI.

## Pluggable health checks

Any plugin can register a health check that surfaces in the dashboard. Plugins register through the health-check registry; Health then renders the result alongside the built-in checks. Useful for any plugin that owns external state (a job queue, an external API, a database).

## Concepts

- **Single source of usage truth.** All MCP/REST/agent stats flow through one in-memory recorder. There is intentionally no parallel stat system.
- **Doctor results are cached.** Live polling reads from cache. Refresh forces a re-run.
- **Read-only.** Health writes nothing. It surfaces everything other plugins and core systems already track.

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Health surfaces through the diagnostic CLI:

<!-- docs:cli-commands health -->
| Command | Purpose |
| --- | --- |
| `bakin doctor` | Run health checks. |
| `bakin status` | Show dispatch and server status. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents can self-check via MCP exec tools.

<!-- docs:exec-tools health -->
- `bakin_exec_health_doctor`: Run system diagnostics (agent roster, skill sync, runtime, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.
- `bakin_exec_health_status`: Get a quick system health summary — uptime, memory, active MCP sessions, and doctor error/warning counts. Useful for checking system state before starting work.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Essentials → System Status](/docs/using/essentials/#system-status): the always-on dot in the header is backed by these checks
- [Daily Operation](/docs/start/operation/): start, stop, restart, update — all the lifecycle commands that affect health
- [Settings](/docs/using/settings/): alert thresholds and dispatch cadence
