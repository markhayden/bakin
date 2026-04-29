---
title: Settings Reference
description: Generated reference for Bakin settings keys and default values.
---

Docs version: Bakin 1.0.0

This page is generated from `packages/core/src/settings.ts`.

Bakin reads settings from `settings.json` in the resolved Bakin home directory and deep-merges user values over these defaults.

| Key | Default |
| --- | --- |
| `runtime.adapter` | `"openclaw"` |
| `search.adapter` | `"antfly"` |
| `search.settings.enabled` | `true` |
| `search.settings.url` | `"http://localhost:8080/api/v1"` |
| `search.settings.search.strategy` | `"rrf"` |
| `search.settings.search.defaultLimit` | `20` |
| `search.settings.search.reranker.enabled` | `true` |
| `search.settings.search.reranker.provider` | `"termite"` |
| `search.settings.search.reranker.model` | `"mixedbread-ai/mxbai-rerank-base-v1"` |
| `search.settings.search.reranker.threshold` | `0` |
| `search.settings.embedders.default.provider` | `"termite"` |
| `search.settings.embedders.default.model` | `"BAAI/bge-small-en-v1.5"` |
| `search.settings.embedders.visual.provider` | `"termite"` |
| `search.settings.embedders.visual.model` | `"openai/clip-vit-base-patch32"` |
| `search.settings.chunking.defaultTargetTokens` | `200` |
| `search.settings.chunking.defaultOverlapTokens` | `25` |
| `search.settings.auditTtl` | `"90d"` |
| `search.settings.cleanupInterval` | `"7d"` |
| `dispatch.intervalMs` | `300000` |
| `dispatch.failureCooldownMs` | `1800000` |
| `dispatch.transientCooldownMs` | `60000` |
| `dispatch.maxDispatched` | `500` |
| `dispatch.maxRetries` | `5` |
| `watchdog.intervalMs` | `300000` |
| `watchdog.stuckThresholdMs` | `1800000` |
| `watchdog.autoRecover` | `true` |
| `watchdog.maxAutoRecoveries` | `3` |
| `watchdog.mcpWindowMs` | `60000` |
| `watchdog.mcpErrorThreshold` | `0.5` |
| `watchdog.mcpMinSamples` | `3` |
| `watchdog.mcpAlertCooldownMs` | `300000` |
| `watchdog.restWindowMs` | `60000` |
| `watchdog.restErrorThreshold` | `0.5` |
| `watchdog.restMinSamples` | `3` |
| `watchdog.restAlertCooldownMs` | `300000` |
| `sse.maxClients` | `50` |
| `sse.keepAliveMs` | `30000` |
| `doctor.intervalMs` | `1800000` |
| `doctor.autoFixSkill` | `true` |
| `doctor.requireOnboard` | `true` |
| `service.enabled` | `false` |
| `notifications.channel` | `""` |
| `notifications.gateAlerts` | `true` |
| `workflow.stepTimeoutMs` | `3600000` |
| `workflow.maxRedispatches` | `2` |
| `workflow.rejectRepeatThreshold` | `0.95` |
| `workflow.enforceAgentScoping` | `true` |
| `workflow.enforceWorkflowDoneGuard` | `true` |
| `plugins.runtimeCapabilityMode` | `"warn"` |
