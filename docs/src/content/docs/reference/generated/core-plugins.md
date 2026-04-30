---
title: Core Plugin Catalog
description: Generated catalog of core plugins shipped with Bakin.
---

## Assets

Centralized content store for all artifacts with rich rendering, search, task linking, manual upload, and clipboard paste

- ID: `assets`
- Version: `2.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/assets/bakin-plugin.json`
- Dependencies: `none`
- Permissions: `storage.read`, `storage.write`, `events.emit`

## Health

System health dashboard — MCP stats, diagnostics, and uptime

- ID: `health`
- Version: `1.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/health/bakin-plugin.json`
- Dependencies: `none`
- Permissions: `storage.read`

## Memory

Observability dashboard over runtime memory tiers plus Bakin's audit log

- ID: `memory`
- Version: `2.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/memory/bakin-plugin.json`
- Dependencies: `none`
- Permissions: `storage.read`, `events.emit`, `runtime.read`

## Models

Agent model configuration — per-agent models, aliases, task profiles, available models from Anthropic API

- ID: `models`
- Version: `2.1.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/models/bakin-plugin.json`
- Dependencies: `team`
- Permissions: `storage.read`, `storage.write`, `events.emit`

## Schedule

Cron job scheduling through the runtime adapter with task creation

- ID: `schedule`
- Version: `1.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/schedule/bakin-plugin.json`
- Dependencies: `tasks`
- Permissions: `storage.read`, `storage.write`, `events.emit`

## Tasks

Kanban task management with Bakin task-store persistence, agent assignment, and dependency tracking

- ID: `tasks`
- Version: `2.1.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/tasks/bakin-plugin.json`
- Dependencies: `none`
- Permissions: `storage.read`, `storage.write`, `events.emit`

## Team

Agent team management — adapter layer over runtime agent workspaces

- ID: `team`
- Version: `1.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/team/bakin-plugin.json`
- Dependencies: `none`
- Permissions: `storage.read`, `storage.write`, `events.emit`

## Workflows

Workflow runtime — enforces step-by-step agent execution with gated delivery, parallel steps, human gates, and output validation

- ID: `workflows`
- Version: `2.0.0`
- Bakin compatibility: `>=1.0.0`
- Manifest: `plugins/workflows/bakin-plugin.json`
- Dependencies: `tasks`
- Permissions: `storage.read`, `storage.write`, `events.emit`

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Apr 29, 2026 · Bakin 1.0.0</span>
</aside>
