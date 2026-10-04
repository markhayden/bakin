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

To repair interrupted migrations or missing search indexes:

```sh
bakin reindex                # all tables
bakin reindex --table=tasks  # one table
```

The default repair resumes recorded work and leaves healthy indexes untouched.
If the engine cannot report an index's status, repair reports the failure and
preserves the index; retry after the engine recovers. Interrupted backfills
remain queued for bounded automatic retries while queries use the previous
index.

To regenerate a healthy index from source, for example after bulk edits that
were not indexed, use an explicit forced reindex:

```sh
bakin reindex --table=tasks --force
```

This builds a replacement index before switching queries to it. A parked or
failed rebuild is reported as incomplete; inspect Health before retrying.

Prefer the dashboard? The same controls live in the [Health plugin](/docs/using/health/).

## Search service ownership and recovery

The managed search service is shared by your OS user, and belongs to one
Bakin home. Starting Bakin from another home cannot take it over. If the unit
is missing or belongs to another home, Bakin starts with search unavailable
and keeps queued index writes in that home's journal. Browsing source content
continues to work.

For the intended permanent home, run `bakin install search` with that home's
`BAKIN_HOME`. This explicitly creates or transfers service ownership. Stop
the previous Bakin process before a transfer, then restart Bakin from the
chosen home after installation. For example, for a permanent custom home:

```sh
BAKIN_HOME="$HOME/bakin-work" bakin install search
BAKIN_HOME="$HOME/bakin-work" bakin start
```

If Bakin for that home is already running, stop it before the `start` step.
Generic onboarding can set up an unclaimed service, but never transfers one
from another home. An existing engine binary alone does not complete setup.

Temporary homes under system temporary roots (`/tmp`, `/private/tmp`,
`/var/tmp`, or `TMPDIR`) cannot claim the shared service, even with `--yes` or
`--force`. Give them an independently managed endpoint using
`search.settings.url`, such as the isolated rig's `http://127.0.0.1:3838`.
A trailing slash or hostname spelling change on the default endpoint does not
make it isolated. Disposable directories elsewhere are also protected on
ordinary boot; do not deliberately install the shared service from them.
Whole-home symlinks are supported; linking only the engine data directory to
another location is refused so indexes and home metadata remain together.

The installer verifies downloads before stopping the old service, and reports
failure if stopping, starting, or readiness verification fails. Failed
operations after a stop may leave search offline: fix the reported problem,
rerun installation from the intended permanent home, then restart Bakin.
An unrelated process occupying the engine ports must be stopped by its owner.
Bakin will not kill or adopt it. Clear an inconsistent `ANTFLY_PATH` override
before managed installation; the service uses its managed executable.

Service changes use one lock beside the unit. If an operation crashes and
leaves the lock behind, the error names its path. Stop all processes that
could change the service, inspect the lock's holder, then remove that specific
abandoned lock and retry. Do not remove a lock while installation is running.

## Upgrading search from a pre-0.2 install

Bakin downloads its pinned engine directly and uses `<BAKIN_HOME>/antfly`
for derived indexes. Run:

```sh
bakin stop
bakin install search
bakin install search-models
bakin start
bakin reindex
bakin check search
```

An engine version change rebuilds the chosen home's derived engine data;
source content and the previous owner's data remain intact. Installation does
not clean up unrelated legacy engine/model directories. Keep any data used by
other projects and manage it with that engine's own backup/restore tools.
If content was indexed before model installation, run `bakin install
search-models` followed by `bakin reindex` to repair semantic indexing.

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
