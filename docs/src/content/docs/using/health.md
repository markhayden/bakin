---
title: Health
description: "Find what needs attention, verify Search, repair known issues, and inspect agent and system activity."
---

Health is the operator view for one question: **what needs my attention right now?** It combines diagnostic evidence with live runtime facts, then keeps detailed usage and subsystem inventory one click away.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-health--dashboard.webp" alt="Health Overview showing overall status, Search readiness stages, actionable incidents, and current runtime facts." loading="lazy">
</figure>

## Start with Overview

Overview is ordered for triage:

1. **Overall health** states whether required evidence is healthy, needs attention, degraded, or cannot currently be verified.
2. **Search readiness** is always visible near the top. Engine, Queries, Indexes, and Journal are evaluated separately so a green process check cannot hide a broken query or indexing path.
3. **Needs action** contains known problems with a concrete operator action.
4. **Unable to verify** contains missing, failed, invalid, or stale evidence. Unknown is not treated as healthy.
5. **Watching** contains fresh degraded conditions that may resolve without intervention.
6. **Right now** shows live dispatch, connected-session, and recent-failure counts. These faster facts are kept separate from diagnostic evidence.

If everything is healthy, Health says so explicitly instead of replacing the page with an empty list.

### Status and freshness

<div class="table-light-full table-label-wrap">

| State | Meaning | What to do |
| --- | --- | --- |
| **Healthy** | Required evidence is current and no active incident needs attention. | Nothing. Check the evidence time if you need to know when it was verified. |
| **Needs attention** | A known issue has a concrete operator action. | Open the incident, review its impact, then use the offered repair, navigation, instructions, or re-check action. |
| **Watching** | A current degraded condition is worth monitoring but does not yet require intervention. | Review its evidence; intervene only if the condition persists or escalates. |
| **Unable to verify** | Required evidence is missing, invalid, failed, or stale. | Run checks. Do not assume the last known state is still true. |

</div>

Health keeps the latest valid snapshot when a later check cannot run, but labels it **Last known**. The evidence disclosure shows when the observation was checked, when it was observed, and whether it came from the current or retained snapshot.

Use **Run checks** to request a fresh full sweep. Background refreshes preserve the last usable evidence and never turn a refresh failure into a false healthy state.

## Search readiness

Search has four user-visible stages:

<div class="table-light-full table-label-wrap">

| Stage | What it verifies |
| --- | --- |
| **Engine** | The configured Search engine is enabled, installed, and reachable. |
| **Queries** | A real end-to-end query path answers correctly. |
| **Indexes** | Registered indexes and any blue/green migrations are usable. |
| **Journal** | Pending writes are draining and quarantined writes are visible. |

</div>

Overview answers whether Search is ready. Open **System** for index document counts, migrations, journal backlog, enrichment coverage, and explicit reindex actions. A non-healthy stage points back to canonical diagnostic evidence, so the overview and technical detail cannot silently disagree.

## Repair an issue

Repairs are explicit and targeted to the incident you selected:

1. Choose **Review repair** on an incident.
2. Review the server-generated plan and the changes each item would make.
3. Safe items may be preselected. Manual or destructive items stay off until you select and confirm each one.
4. Apply the selected items. Health reruns the affected checks and reports **applied** separately from **verified**.

Plans are short-lived and tied to the evidence they were created from. If the affected evidence changes before apply, Health rejects the stale plan without mutating anything and offers to re-plan.

Some incidents provide navigation, resolution steps, or a re-check instead of deterministic repair. Technical evidence is collapsed by default and remains available when you need it.

## Agents

Agents consolidates usage and outcomes around one 24-hour, 7-day, or 30-day window:

- The trend chart includes an exact data table, so values do not depend on hover or color.
- The comparison view distinguishes **observed transcript activity**, **Bakin-attributed work**, and **unattributed activity**. Those scopes are related, not interchangeable.
- Latest-session token traffic is cumulative traffic in each agent's newest transcript, not current context-window occupancy.
- Runtime-reported transcript cost is shown separately from Bakin's fixed 24-hour budget estimate. Missing cost remains unavailable; it is never displayed as `$0`.

Use the Models → Spend link for budget controls and the complete attributed-spend view.

## Activity

Activity is failure-first. Choose a 5-minute, 1-hour, or 24-hour window and optionally narrow it to tools, HTTP requests, or agents.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-health--usage-panel.webp" alt="Health Activity showing failure totals, an accessible failure trend, filters, and recent event details." loading="lazy">
</figure>

Successful routine polling and maintenance are hidden by default so Health does not become its own loudest event source. Enable **Include routine success** when debugging background work. Routine failures are always shown, even when routine success is hidden.

The trend includes an exact bucket table. Event rows lead with a human label and impact; raw names, IDs, timing, metadata, and payload remain in the detail disclosure.

## System

System leads with short subsystem summaries, followed by the detail needed to resolve a problem:

- **Search** — readiness stages, indexes, migrations, journal, enrichment, and validated reindex results.
- **Plugins** — activation failures and available updates before the complete installed inventory.
- **Runtime** — summed connected sessions, uptime, memory, port, process ID, and Node version.
- **Full check inventory** — every registered check, including healthy and not-applicable states, grouped by subsystem. Groups needing review open first.

Wide technical tables scroll inside their cards instead of forcing the whole page wider. At phone widths, close the global Activity panel when you need the full dashboard width; the Health content itself stacks without hiding status or actions.

## Plugin health checks

Plugins and adapters register owner-aware checks using the canonical Health contract. A check returns structured observations with stable keys, affected resources, and optional incidents. Repair actions are registered separately; diagnostic checks never mutate state.

Plugin authors should see [Server contracts](/docs/extending/plugins/server-contracts/#health-checks) for registration, freshness, ownership, validation, and repair examples.

## Settings

<!-- docs:settings health -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Usage history scan interval (minutes) | `number` | `5` | How often session transcripts are swept into durable usage history (1–1,440 minutes) |

</div>
<!-- /docs:settings -->

## From the CLI

<!-- docs:cli-commands health -->
| Command | Purpose |
| --- | --- |
| `bakin status` | Show dispatch and server status. |
| `bakin doctor [--full] [--notify-agent] [--fix\|--delegate] [--yes]` | Run canonical health checks, apply selected repairs, or create a delegated repair task. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#health).

<div class="for-agents">

## For agents

Agents can self-check through MCP exec tools.

<!-- docs:exec-tools health -->
- `bakin_exec_health_doctor`: Return the canonical Health report. Use fresh=true to join or start a full diagnostic sweep first.
- `bakin_exec_health_status`: Get a quick canonical system health summary with uptime, memory, connected session count, activity failures, and incident counts.
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Models](/docs/using/models/): inspect budget-attributed spend and choose models
- [Essentials → System Status](/docs/using/essentials/#system-status): understand the always-visible header status
- [Daily Operation](/docs/start/operation/): start, stop, restart, and update the services Health observes
