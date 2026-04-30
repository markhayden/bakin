---
title: Health
description: "Cost, context, call volume, and diagnostics for every agent. Everything you can't see from the runtime alone."
---

What's each agent costing you? Which tool got hammered today? Whose context window is about to wrap? Whose dispatches are silently failing? Your runtime keeps the receipts but it doesn't read them back to you. This dashboard does.

Live token counts, session costs, MCP and REST volumes, error rates, plugin status, search-engine state, the full diagnostic sweep. Without Bakin you'd be grepping JSONL transcripts to answer any of it.

<figure class="screenshot-frame">
  <figcaption>The health dashboard: cost and context cards, usage tabs, doctor results, system status, all in one feed.</figcaption>
</figure>

## Cost and Context

Two cards anchor the top of the dashboard side by side. They cover the questions that pile up fastest when you've got a roster running: what each agent is costing you, and whose context is about to overflow. Glance at them on the way past, look closer when something looks off.

<figure class="screenshot-frame">
  <figcaption>Context usage on the left (tokens in each agent's latest session), session cost on the right with the day's running total.</figcaption>
</figure>

<div class="table-light-full table-label-wrap">

| Card | What it answers |
| --- | --- |
| **Context Usage** | Total tokens in each agent's latest session, bar-charted. Spot who's pushing the model's window before they hit it. |
| **Session Cost** | Input, output, cache-read, cache-write, and total per agent with the day's running total at the top. Pulled from the runtime's posted rates, directional not invoice-grade. Answers "is Main Operator's day eating my budget?" without making you go ask the gateway. |

</div>

:::tip[Watch the cache-read column]
Cache-read tokens cost a fraction of fresh input tokens. That column tells you whether your agents are getting good cache hits or burning through fresh context every turn.
:::

## Call Volume

Three tabs sit below the cost cards, all feeding from the same in-memory recorder. Same activity, sliced three ways. When something looks off in the system, this is usually the first place you'll see it.

<figure class="screenshot-frame">
  <figcaption>The usage panel: tool, endpoint, and agent tabs, windowed to 5m, 1h, or 24h.</figcaption>
</figure>

<div class="table-light-full table-label-wrap">

| Tab | What it counts |
| --- | --- |
| **Tool Usage** | Every MCP exec tool call, by name (e.g. `bakin_exec_tasks_create`). Count + error rate per window. |
| **Endpoint Usage** | Every REST endpoint hit, by path. Count + error rate. |
| **Agent Usage** | Calls + errors per agent. Quick read on who's busy and who's stuck. |

</div>

:::tip[Window the view]
5 minutes, 1 hour, or 24 hours. Useful for catching: "is the orchestrator looping?", "is this tool error-spiking?", "who's the noisy agent right now?"
:::

## Doctor

A green-light scan of every moving part in the stack. Agent roster, runtime adapter, search adapter, taskboard, assets, channel approvals, the works. Red means broken, yellow means drifting, and most rows have a one-click auto-fix so you don't have to know what went wrong to fix it.

Run it before you start the day or any time something feels off. Results cache so the dashboard reads fast; the refresh button (or `bakin doctor` from the CLI) forces a fresh sweep.

## System Status

Live state of the Bakin process and what it's connected to:

<div class="table-light-full table-label-wrap">

| Section | What's there |
| --- | --- |
| **Server stats** | Port, PID, memory in use, uptime, node version. |
| **MCP sessions** | Agents currently connected, open session count per agent, when they connected. |
| **Plugin registry** | Every plugin loaded, with route count and source (built-in vs user-installed). |
| **Search engine** | Antfly status and row counts per `bakin_*` table. |

</div>

Quick sanity check for "did everything actually start up?"

## Pluggable health checks

Any plugin can register a health check that surfaces here alongside the built-ins. It picks up the same color coding (red / yellow / green) and the same auto-fix scaffolding. If a plugin owns external state worth watching (an API key, a queue, a cache, a daemon), wire a check.

## Settings

<!-- docs:settings health -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Refresh interval (seconds) | `number` | `30` | How often to poll for updated metrics |
| Detailed metrics | `boolean` | `true` | Show per-plugin and per-tool breakdowns |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands health -->
| Command | Purpose |
| --- | --- |
| `bakin status` | Show dispatch and server status. |
| `bakin doctor` | Run health checks. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#plugin-health).

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

- [Models](/docs/using/models/): pick cheaper models for the agents that show up loudest in Cost
- [Essentials → System Status](/docs/using/essentials/#system-status): the always-on dot in the header is backed by these checks
- [Daily Operation](/docs/start/operation/): start, stop, restart, update, the lifecycle commands that affect health
