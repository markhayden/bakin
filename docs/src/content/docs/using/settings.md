---
title: Settings
description: "Every Bakin knob in one panel. System config, plugin settings, no restart on save."
---

Every knob Bakin gives you, in one panel. System-wide stuff (dispatch, watchdog, alerts) sits in `System & Alerts`. Every plugin that exposes options gets its own tab. Save and it's live; the watchdog re-reads on its next cycle, no restart needed.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-settings--panel.webp" alt="The settings panel, gear icon top-right of the dashboard. Tabs on the left, fields on the right." loading="lazy">
</figure>

## Deep links

Every category has a URL. `/settings?tab=models` opens the Models category and survives a refresh; `/settings` alone is System & Alerts (`?tab=system`), `/settings?tab=channels` is Channels, and `/settings?tab=integrations` is Integrations & Keys. Add `&field=<key>` to land on one setting — `/settings?tab=system&field=dispatch.paused` scrolls to the kill switch and marks it, and `/settings?tab=channels&field=integrations.discord.guildIds` focuses the server list. Health incidents and the Runtime page use these links, so "Open System & Alerts" takes you to the exact knob, not the landing tab.

## System & Alerts

The built-in tab covers the runtime knobs that don't belong to any single plugin. A grab bag of small things, organized by what they affect:

<div class="table-light-full table-label">

| Group | What it controls |
| --- | --- |
| **Dispatch** | How often the dispatch loop fires, retry counts, cooldowns after structural and transient failures, the max number of in-flight dispatches. |
| **Watchdog** | Stuck-task thresholds, auto-recovery toggle, MCP and REST error-rate alerts (window, threshold, sample size, alert cooldown). |
| **Restart recovery** | Whether Bakin repairs stale `inProgress` tasks on server startup before kicking a dispatch cycle. |
| **Models** | Global allowlist and blocklist. Models on the blocklist never get assigned, even by alias or profile. |
| **Doctor** | Diagnostic interval and require-onboard guard so doctor stays quiet on fresh installs. Repairs are explicit through `bakin doctor --fix` or `bakin doctor --delegate`. |
| **Approvals** | Whether a rejection needs a written reason. (Where approvals and alerts are *delivered* lives in the Channels tab.) |
| **Workflow** | Step timeout, redispatch cap, repeat-rejection threshold, agent-scoping and workflow-guard enforcement. |
| **Runtime adapter** | Which runtime adapter is active (today: `openclaw`) and any per-adapter settings. |
| **Search adapter** | Search engine (today: `antfly`), reranker config, default embedders, chunking targets, audit TTL. |
| **SSE** | Max concurrent live-event clients and keep-alive cadence. |

</div>

Most folks never touch these. Defaults are sane. Tweak when you've got a specific reason.

## Channels

Everything about where Bakin can post — in one tab, speaking from one answer. The status header says who owns delivery (the runtime itself, or Bakin's Discord bridge), whether it is enabled, whether a bot token is set and where it came from (the Bakin store or the `DISCORD_BOT_TOKEN` environment variable), and the live connection state. When something is wrong the banner names the cause and the next step: add a token, add a server ID, fix the bot's intents, reconnect.

Below that: the bridge settings (enable, server IDs, approver and inbound allowlists — paste IDs, they do not have to be discovered first), the bot token field (write-only; Set or Clear), the servers and channels the bot can see, and routing — the alert channel, the approvals channel, and named aliases such as `general` that workflows and agents post to. Save and the bridge reconnects on its own; no restart.

Two actions live at the bottom. **Reconnect** converges the bridge on whatever is configured right now. **Verify** probes without posting anything: gateway identity, server membership and guild-level permissions, channel listing, every routing target, and the Health check — each row links to the field that owns it. The same answer backs `bakin channels status`, `bakin channels verify`, `bakin channels reconnect`, the Discord row in Health, and the post tool agents call, so none of them can disagree.

On a runtime that delivers natively (OpenClaw), the tab shows the runtime's own channel list read-only and marks the bridge settings as idle — they are not a problem, the runtime owns delivery.

## Plugin Settings

Every plugin can declare its own settings. When it does, a tab shows up here with the same UI and persistence rules. Look for `Memory`, `Models`, `Tasks`, etc. once those plugins are active. Each plugin's page documents what's behind its tab.

## On disk

Prefer a text editor? Go straight to the JSON. System settings live at `~/.bakin/settings.json`; per-plugin values at `~/.bakin/plugin-settings/<id>.json`. Same rules: live services pick up settings on their next cycle; startup-only settings apply on the next server boot.

## Related

- [Health](/docs/using/health/): see the effects of your settings on error rates, dispatch counts, and doctor results.
- [Essentials](/docs/using/essentials/): alerts surface based on the thresholds you configure here.
