---
title: Settings Reference
description: Generated reference for Bakin settings keys and default values.
---

# Settings Reference

Docs version: Bakin 1.0.0

This page is generated from `packages/core/src/settings.ts`.

Bakin reads settings from `settings.json` in the resolved Bakin home directory and deep-merges user values over these defaults.

| Key | Default |
| --- | --- |
| `dispatch.intervalMs` | `300000` |
| `dispatch.failureCooldownMs` | `1800000` |
| `dispatch.transientCooldownMs` | `60000` |
| `dispatch.maxDispatched` | `500` |
| `dispatch.maxRetries` | `5` |
| `watchdog.intervalMs` | `300000` |
| `watchdog.stuckThresholdMs` | `1800000` |
| `watchdog.alertChannelId` | `"1483917792745885768"` |
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
| `messaging.intervalMs` | `300000` |
| `sse.maxClients` | `50` |
| `sse.keepAliveMs` | `30000` |
| `openclaw.binaryPath` | `"/opt/homebrew/bin/openclaw"` |
| `openclaw.gatewayUrl` | `"http://127.0.0.1"` |
| `openclaw.gatewayPort` | `18789` |
| `antfly.enabled` | `true` |
| `antfly.url` | `"http://localhost:8080/api/v1"` |
| `antfly.search.strategy` | `"rrf"` |
| `antfly.search.defaultLimit` | `20` |
| `antfly.search.reranker.enabled` | `true` |
| `antfly.search.reranker.provider` | `"termite"` |
| `antfly.search.reranker.model` | `"mixedbread-ai/mxbai-rerank-base-v1"` |
| `antfly.search.reranker.threshold` | `0` |
| `antfly.embedders.default.provider` | `"termite"` |
| `antfly.embedders.default.model` | `"BAAI/bge-small-en-v1.5"` |
| `antfly.embedders.visual.provider` | `"termite"` |
| `antfly.embedders.visual.model` | `"openai/clip-vit-base-patch32"` |
| `antfly.chunking.defaultTargetTokens` | `200` |
| `antfly.chunking.defaultOverlapTokens` | `25` |
| `antfly.auditTtl` | `"90d"` |
| `antfly.cleanupInterval` | `"7d"` |
| `doctor.intervalMs` | `1800000` |
| `doctor.autoFixSkill` | `true` |
| `doctor.requireOnboard` | `true` |
| `service.enabled` | `false` |
| `notifications.channel` | `"none"` |
| `notifications.target` | `""` |
| `notifications.gateAlerts` | `true` |
| `workflow.stepTimeoutMs` | `3600000` |
| `workflow.maxRedispatches` | `2` |
| `workflow.rejectRepeatThreshold` | `0.95` |
| `workflow.enforceAgentScoping` | `true` |
| `workflow.enforceWorkflowDoneGuard` | `true` |
