---
title: Essentials
description: "How Bakin extensions install as bundles, and the always-on shell that wraps every view."
---

Every Bakin' instance gets two slices. The first is the shell: navigation, live activity, dispatch, and debugging, always on and always watching. The second is what makes your Bakin' yours: plugins that extend your capabilities and agents that extend your team. Either way, they install as kits: portable bundles with workflows, guardrails, settings, and more.

## Bundles

Bakin ships with key capabilities auto-bundled. The plugins documented in the rest of this section come baked in. Add more whenever you need to, through three paths:

- **Officially supported** kits maintained by the Bakin team
- **Community contributed** kits from other Bakin users
- **Bespoke** kits you build yourself

Whichever path, kits install the same way. Inside, they can carry workflows, settings, skills, lessons bombs, assets, and any other content the extension needs to plug in cleanly.

### Plugins

Plugins extend Bakin. A plugin can ship pages, API endpoints, MCP tools agents can call, hooks other plugins can wire into, settings, and data shapes. Most ship a subset; plenty are pure backend with no UI at all. Every page in this section is a plugin. User plugins install into the running server when possible and otherwise activate on the next start.

```sh
bakin plugins list                               # what's installed
bakin plugins install <path|github:user/repo>    # add one
bakin plugins export plugins.json                # back up user plugins
bakin plugins import plugins.json --yes          # restore user plugins
bakin plugins upgrade <id>                       # pull the latest
bakin plugins remove <id>                        # uninstall
bakin plugins restore <id> --list                # list uninstall snapshots
bakin plugins restore <id>                       # restore latest snapshot
```

Core plugins ship with Bakin and can't be removed. Everything else is fair game. [Build your own](/docs/extending/plugins/overview/) or install one from the community.

### Agents

Where plugins ship code, agent kits ship the content that makes an agent an agent: identity, skills, workflows, lessons bombs. Once installed, Bakin projects the kit into your runtime's home directory and registers the agent in its lockfile. From there it picks up task assignments, calls MCP tools, and reports results like any other team member.

Most tools call a markdown file an "agent." Bakin's are hired, not prompted.

```sh
bakin agents list                                     # what's installed
bakin agents install <path|github:user/repo[@ref][#subpath]>    # add one
bakin agents update <agent-id>                        # pull the latest
bakin agents remove <agent-id>                        # uninstall
```

Agent kits are projected, not copied. The runtime home directory stays the source of truth for agent state. [Build your own kit](/docs/extending/agents/overview/) or grab one from the community to make Bakin yours.

## Activity Feed

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-essentials--activity-drawer.webp" alt="The live activity drawer streaming real-time agent events." loading="lazy">
</figure>

This is the heart and soul of observability. The activity feed streams every agent action (turn) in real time: task moves, dispatch events, retries, recoveries, completions, the exact moment work gets stuck. No black box. No secrets. You see what your agent army is up to, and what it isn't, while it's happening.

Toggle from the header to open the panel. For us, this baby is always open.

<div class="heading-with-chip">

## Search

<a href="https://antfly.io/?ref=makinbakin.com" target="_blank" rel="noopener noreferrer" class="powered-by-chip"><svg width="12" height="12" viewBox="0 0 40 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M39.2842 28.0677C39.2842 34.2626 34.2623 39.2845 28.0674 39.2845H6.10853C5.37819 39.2845 5.01243 38.4015 5.52886 37.885L11.0896 32.3243H28.0674C30.4183 32.3243 32.324 30.4186 32.324 28.0677V11.0898L37.8847 5.5291C38.4012 5.01267 39.2842 5.37843 39.2842 6.10877V28.0677Z"/><path d="M27.2721 24.5018C27.2698 25.2127 26.4103 25.5671 25.9076 25.0645L21.1775 20.3344C20.8653 20.0223 20.8653 19.5162 21.1775 19.2041L25.9377 14.4438C26.4421 13.9395 27.3044 14.2983 27.3022 15.0116L27.2721 24.5018Z"/><path d="M28.3149 6.96011H11.2167C8.86587 6.96012 6.96011 8.86587 6.9601 11.2167V28.3149L1.39945 33.8755C0.883015 34.392 0 34.0262 0 33.2958V11.2167C4.48304e-06 5.02189 5.02189 9.39218e-06 11.2167 0H33.2958C34.0262 0 34.3919 0.883017 33.8755 1.39945L28.3149 6.96011Z"/><path d="M11.8783 15.1175C11.8806 14.4067 12.7401 14.0522 13.2428 14.5549L17.8625 19.1746C18.1747 19.4867 18.1747 19.9928 17.8625 20.3049L13.2134 24.9541C12.709 25.4584 11.8467 25.0996 11.8489 24.3863L11.8783 15.1175Z"/></svg><span>Powered by Antfly</span></a>

</div>

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-essentials--search-results.webp" alt="The search bar with full-text and semantic results across tasks, projects, memory, and assets." loading="lazy">
</figure>

Not your ordinary search. Think of it as brain connectivity for your whole agent team. Every fact, artifact, and result findable the moment it exists. Full-text, semantic, vector, BM25, hybrid (text + meaning), multimodal for images and assets. Cross-table by default, so a single query can reach across tasks, projects, assets, memory, audit logs, every research note, every shipped asset.

This is how knowledge compounds. Each completed task, every retrieved citation, every asset feeds the corpus your agents pull from on the next job. You search by name. Your agents search by meaning. Build the knowledge base. Tackle the world.

Press **⌘K** (or the header search button) anywhere in the dashboard for the global search overlay: one query returns grouped results across every content type — assets with thumbnails, tasks, memory, workflows, agents — with type filters, keyboard navigation, and deep links. With Debug mode on, every hit shows its per-leg relevance scores. Rebuilds run blue/green (`bakin reindex`) — search stays available while a table rebuilds; if the engine itself is down, search says so honestly instead of degrading silently.

```sh
bakin search <query>      # search indexed content
bakin search:stats        # show index health
bakin reindex             # reindex content
bakin install search      # install or repair the configured search adapter
```

Search runs through Bakin's configured search adapter. If the adapter or its model dependencies are missing when you run `bakin onboard`, onboarding offers to install or repair them after confirmation. Without a healthy search adapter, search is disabled. Bakin itself keeps working normally.

## Navigation

This is the main menu. All apps have one, but this one is ours. Self-explanatory: if a plugin adds UI, you'll see it here.

## Dispatch Ticker

Dispatch ensures queued work gets picked up by the right agent. Tasks pile up in a queue as they're created. Every dispatch cycle, Bakin scans the queue, picks out anything ready to run, and routes each task to its assigned agent through the runtime. The agent takes it from there.

Agents can dispatch other agents on the fly too. When one finishes a task or hands off new work, it can route directly to whoever's next without waiting for the cycle. Bakin's dispatch loop sits behind that as the safety net: it catches anything that fell through, retries transient failures, and cools down structural ones so nothing sits stuck indefinitely.

The ticker shows the countdown to the next cycle. Bakin dispatches on a configurable interval (default: every 5 minutes). Click it to fire immediately if you can't wait, or fire from the CLI.

```sh
bakin dispatch       # fire dispatch immediately
```

## X-Ray

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-essentials--xray-mode.webp" alt="X-Ray on, surfacing extra context across the activity feed and search." loading="lazy">
</figure>

Bakin is all about visibility, and that doesn't stop at the top level. Flip on X-Ray for deeper detail across the interface: extra context in the activity feed, why certain results are coming back in search, the raw data behind any view.

Toggle it from the bug icon, or hit `?debug=true` in the URL once. Off by default; state persists in localStorage.

## Alerting

You don't have to keep Bakin's tab focused. Browser alerts push through whenever something needs your attention: failed dispatch retries, blocked tasks waiting on you, anything else Bakin notices that you should know about. Click any alert to jump straight to whatever it's about. Grant permission once and they show up like any other app notification.

Alerts also fan out to any messaging channels you've connected (Discord, Slack, email). You don't need Bakin open to stay in the loop and keep things flowing.

<figure class="screenshot-frame">
  <img src="/docs/media/screenshots/using-essentials--alerting.webp" alt="Header bar showing dispatch ticker, debug toggle, notification bell, and connection status." loading="lazy">
</figure>

## System Status

A status indicator showing connection. <span class="status-dot status-dot--green"></span> means Bakin is running and reachable. <span class="status-dot status-dot--red"></span> means it's disconnected or restarting. If it stays red, check [start/restart](/docs/start/operation/). For the full diagnostic, jump to [Health](/docs/using/health/).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents call into the same surfaces you do. Search and health checks are exposed as MCP exec tools.

<!-- docs:exec-tools search -->
- `bakin_exec_search_facets`: Get facet value counts for a plugin. Useful for understanding data distribution (e.g., how many tasks per status).
- `bakin_exec_search_lookup`: Look up a specific indexed document by its key and plugin.
- `bakin_exec_search_query`: Search across all Bakin content (tasks, assets, projects, workflows, schedule, team, memory, messaging) or a specific plugin. Returns ranked results with scores.
- `bakin_exec_search_reindex`: Trigger a full reindex of all content types (or a specific plugin). Use after bulk data changes.
- `bakin_exec_search_similar`: Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.
- `bakin_exec_search_stats`: Get search system health: enabled status, per-table document counts, and index stats.
- `bakin_exec_search_table`: Search a specific Bakin plugin with facet filtering. Returns results plus facet counts for filtering.
<!-- /docs:exec-tools -->

<!-- docs:exec-tools health -->
- `bakin_exec_health_doctor`: Return the canonical Health report. Use fresh=true to join or start a full diagnostic sweep first.
- `bakin_exec_health_status`: Get a quick canonical system health summary with uptime, memory, connected session count, activity failures, and incident counts.
<!-- /docs:exec-tools -->

Full schemas and arguments in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): the kanban board where most work happens
- [Health](/docs/using/health/): the deeper diagnostics behind the status dot
- [Memory](/docs/using/memory/): the searchable history view of activity
- [Settings](/docs/using/settings/): configure alert thresholds, dispatch cadence, and runtime knobs
