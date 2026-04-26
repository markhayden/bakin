---
title: Data and Security
description: Practical operator guidance for Bakin data storage, local services, updates, plugins, and runtime security.
---

# Data and Security

Bakin is self-hosted. Operators should understand what runs locally, what is stored under `~/.bakin`, what talks to OpenClaw, and which external services are configured.

Legal privacy policy details live on makinbakin.com. This page focuses on technical operator behavior.

## Local Runtime

Bakin runs as a local server and dashboard. It coordinates local files, OpenClaw agent state, configured LLM providers, optional messaging channels, and core plugins.

The default server port is `3737`. Set `PORT` when binding somewhere else.

## Stored Data

Bakin stores runtime data under the resolved Bakin home directory. Normal installs use `~/.bakin/`.

Important files and directories include:

| Path | Purpose |
| --- | --- |
| `settings.json` | Runtime settings. |
| `audit.jsonl` | Append-only audit events. |
| `logs/` | Runtime logs. |
| `assets/` | Asset storage, inbox, and trash. |
| `projects/` | Project content. |
| `workflows/` | Workflow definitions, skills, and instances. |
| `team/` | Team and persona data. |
| `heartbeats/` | Agent heartbeat files. |
| `MEMORY-LOG.md` | Memory log data. |

Use `bakin paths` to inspect exact locations.

## External Services

Bakin only uses external services you configure or invoke:

- OpenClaw for agent coordination
- LLM providers configured in settings
- messaging channels configured for scheduling and approval flows
- Antfly when search/indexing is enabled
- GitHub release APIs for installer and self-update flows

## Plugins

Plugins can add routes, UI, settings, hooks, exec/MCP tools, workflow nodes, notification channels, search content types, and health checks.

Review plugin manifests and permissions before installing third-party plugins. Core plugin docs are public; third-party plugin docs are not published here.

## Install and Update Integrity

The one-line installer downloads the platform-specific binary and verifies the SHA-256 checksum from the release `checksums.txt` file.

`bakin update` follows the same principle: download the latest release asset, verify the checksum, replace the installed binary, and leave the old binary intact if the download or checksum fails.

## Backups

Back up the Bakin home directory before major upgrades or bulk plugin changes:

```sh
tar -czf bakin-backup.tgz ~/.bakin
```

When using `BAKIN_HOME`, back up that directory instead.

## Operational Hygiene

- Keep secrets out of docs, tasks, and agent knowledge files.
- Treat `audit.jsonl` and `logs/` as sensitive operational records.
- Review agent package `allowedTools` and `allowedSkills` before adopting packages.
- Prefer release binaries over ad hoc local builds for production use.
- Run `bakin doctor` after upgrades, plugin installs, and agent package changes.
