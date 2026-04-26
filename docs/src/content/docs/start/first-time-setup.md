---
title: Initial Setup
description: Onboard your local Bakin instance and confirm it's healthy.
lastUpdated: 2026-04-25
---

:::note[Bakin needs OpenClaw]
Bakin is the dashboard. [OpenClaw](https://openclaw.ai/) is the agent runtime it reads from. Install and start OpenClaw before onboarding, otherwise the OpenClaw check will fail.

Onboarding only *reads* `~/.openclaw/` to confirm the install. It never writes, modifies, or copies OpenClaw files.
:::

```sh
bakin onboard
```

That's the whole setup for most folks. Want the full breakdown before you run it? [Here's what onboarding does.](#what-onboarding-actually-does)

## Confirm it worked

```sh
bakin doctor
```

`bakin doctor` runs every health check in one shot. Green across the board means you're done.

If something fails, run the specific check to narrow it down:

```sh
bakin check openclaw       # OpenClaw is installed, reachable, openclaw.json parses
bakin check llm            # at least one LLM provider is configured
bakin check channels       # messaging channels are wired up (when on)
bakin check plugin-assets  # plugin defaults projected into ~/.bakin/
bakin check agent-assets   # agent package files installed and current
```

Full command reference lives in the [CLI docs](/docs/reference/generated/cli/).

## What onboarding actually does

- Creates `~/.bakin/`, your local data directory
- Seeds default settings
- Confirms OpenClaw is reachable
- Confirms at least one LLM provider is configured
- Confirms messaging channels if you've enabled messaging

If any check fails, onboarding tells you what's missing.

## Where your data lives

Everything Bakin owns lives in `~/.bakin/` by default: settings, plugins, projects, assets, agent state, schedules, logs, audit trail, and so on. See exactly what's resolved at runtime:

```sh
bakin paths
```

Anything that normally lives in `~/.openclaw/` (agent identity, skills, tools, workspace data) stays there. Bakin reads from OpenClaw but never copies, mirrors, or duplicates its state.

For demos or disposable tests, point Bakin at a different directory with `BAKIN_HOME`:

```sh
BAKIN_HOME="$PWD/.bakin-demo" bakin onboard --yes
```

Resolution order: `BAKIN_HOME` → `CONTENT_DIR` → `~/.bakin/` → `./content/`.

## Automating onboarding

For CI or scripted setup, skip prompts and emit JSON:

```sh
bakin onboard --yes --json
```
