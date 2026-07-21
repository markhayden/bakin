---
title: Defaults
description: Generated reference for Bakin core settings defaults.
---

<div class="settings-reference-intro">
  <p>Bakin starts with these values, then deep-merges anything you set in <code>settings.json</code>. Use this page when you need the exact key for CLI updates, automation, or troubleshooting.</p>
</div>

## AgentPackages

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.enabled</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.injectIntoDispatch</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.maxCharacters</code></td>
      <td><code>8000</code></td>
    </tr>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.maxLessons</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.mcpTool</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>agentPackages.lessonsRetrieval.minScore</code></td>
      <td><code>0</code></td>
    </tr>
  </tbody>
</table>

## Burn

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>burn.baselineDays</code></td>
      <td><code>7</code></td>
    </tr>
    <tr>
      <td><code>burn.minTokensFloor</code></td>
      <td><code>500000</code></td>
    </tr>
    <tr>
      <td><code>burn.spikeMultiplier</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>burn.unattributedFloorTokens</code></td>
      <td><code>100000</code></td>
    </tr>
    <tr>
      <td><code>burn.unattributedShare</code></td>
      <td><code>0.5</code></td>
    </tr>
    <tr>
      <td><code>burn.windowHours</code></td>
      <td><code>24</code></td>
    </tr>
  </tbody>
</table>

## Diagnostics

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>diagnostics.startup.enabled</code></td>
      <td><code>false</code></td>
    </tr>
    <tr>
      <td><code>diagnostics.startup.slowMs</code></td>
      <td><code>250</code></td>
    </tr>
  </tbody>
</table>

## Dispatch

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>dispatch.contextBudgetBytes</code></td>
      <td><code>65536</code></td>
    </tr>
    <tr>
      <td><code>dispatch.failureCooldownMs</code></td>
      <td><code>1800000</code></td>
    </tr>
    <tr>
      <td><code>dispatch.intervalMs</code></td>
      <td><code>300000</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxBrandContextBytes</code></td>
      <td><code>12288</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxConcurrentTurns</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxDispatched</code></td>
      <td><code>500</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxRetries</code></td>
      <td><code>5</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxTurnsPerAgent</code></td>
      <td><code>1</code></td>
    </tr>
    <tr>
      <td><code>dispatch.maxWorkflowContextBytes</code></td>
      <td><code>16384</code></td>
    </tr>
    <tr>
      <td><code>dispatch.oversizedOutputBytes</code></td>
      <td><code>131072</code></td>
    </tr>
    <tr>
      <td><code>dispatch.paused</code></td>
      <td><code>false</code></td>
    </tr>
    <tr>
      <td><code>dispatch.transientCooldownMs</code></td>
      <td><code>60000</code></td>
    </tr>
  </tbody>
</table>

## Doctor

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>doctor.checkTimeoutMs</code></td>
      <td><code>30000</code></td>
    </tr>
    <tr>
      <td><code>doctor.escalation</code></td>
      <td><code>&quot;task&quot;</code></td>
    </tr>
    <tr>
      <td><code>doctor.escalationCooldownMs</code></td>
      <td><code>21600000</code></td>
    </tr>
    <tr>
      <td><code>doctor.escalationStaleAfterMs</code></td>
      <td><code>43200000</code></td>
    </tr>
    <tr>
      <td><code>doctor.intervalMs</code></td>
      <td><code>1800000</code></td>
    </tr>
    <tr>
      <td><code>doctor.requireOnboard</code></td>
      <td><code>true</code></td>
    </tr>
  </tbody>
</table>

## Notifications

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>notifications.channel</code></td>
      <td><code>&quot;&quot;</code></td>
    </tr>
    <tr>
      <td><code>notifications.target</code></td>
      <td><code>&quot;&quot;</code></td>
    </tr>
  </tbody>
</table>

## Plugins

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>plugins.requireSignatures</code></td>
      <td><code>false</code></td>
    </tr>
    <tr>
      <td><code>plugins.runtimeCapabilityMode</code></td>
      <td><code>&quot;warn&quot;</code></td>
    </tr>
    <tr>
      <td><code>plugins.trustedSigners</code></td>
      <td><code>[]</code></td>
    </tr>
  </tbody>
</table>

## Restart Recovery

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>restartRecovery.enabled</code></td>
      <td><code>true</code></td>
    </tr>
  </tbody>
</table>

## Runtime

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>runtime.adapter</code></td>
      <td><code>&quot;openclaw&quot;</code></td>
    </tr>
  </tbody>
</table>

## Search

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>search.adapter</code></td>
      <td><code>&quot;antfly&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.auditTtl</code></td>
      <td><code>&quot;90d&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.chunking.defaultOverlapTokens</code></td>
      <td><code>25</code></td>
    </tr>
    <tr>
      <td><code>search.settings.chunking.defaultTargetTokens</code></td>
      <td><code>200</code></td>
    </tr>
    <tr>
      <td><code>search.settings.cleanupInterval</code></td>
      <td><code>&quot;7d&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.default.dimension</code></td>
      <td><code>384</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.default.model</code></td>
      <td><code>&quot;BAAI/bge-small-en-v1.5&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.default.provider</code></td>
      <td><code>&quot;antfly&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.visual.dimension</code></td>
      <td><code>512</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.visual.model</code></td>
      <td><code>&quot;antflydb/clipclap&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.embedders.visual.provider</code></td>
      <td><code>&quot;antfly&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.enabled</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.defaultLimit</code></td>
      <td><code>20</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.queryBudgetMs</code></td>
      <td><code>2000</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.reranker.enabled</code></td>
      <td><code>false</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.reranker.model</code></td>
      <td><code>&quot;mixedbread-ai/mxbai-rerank-base-v1&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.reranker.provider</code></td>
      <td><code>&quot;antfly&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.search.strategy</code></td>
      <td><code>&quot;rrf&quot;</code></td>
    </tr>
    <tr>
      <td><code>search.settings.url</code></td>
      <td><code>&quot;http://127.0.0.1:3738&quot;</code></td>
    </tr>
  </tbody>
</table>

## Service

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>service.enabled</code></td>
      <td><code>false</code></td>
    </tr>
  </tbody>
</table>

## SSE

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>sse.keepAliveMs</code></td>
      <td><code>30000</code></td>
    </tr>
    <tr>
      <td><code>sse.maxClients</code></td>
      <td><code>50</code></td>
    </tr>
  </tbody>
</table>

## Watchdog

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>watchdog.autoRecover</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>watchdog.intervalMs</code></td>
      <td><code>300000</code></td>
    </tr>
    <tr>
      <td><code>watchdog.maxAutoRecoveries</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>watchdog.mcpAlertCooldownMs</code></td>
      <td><code>300000</code></td>
    </tr>
    <tr>
      <td><code>watchdog.mcpErrorThreshold</code></td>
      <td><code>0.5</code></td>
    </tr>
    <tr>
      <td><code>watchdog.mcpMinSamples</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>watchdog.mcpWindowMs</code></td>
      <td><code>60000</code></td>
    </tr>
    <tr>
      <td><code>watchdog.restAlertCooldownMs</code></td>
      <td><code>300000</code></td>
    </tr>
    <tr>
      <td><code>watchdog.restErrorThreshold</code></td>
      <td><code>0.5</code></td>
    </tr>
    <tr>
      <td><code>watchdog.restMinSamples</code></td>
      <td><code>3</code></td>
    </tr>
    <tr>
      <td><code>watchdog.restWindowMs</code></td>
      <td><code>60000</code></td>
    </tr>
    <tr>
      <td><code>watchdog.stuckThresholdMs</code></td>
      <td><code>1800000</code></td>
    </tr>
  </tbody>
</table>

## Workflow

<table class="settings-defaults-table">
  <thead>
    <tr><th>Key</th><th>Default</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>workflow.enforceAgentScoping</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>workflow.enforceWorkflowDoneGuard</code></td>
      <td><code>true</code></td>
    </tr>
    <tr>
      <td><code>workflow.maxRedispatches</code></td>
      <td><code>2</code></td>
    </tr>
    <tr>
      <td><code>workflow.rejectRepeatThreshold</code></td>
      <td><code>0.95</code></td>
    </tr>
    <tr>
      <td><code>workflow.stepTimeoutMs</code></td>
      <td><code>3600000</code></td>
    </tr>
  </tbody>
</table>


<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Jul 21, 2026 · Bakin 0.0.0-dev</span>
</aside>
