---
title: Settings
description: "Every Bakin knob in one panel. System config, plugin settings, no restart on save."
---

Every knob Bakin gives you, in one panel. System-wide stuff (dispatch, watchdog, alerts) sits in `System & Alerts`. Every plugin that exposes options gets its own tab. Save and it's live; the watchdog re-reads on its next cycle, no restart needed.

<figure class="screenshot-frame">
  <figcaption>The settings panel, gear icon top-right of the dashboard. Tabs on the left, fields on the right.</figcaption>
</figure>

## System & Alerts

The built-in tab covers the runtime knobs that don't belong to any single plugin. A grab bag of small things, organized by what they affect:

<div class="table-light-full table-label">

| Group | What it controls |
| --- | --- |
| **Dispatch** | How often the dispatch loop fires, retry counts, cooldowns after structural and transient failures, the max number of in-flight dispatches. |
| **Watchdog** | Stuck-task thresholds, auto-recovery toggle, MCP and REST error-rate alerts (window, threshold, sample size, alert cooldown). |
| **Models** | Global allowlist and blocklist. Models on the blocklist never get assigned, even by alias or profile. |
| **Doctor** | Diagnostic interval, auto-fix toggle for skill drift, require-onboard guard so doctor stays quiet on fresh installs. |
| **Notifications** | Default notification channel and gate-alert toggle. |
| **Workflow** | Step timeout, redispatch cap, repeat-rejection threshold, agent-scoping and workflow-guard enforcement. |
| **Runtime adapter** | Which runtime adapter is active (today: `openclaw`) and any per-adapter settings. |
| **Search adapter** | Search engine (today: `antfly`), reranker config, default embedders, chunking targets, audit TTL. |
| **SSE** | Max concurrent live-event clients and keep-alive cadence. |

</div>

Most folks never touch these. Defaults are sane. Tweak when you've got a specific reason.

## Plugin Settings

Every plugin can declare its own settings. When it does, a tab shows up here with the same UI and persistence rules. Look for `Memory`, `Models`, `Tasks`, etc. once those plugins are active. Each plugin's page documents what's behind its tab.

## On disk

Prefer a text editor? Go straight to the JSON. System settings live at `~/.bakin/settings.json`; per-plugin values at `~/.bakin/plugin-settings/<id>.json`. Same rules: the watchdog picks up changes within one cycle, no restart needed.

## Related

- [Health](/docs/using/health/): see the effects of your settings on error rates, dispatch counts, and doctor results.
- [Essentials](/docs/using/essentials/): alerts surface based on the thresholds you configure here.
