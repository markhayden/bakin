---
title: First-Time Setup
description: Run onboarding, create the Bakin home directory, and verify local dependencies.
---

# First-Time Setup

After installation, run onboarding:

```sh
bakin onboard
```

Onboarding creates the Bakin home directory, seeds settings, checks OpenClaw availability, verifies model and channel configuration, and prepares local dependencies used by the app.

For scripted environments:

```sh
bakin onboard --yes --json
```

## Expected Result

A ready local instance has:

- a Bakin home directory
- default settings
- validated OpenClaw configuration
- at least one LLM provider path
- at least one messaging channel path when messaging is enabled

## Home Directory

Bakin resolves its home/content directory in this order:

1. `BAKIN_HOME`
2. `CONTENT_DIR`
3. `~/.bakin/` when it exists
4. `./content/` fallback

For normal installs, use `~/.bakin/`. For disposable tests or demos, set `BAKIN_HOME`:

```sh
BAKIN_HOME="$PWD/.bakin-demo" bakin onboard --yes
```

Inspect resolved paths:

```sh
bakin paths
```

## Readiness Checks

Run a specific check when narrowing setup issues:

```sh
bakin check openclaw
bakin check llm
bakin check channels
bakin check plugin-assets
bakin check agent-assets
```

Run health checks when setup finishes:

```sh
bakin doctor
```
