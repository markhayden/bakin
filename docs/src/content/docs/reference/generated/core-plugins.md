---
title: Official Plugins
description: Generated catalog of official plugins supported by Bakin.
---

<div class="plugin-catalog-intro">
  <p>Official plugins are maintained with Bakin and documented as supported product surfaces. Core plugins ship in this repo; official plugins can also live in the official plugin repo.</p>
</div>

<table class="plugin-catalog-table">
  <thead>
    <tr><th>Plugin</th><th>ID</th><th>Source</th><th>Version</th><th>Depends On</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Assets<br/><span>Centralized content store for all artifacts with rich rendering, search, task linking, manual upload, and clipboard paste</span></td>
      <td><code>assets</code></td>
      <td>Core</td>
      <td><code>2.0.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Git<br/><span>Git worktree isolation for agent code work</span></td>
      <td><code>git</code></td>
      <td>Core</td>
      <td><code>1.0.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Health<br/><span>System health dashboard — MCP stats, diagnostics, and uptime</span></td>
      <td><code>health</code></td>
      <td>Core</td>
      <td><code>1.0.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Memory<br/><span>Observability dashboard over runtime memory tiers plus Bakin's audit log</span></td>
      <td><code>memory</code></td>
      <td>Core</td>
      <td><code>2.0.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Messaging<br/><span>Content messaging with scheduling, brainstorming, and multi-agent content pipeline</span></td>
      <td><code>messaging</code></td>
      <td>Official</td>
      <td><code>1.0.0</code></td>
      <td><code>team</code> <code>workflows</code></td>
    </tr>
    <tr>
      <td>Models<br/><span>Agent model configuration — per-agent models, aliases, task profiles, available models from Anthropic API</span></td>
      <td><code>models</code></td>
      <td>Core</td>
      <td><code>2.1.0</code></td>
      <td><code>team</code></td>
    </tr>
    <tr>
      <td>Projects<br/><span>Project management with specs, checklists, task linking, and agent access via MCP tools</span></td>
      <td><code>projects</code></td>
      <td>Official</td>
      <td><code>1.0.0</code></td>
      <td><code>tasks</code> <code>assets</code> <code>team</code></td>
    </tr>
    <tr>
      <td>Schedule<br/><span>Cron job scheduling through the runtime adapter with task creation</span></td>
      <td><code>schedule</code></td>
      <td>Core</td>
      <td><code>1.0.0</code></td>
      <td><code>tasks</code></td>
    </tr>
    <tr>
      <td>Tasks<br/><span>Kanban task management with Bakin task-store persistence, agent assignment, and dependency tracking</span></td>
      <td><code>tasks</code></td>
      <td>Core</td>
      <td><code>2.1.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Team<br/><span>Agent team management — adapter layer over runtime agent workspaces</span></td>
      <td><code>team</code></td>
      <td>Core</td>
      <td><code>1.0.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Workflows<br/><span>Workflow runtime — enforces step-by-step agent execution with gated delivery, parallel steps, human gates, and output validation</span></td>
      <td><code>workflows</code></td>
      <td>Core</td>
      <td><code>2.0.0</code></td>
      <td><code>tasks</code></td>
    </tr>
  </tbody>
</table>

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated May 6, 2026 · Bakin 0.0.0-dev</span>
</aside>
