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

`restart` is a `stop` followed by `start`. Good for picking up settings changes, plugin installs, or core agent file changes that don't auto-reload.

## Check that it's healthy

Two flavors of "is it working":

```sh
bakin status   # is the server running, and on what port
bakin doctor   # full health check across OpenClaw, models, channels, plugins
```

Run `status` for a quick "is it up". Run `doctor` when something feels off or after a major change.

## Get the freshest Bakin

```sh
bakin update
```

Pulls the latest GitHub release, verifies `checksums.txt`, and swaps your binary in place. It doesn't touch a running server. Run `bakin restart` afterward for the new binary to take effect.

## Tail the logs

```sh
bakin logs        # rolling server log
bakin logs mcp    # MCP gateway audit log
```

Log lines go to both stdout and `~/.bakin/logs/server.log` (10 MB rotation, single backup). Tail with the commands above or watch the file directly.

## Inspect runtime paths

```sh
bakin paths
```

Shows where Bakin resolved its home directory, content dir, OpenClaw home, plugin paths, logs, and lock files. Useful when something feels off and you want to confirm where state actually lives.

## Reindex search

If search results look stale, or you've edited `~/.bakin/` files outside the app:

```sh
bakin reindex                # all tables
bakin reindex --table=tasks  # one table
```

Use `--rebuild` only when you want to drop the existing index and start fresh.

Prefer the dashboard? The same controls live in the [Health plugin](/docs/core/health/).

## Run as a service (macOS)

Optional. To keep Bakin running across reboots:

```sh
bakin setup service             # install LaunchAgent
bakin setup service --uninstall # remove it
```

Plenty of people just leave `bakin start` running in a terminal session or window. Whatever works.
