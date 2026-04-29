---
title: CLI Reference
description: Generated reference for public Bakin CLI commands.
---

Docs version: Bakin 1.0.0

This page is generated from `src/core/cli/registry.ts`.

## Lifecycle

### `bakin start`

Starts the Bakin HTTP server and dashboard. This is the default command when the compiled binary is launched without arguments.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin start
```

Example test mode: `illustrative`
Reason: Starts a long-running server process.

### `bakin stop`

Finds a running Bakin process and sends SIGTERM.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin stop
```

Example test mode: `illustrative`
Reason: Requires a running local server process.

### `bakin restart`

Restarts Bakin using the available service manager or standalone process behavior.

- Visibility: `public`
- Stability: `stable`
- Aliases: `reboot`

Example:

```sh
bakin restart
```

Example test mode: `illustrative`
Reason: Requires a running local installation.

### `bakin status`

Prints local server reachability, dispatch interval, last run, next run, and version information where available.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin status
```

Example test mode: `illustrative`
Reason: Requires a running local server for full output.

### `bakin dev`

Runs Bakin in watch-mode development from a source checkout. The compiled binary refuses this command outside a repo clone.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin dev
```

Example test mode: `illustrative`
Reason: Starts a long-running development process.

### `bakin version`

Prints the version embedded in the running CLI/binary.

- Visibility: `public`
- Stability: `stable`
- Aliases: `--version`, `-v`

Example:

```sh
bakin version
```

Example test mode: `automated`

### `bakin update`

Downloads the latest release binary and verifies checksums before replacing the installed executable.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin update
```

Example test mode: `illustrative`
Reason: Downloads a release and mutates the installed binary.

### `bakin doctor`

Runs Bakin diagnostics for local dependencies, server state, agents, plugin assets, runtime behavior, and recoverable issues.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin doctor
```

Example test mode: `illustrative`
Reason: Depends on local Bakin/runtime state.

## Tasks and workflows

### `bakin dispatch`

Asks the running Bakin server to run the task dispatch cycle immediately.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin dispatch
```

Example test mode: `illustrative`
Reason: Requires a running local server.

### `bakin tasks list [--column=<column>]`

Lists tasks from the task board, optionally filtered by column.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks list --column=todo
```

Example test mode: `illustrative`
Reason: Requires a running local server.

### `bakin tasks get <id>`

Fetches one task by id from the running server.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks get task-123
```

Example test mode: `illustrative`
Reason: Requires fixture server data.

### `bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow=<reason>]`

Creates a task and optionally assigns an agent or workflow.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks create "Fix the docs" patch
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin tasks move <id> <column>`

Moves a task to a different board column.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks move task-123 done
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin tasks log <id> <message>`

Adds a progress log entry to a task.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks log task-123 "Finished implementation"
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin tasks block <id> <reason>`

Marks a task blocked with a reason.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks block task-123 "Waiting on review"
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin tasks depend <id> <dependsOn>`

Sets a task dependency relationship.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks depend task-123 task-100
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin tasks complete <id> <summary>`

Marks a task complete with a completion summary.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin tasks complete task-123 "Docs updated"
```

Example test mode: `illustrative`
Reason: Mutates local task state.

### `bakin workflows list`

Lists available workflow definitions.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin workflows list
```

Example test mode: `illustrative`
Reason: Requires a running local server.

### `bakin workflows start <taskId> <workflowId>`

Starts a workflow instance for a task.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin workflows start task-123 default
```

Example test mode: `illustrative`
Reason: Mutates local workflow state.

### `bakin workflows step <taskId>`

Fetches current workflow step details for a task.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin workflows step task-123
```

Example test mode: `illustrative`
Reason: Requires workflow fixture state.

### `bakin workflows submit <taskId> <stepId> <json>`

Submits JSON output for a workflow step.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin workflows submit task-123 step-1 '{"ok":true}'
```

Example test mode: `schema`

## Agents and packages

### `bakin agents list [--packages]`

Lists runtime agents, or package state when `--packages` is set.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents list
```

Example test mode: `illustrative`
Reason: Depends on Bakin/runtime state.

### `bakin agents status <id>`

Fetches detailed status for an agent.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents status patch
```

Example test mode: `illustrative`
Reason: Depends on Bakin/runtime state.

### `bakin agents tasks <id>`

Lists tasks currently assigned to an agent.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents tasks patch
```

Example test mode: `illustrative`
Reason: Requires running server data.

### `bakin agents send <id> <message>`

Sends a message through the running server to an agent.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents send patch "Check the build"
```

Example test mode: `illustrative`
Reason: Requires a running agent runtime.

### `bakin agents install <path|github:user/repo[@ref]> [--adopt] [--install-as <id>] [--replace]`

Installs or adopts an agent package into Bakin/runtime-managed agent state.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents install ./agent-package --install-as patch
```

Example test mode: `illustrative`
Reason: Mutates local agent package state.

### `bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--force]`

Removes an installed agent package and optionally deletes the runtime agent.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents remove patch --keep-blocks
```

Example test mode: `illustrative`
Reason: Mutates local agent package state.

### `bakin agents update [agent-id] [--refresh-template]`

Updates one or all installed agent packages.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents update
```

Example test mode: `illustrative`
Reason: Mutates local agent package state.

### `bakin agents knowledge <list|enable|disable> ...`

Lists or toggles lesson/knowledge blocks for an agent package.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agents knowledge list patch
```

Example test mode: `illustrative`
Reason: Depends on installed agent package state.

### `bakin packages install <path|github:user/repo[@ref]> [--install-as <id>] [--replace]`

Installs a standalone package.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin packages install ./package
```

Example test mode: `illustrative`
Reason: Mutates local package state.

### `bakin packages list`

Lists installed packages.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin packages list
```

Example test mode: `illustrative`
Reason: Depends on local package state.

### `bakin packages remove <package-id> [--force] [--keep-blocks]`

Removes an installed package.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin packages remove package-id
```

Example test mode: `illustrative`
Reason: Mutates local package state.

### `bakin packages update <package-id> [--refresh-template]`

Updates an installed package.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin packages update package-id
```

Example test mode: `illustrative`
Reason: Mutates local package state.

## Plugins

### `bakin plugins list [--check]`

Lists installed plugins and versions. Pass --check to probe remote/source for available upgrades.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins list
```

Example test mode: `illustrative`
Reason: Requires local server/plugin state.

### `bakin plugins install [--dev] <path|github:user/repo[@ref][#subpath]> [--ref <ref>] [--yes] [--force]`

Installs a plugin from a local path or GitHub source. Append #subpath to install from a monorepo directory, or pin a GitHub install with @ref / --ref. --dev symlinks a local source tree for live development. --yes skips the consent prompt. --force replaces an existing install when used with --dev.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins install --dev ./my-plugin
```

Example test mode: `illustrative`
Reason: Mutates local plugin state.

### `bakin plugins upgrade <id> [--yes]`

Re-pulls a user plugin from its source and rebuilds. --yes skips the consent prompt.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins upgrade my-plugin
```

Example test mode: `illustrative`
Reason: Mutates local plugin state.

### `bakin plugins remove <id>`

Removes an installed non-core plugin.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins remove my-plugin
```

Example test mode: `illustrative`
Reason: Mutates local plugin state.

### `bakin plugins scaffold <name>`

Creates a starter plugin source tree.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins scaffold my-plugin
```

Example test mode: `illustrative`
Reason: Writes a new plugin directory.

### `bakin plugins link <localPath> [--force]`

Registers a local source tree as a developer-mode plugin via a symlink at ~/.bakin/plugins/<id>/. Used with the hot-reload coordinator. --force overrides id collisions with copied installs or core plugins, but already-linked plugins must be unlinked first.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins link ./my-plugin
```

Example test mode: `illustrative`
Reason: Mutates local plugin state.

### `bakin plugins unlink <id>`

Removes the dev-mode symlink and lockfile entry. Refuses installed (non-linked) plugins — use `bakin plugins remove` for those.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin plugins unlink my-plugin
```

Example test mode: `illustrative`
Reason: Mutates local plugin state.

## Setup and config

### `bakin settings get [key]`

Reads all settings or one dot-notation key.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin settings get dispatch.intervalMin
```

Example test mode: `illustrative`
Reason: Depends on local settings state.

### `bakin settings set <key> <value>`

Updates one setting using dot notation.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin settings set dispatch.intervalMin 5
```

Example test mode: `illustrative`
Reason: Mutates local settings.

### `bakin settings init`

Creates default settings if missing.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin settings init
```

Example test mode: `illustrative`
Reason: Writes local settings state.

### `bakin setup service [--uninstall]`

Installs or removes the LaunchAgent used for auto-start behavior on macOS.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin setup service
```

Example test mode: `illustrative`
Reason: Mutates host service configuration.

### `bakin mkdir`

Creates or verifies the `~/.bakin` directory tree.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin mkdir
```

Example test mode: `illustrative`
Reason: Writes local home directory state.

### `bakin init`

Deprecated alias for `bakin mkdir`.

- Visibility: `public`
- Stability: `deprecated`

Example:

```sh
bakin init
```

Example test mode: `illustrative`
Reason: Writes local home directory state.

### `bakin check <runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all>`

Runs one or all first-run readiness checks.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin check all
```

Example test mode: `illustrative`
Reason: Depends on local environment.

### `bakin install <search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins>`

Installs Bakin dependencies, plugin/agent assets, or official recommended plugins.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin install mcporter
```

Example test mode: `illustrative`
Reason: Downloads or mutates local dependencies.

### `bakin onboard [--check] [--yes] [--json] [--force]`

Runs the full first-run setup flow.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin onboard --yes --json
```

Example test mode: `illustrative`
Reason: Writes local state and may install dependencies.

### `bakin paths [key]`

Prints Bakin runtime paths, optionally for one key.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin paths
```

Example test mode: `illustrative`
Reason: Depends on local Bakin home settings.

### `bakin agent-rules [--apply|--check|--apply-all|--check-all]`

Applies or checks managed AGENTS.md rule blocks.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin agent-rules --check
```

Example test mode: `illustrative`
Reason: Depends on local agent files.

## Schedule

### `bakin schedule [list|add|pause|resume|remove|run|runs] ...`

Lists, creates, pauses, resumes, removes, triggers, or inspects scheduled jobs.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin schedule list
```

Example test mode: `illustrative`
Reason: Requires running server data.

## Assets and search

### `bakin logs [filter]`

Prints audit log entries, optionally filtered by event type or agent.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin logs mcp
```

Example test mode: `illustrative`
Reason: Depends on local log files.

### `bakin reindex [--table=<name>] [--rebuild]`

Triggers content indexing through the search adapter.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin reindex --table=tasks
```

Example test mode: `illustrative`
Reason: Requires local search/server state.

### `bakin docs`

Fetches current API route documentation from `/api/docs`.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin docs
```

Example test mode: `illustrative`
Reason: Requires a running local server.

### `bakin search <query> [--table=<name>] [--agent=<id>] [--limit=<n>] [--facets=<list>]`

Searches indexed Bakin content.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin search "blocked task" --table=tasks --limit=5
```

Example test mode: `illustrative`
Reason: Requires indexed local content.

### `bakin search:stats`

Prints registered search table/index health and counts.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin search:stats
```

Example test mode: `illustrative`
Reason: Requires local search state.

### `bakin trash [list|restore|empty] ...`

Lists, restores, or permanently empties soft-deleted assets.

- Visibility: `public`
- Stability: `stable`

Example:

```sh
bakin trash list
```

Example test mode: `illustrative`
Reason: Depends on local asset state.
