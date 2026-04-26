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

- a `~/.bakin/` directory
- default settings
- validated OpenClaw configuration
- at least one LLM provider path
- at least one messaging channel path when messaging is enabled

Run health checks when setup finishes:

```sh
bakin doctor
```
