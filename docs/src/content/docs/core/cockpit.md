---
title: Cockpit
description: "The always-on header controls: debug mode, alerts, status indicator, and live activity feed."
---

Bakin's header is your cockpit. It carries the controls and indicators you'd want one click away, no matter which plugin you're inside.

## What's up there

<figure class="screenshot-frame">
  <figcaption>The Bakin header showing the status indicator, alerts, debug toggle, and live activity drawer.</figcaption>
</figure>

The header stays fixed across every view. Left side shows your current plugin context. Right side carries the system-level controls.

## Status indicator

A live dot showing whether Bakin is healthy. Green is what you want. Click for a quick rollup, or jump to [Health](/docs/core/health/) for the full picture.

## Alerts

Notification surface for anything Bakin wants to flag: failed dispatch retries, blocked tasks waiting on you, watchdog-detected drift. Click an alert to jump to whatever it's about.

## Debug mode

Toggle it from the bug icon, or hit `?debug=true` in the URL once. When on, you get extra context across the app: payload dumps, internal IDs, raw timings, plugin slot boundaries. Off by default. State persists in localStorage so you don't have to flip it every visit.

## Live activity

A drawer that streams every agent action as it happens. Task moves, log entries, dispatch events, MCP tool calls. Useful when you want to watch agents work in real time without refreshing anything.

## Related

- [Health](/docs/core/health/): the deeper diagnostics behind the status dot
- [Memory](/docs/core/memory/): the searchable history view of activity
- [Settings](/docs/core/settings/): configure alert thresholds and runtime knobs
