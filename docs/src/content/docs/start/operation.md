---
title: Daily Operation
description: Start, stop, watch, update, and keep your Bakin instance healthy.
---

## Start it

```sh
bakin start
```

Once it's running, open **[http://localhost:3737](http://localhost:3737)**. That's Bakin basecamp.

Want it always running? Set Bakin up to [run as a service](#run-as-a-service-macos).

The default port is `3737`. If something else is already on it, override the port:

```sh
PORT=3838 bakin start
```

For access from another machine, expose the port through Tailscale, Cloudflare Tunnel, or whatever you already trust. Bakin is local-first and assumes you control the network in front of it.

## Stop and restart

```sh
bakin stop
bakin restart
```

Without a service installed, `restart` is a `stop` followed by `start`. With a service installed, it asks the service manager to restart Bakin and waits for the server to respond. Good for picking up settings changes, core agent file changes, or rare plugin manifest/schema changes that don't auto-reload.

Dev-installed plugins (`bakin plugins install --dev <path>`) load on normal start because Bakin follows the symlink under `~/.bakin/plugins/<id>`. Live rebuilds for source edits only run under `bakin dev`.

## Check that it's healthy

Two flavors of "is it working":

```sh
bakin status   # is the server running, and on what port
bakin doctor   # full health check across runtime, models, channels, plugins
```

Run `status` for a quick "is it up". Run `doctor` when something feels off or after a major change.

## Get the freshest Bakin

```sh
bakin update
```

Pulls the latest GitHub release archive, verifies `checksums.txt`, extracts the binary, and swaps it in place. It doesn't touch a running server. Run `bakin restart` afterward for the new binary to take effect.

## Tail the logs

```sh
bakin logs        # rolling server log
bakin logs mcp    # MCP audit log
```

Log lines go to both stdout and `~/.bakin/logs/server.log` (10 MB rotation, single backup). Tail with the commands above or watch the file directly.

## Diagnose slow startup

Startup diagnostics are off by default. Turn them on when Bakin feels slow to
start, hangs on **Loading plugins**, or loads slowly from another device:

```sh
bakin diagnostics startup status
bakin diagnostics startup on --slow-ms 250
bakin restart
```

The command writes `diagnostics.startup` in `~/.bakin/settings.json`, so it also
works for service-managed or auto-started instances. Changes apply on the next
server start. Turn it back off when you're done:

```sh
bakin diagnostics startup off
bakin restart
```

For a one-off foreground run, use environment overrides instead:

```sh
BAKIN_STARTUP_DIAGNOSTICS=1 BAKIN_STARTUP_SLOW_MS=250 BAKIN_CONSOLE_FORMAT=verbose bakin start
```

Server startup spans are written as structured log data with
`category: "startup"`. Browser plugin boot is separate from server startup; to
inspect that path, run this in DevTools on the slow browser and reload:

```js
localStorage.setItem('bakin:plugin-diagnostics', '1')
location.reload()
```

To copy the latest browser resource summary:

```js
copy(JSON.stringify(window.__bakinStartupSpans?.filter(s => s.span === 'pluginHost.resourceSummary').at(-1), null, 2))
```

## Inspect runtime paths

```sh
bakin paths
```

Shows where Bakin resolved its home directory, content dir, plugin paths, logs, and lock files. Useful when something feels off and you want to confirm where state actually lives.

## Reindex search

If search results look stale, or you've edited `~/.bakin/` files outside the app:

```sh
bakin reindex                # all tables
bakin reindex --table=tasks  # one table
```

Use `--rebuild` only when you want to drop the existing index and start fresh.

Prefer the dashboard? The same controls live in the [Health plugin](/docs/using/health/).

## Upgrading search from a pre-0.2 install

Early Bakin builds installed Antfly via Homebrew and shared the global `~/.antfly` data directory. Antfly v0.2 changed its file formats and Bakin now runs its **own private instance** (data under `~/.bakin/antfly/`, port `3738`), so nothing from the old install carries over — and nothing needs to. The search index is derived data; it rebuilds from your markdown and logs.

The guided path (recommended):

```sh
bakin stop
bakin install search          # downloads the pinned v0.2 binary; detects old state
bakin install search-models   # prefetches the embedding models (~1GB)
bakin start
bakin reindex                 # rebuilds the index from source
bakin check search            # should report OK
```

`bakin install search` will list anything left over from the old world — the legacy `~/.termite` model cache, the pre-0.2 server state under `~/.antfly`, a brew-installed binary — and offer to reclaim the disk per item (interactive only, default No). One warning to take seriously: the old `~/.antfly` data directory was shared, so if you ever used Antfly for projects *outside* Bakin, decline that deletion and migrate your own tables with Antfly's backup/restore first.

The fully-manual equivalent, if you'd rather do it yourself:

```sh
rm -rf ~/.antfly/data ~/.antfly/store ~/.antfly/metadata ~/.antfly/bakin-managed.yaml
rm -rf ~/.termite
brew uninstall antfly         # if it was brew-installed; Bakin never runs brew
bakin install search && bakin install search-models
bakin start && bakin reindex
```

If you skipped the model download and indexed content in the meantime, semantic indexing for that content is repaired by `bakin install search-models` followed by a plain `bakin reindex`.

## Run as a service (macOS)

Optional. To keep Bakin running across reboots:

```sh
bakin setup service             # install LaunchAgent and start it now
bakin setup service --uninstall # remove it
```

Setup starts the service immediately and verifies the server responds before reporting success. Plenty of people just leave `bakin start` running in a terminal session or window. Whatever works.

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Lifecycle commands (`start`/`stop`/`restart`/`update`/`logs`) are human-only. The diagnostic and search surfaces are also exposed as MCP exec tools so agents can self-check and pull data.

<!-- docs:exec-tools health -->
- `bakin_exec_health_doctor`: Return the canonical Health report. Use fresh=true to join or start a full diagnostic sweep first.
- `bakin_exec_health_status`: Get a quick canonical system health summary with uptime, memory, connected session count, activity failures, and incident counts.
<!-- /docs:exec-tools -->

<!-- docs:exec-tools search -->
- `bakin_exec_search_facets`: Get facet value counts for a plugin. Useful for understanding data distribution (e.g., how many tasks per status).
- `bakin_exec_search_lookup`: Look up a specific indexed document by its key and plugin.
- `bakin_exec_search_query`: Search across all Bakin content (tasks, assets, projects, workflows, schedule, team, memory, messaging) or a specific plugin. Returns ranked results with scores.
- `bakin_exec_search_reindex`: Trigger a full reindex of all content types (or a specific plugin). Use after bulk data changes.
- `bakin_exec_search_similar`: Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.
- `bakin_exec_search_stats`: Get search system health: enabled status, per-table document counts, and index stats.
- `bakin_exec_search_table`: Search a specific Bakin plugin with facet filtering. Returns results plus facet counts for filtering.
<!-- /docs:exec-tools -->

- `bakin_exec_get_paths`: agent equivalent of `bakin paths`.

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>
