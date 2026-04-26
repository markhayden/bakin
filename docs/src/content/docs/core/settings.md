---
title: Settings
description: Configure system behavior, alerts, and per-plugin options from one place.
---

Settings is where Bakin's knobs live. System-wide config (dispatch, watchdog, alerts) plus a tab for every installed plugin that wants to expose options.

## Where to find it

<figure class="screenshot-frame">
  <figcaption>Settings view with the System &amp; Alerts tab open.</figcaption>
</figure>

Click the gear icon in the top right of the dashboard. Each tab on the left edits its own slice of `~/.bakin/settings.json` (system) or `~/.bakin/plugin-settings/<id>.json` (per plugin).

## System &amp; Alerts

The built-in tab covers the runtime knobs that don't belong to any single plugin: dispatch retries, watchdog cadence, alert thresholds, search engine wiring. Edits hit `/api/settings` and the watchdog re-reads on the next cycle, so changes apply without a restart.

## Per-plugin settings

Every plugin can declare a `settingsSchema`. When it does, Bakin renders a tab for it here automatically. Same UI, same persistence rules, scoped to that plugin's settings file.

## Editing on disk

You can edit `~/.bakin/settings.json` directly if you prefer. Same rules apply: changes are picked up by the watchdog within one cycle, no restart needed.

## Related

- [Health](/docs/core/health/): see the effects of your settings on system status
- [Cockpit](/docs/core/cockpit/): alerts surface based on the thresholds you configure here
