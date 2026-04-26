---
title: Architecture
description: Conceptual architecture and implementation map for Bakin.
---

Architecture docs are split into stable contracts and current implementation details.

## Stable Contract

Bakin exposes public contracts through the CLI, HTTP routes, SDK exports, hooks, slots, plugin manifests, settings, and agent package conventions.

## Current Implementation

The current implementation is organized around:

- `server.ts` for the HTTP entry point and binary startup path
- `packages/core` for shared runtime contracts and utilities
- `packages/sdk` for plugin-author imports
- `packages/host` for the React host shell and API files
- `src/core` for server subsystems
- `src/lib` for shared side-effect-light logic
- `plugins/*` for shipped core plugins
- `scripts/*` for build, release, and generation tooling

Generated source links point to release-tag GitHub URLs after open-source launch.
