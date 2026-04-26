---
title: Operation
description: Start, stop, inspect, update, and troubleshoot a running Bakin instance.
---

Start the server:

```sh
bakin start
```

Bakin listens on port `3737` by default. Set `PORT` to override it:

```sh
PORT=3838 bakin start
```

Check status:

```sh
bakin status
```

Run diagnostics:

```sh
bakin doctor
```

Update the binary:

```sh
bakin update
```

`bakin update` downloads the latest GitHub release, verifies `checksums.txt`, replaces the current binary, and tells you to restart. It does not auto-restart a running server.

Stop a running instance:

```sh
bakin stop
```

Restart:

```sh
bakin restart
```

## Service Setup

On macOS, install or remove LaunchAgent service integration:

```sh
bakin setup service
bakin setup service --uninstall
```

Service setup is an operational convenience, not the primary install path.

## Logs and Paths

Show the resolved runtime paths:

```sh
bakin paths
```

Tail audit logs:

```sh
bakin logs
bakin logs mcp
```

## Reindex Search

When search content drifts, reindex:

```sh
bakin reindex
bakin reindex --table=tasks
```

Use `--rebuild` only when you intend to rebuild index state.
