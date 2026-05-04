---
title: Data and Security
description: Practical operator guidance for Bakin data storage, local services, updates, plugins, and runtime security.
---

Bakin is self-hosted. Operators should understand what runs locally, what is stored under `~/.bakin`, what talks to the configured runtime, and which external services are configured.

Legal privacy policy details live on makinbakin.com. This page focuses on technical operator behavior.

## Local Runtime

Bakin runs as a local server and dashboard. It coordinates local files, runtime agent state, configured LLM providers, optional messaging channels, and core plugins.

The default server port is `3737`. Set `PORT` when binding somewhere else.

Bakin binds to `0.0.0.0` so it can be reached from trusted private networks such as Tailscale. The HTTP API, dashboard, SSE stream, MCP endpoint, plugin routes, asset serving, and settings routes are not a public internet security boundary. Do not expose Bakin directly to an untrusted network. Put it behind host firewall rules, Tailscale/VPN access control, or a reverse proxy with authentication.

## Stored Data

Bakin stores Bakin-owned data under the resolved Bakin home directory. Normal installs use `~/.bakin/`; `BAKIN_HOME` overrides it.

Important files and directories include:

| Path | Purpose |
| --- | --- |
| `settings.json` | System settings: runtime adapter, search adapter, dispatch, watchdog, alerts, model allow/block lists. |
| `plugin-settings/` | Per-plugin settings. May include plugin-owned operational secrets such as schedule bridge tokens. |
| `audit.jsonl` | Append-only audit events. |
| `logs/` | Server logs. `server.log` rotates at 10 MB with one backup. Set `BAKIN_DISABLE_FILE_LOG=1` to disable file logging. |
| `assets/` | Asset storage, inbox, and trash. |
| `plugins/` | Installed external plugins, their bundles, and plugin-scoped data. |
| `packages/` | Installed agent, skill, workflow, and lesson package sources plus package lock data. |
| `tasks/` | Task board data and dispatch state. |
| `projects/` | Project markdown specs, checklist state, and project asset links. |
| `workflows/` | Workflow definitions, skills, and instances. |
| `schedule/` | Bakin schedule sidecar metadata. Runtime cron definitions and run logs live in the configured runtime. |
| `messaging.json`, `messaging/` | Calendar items and brainstorm sessions for the Messaging plugin. |
| `team/` | Bakin team layout and Bakin-owned persona metadata. Agent workspace files usually live in the runtime home. |
| `agents/` | Bakin UI extras for agents, such as uploaded avatars and display assets. |
| `heartbeats/` | Agent heartbeat files. |
| `inbox/` | Local inbox watched by Bakin for completion notifications. |
| `MEMORY-LOG.md` | Memory log data. |
| `.search-state.json` | Search schema migration state. |
| `.onboarded` | Onboarding completion marker used by health checks. |

Use `bakin paths` to inspect exact locations.

## Runtime-Owned Data

Bakin reads and writes some data through the configured runtime adapter. With the default OpenClaw adapter, runtime-owned data lives under `OPENCLAW_HOME` or `~/.openclaw/`.

Runtime-owned data can include agent identity, soul/rules/tools files, skills, model assignments, session transcripts, durable memory, channels, cron definitions, and cron run history. Back up the runtime home separately when you need a complete restore of agents and their memory.

## External Services

Bakin only uses external services you configure or invoke:

- the configured runtime adapter for agent coordination
- LLM providers configured in settings
- messaging channels configured for scheduling and approval flows
- the configured search adapter when search/indexing is enabled; default installs use the local Antfly adapter and local Termite embedders/reranker
- GitHub release APIs for installer and self-update flows
- GitHub repositories when installing GitHub-sourced plugins or agent/package sources

## Plugins

Plugins can add routes, UI, settings, hooks, exec/MCP tools, workflow nodes, notification channels, search content types, and health checks.

Third-party plugins are executable code loaded into the Bakin server process. Plugin permissions and consent prompts give operators visibility into declared capabilities, but they are not a sandbox. Install third-party plugins only from sources you trust.

Review plugin manifests, permissions, source, dependencies, and update diffs before installing or upgrading. Core plugin docs are public; third-party plugin docs are not published here.

Local plugin install paths are restricted to trusted roots (`~/.bakin/`, `$HOME`, or the current working directory), and GitHub sources are parsed and validated before clone. These checks reduce accidental or malicious install mistakes; they do not make untrusted code safe.

## Secrets and Local Encryption

Bakin stores local configuration and plugin data as normal files. Bakin does not encrypt `~/.bakin` at rest. Use operating-system disk encryption and filesystem permissions for local protection.

Treat these as sensitive:

- `settings.json` and `plugin-settings/*.json`
- `audit.jsonl` and `logs/server.log`
- assets, project specs, task descriptions, messaging sessions, workflow inputs/outputs
- runtime home data such as agent transcripts, durable memory, and workspace files

Keep API keys, credentials, and channel tokens out of docs, tasks, project specs, assets, and agent lessons unless you explicitly intend agents and local plugins to see them.

## Install and Update Integrity

The one-line installer downloads the platform-specific binary and verifies the SHA-256 checksum from the release `checksums.txt` file.

`bakin update` follows the same principle: download the latest release asset, verify the checksum, replace the installed binary, and leave the old binary intact if the download or checksum fails.

## Backups

Back up the Bakin home directory before major upgrades or bulk plugin changes:

```sh
tar -czf bakin-backup.tgz ~/.bakin
```

When using `BAKIN_HOME`, back up that directory instead. Backups include plaintext local settings, plugin settings, audit/log history, plugin bundles, tasks, projects, assets, messaging sessions, workflow state, and package sources. Protect backup files like production data.

For a complete restore, also back up the configured runtime home, such as `~/.openclaw/` for the default OpenClaw adapter.

## Operational Hygiene

- Restrict network access to the Bakin port.
- Keep secrets out of docs, tasks, assets, project specs, messaging sessions, and agent lessons files.
- Treat `audit.jsonl` and `logs/` as sensitive operational records.
- Review agent package `allowedTools` and `allowedSkills` before adopting packages.
- Review third-party plugin permissions and source before install or upgrade.
- Prefer release binaries over ad hoc local builds for production use.
- Run `bakin doctor` after upgrades, plugin installs, and agent package changes.
