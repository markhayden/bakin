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
      <td><code>2.2.2</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Brands<br/><span>Structured brand definitions — voice, palette, rules, and reference assets injected per-task so agent output stays on brand</span></td>
      <td><code>brands</code></td>
      <td>Core</td>
      <td><code>0.1.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Chat<br/><span>Direct conversations with your agents — streamed multi-chat sessions from the Bakin UI, runtime-agnostic via the adapter layer</span></td>
      <td><code>chat</code></td>
      <td>Core</td>
      <td><code>0.1.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Explore<br/><span>Discover and install official agents, plugins, and packs — the do-more-with-Bakin storefront</span></td>
      <td><code>explore</code></td>
      <td>Core</td>
      <td><code>0.1.0</code></td>
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
      <td>Health<br/><span>Action-first system health, Search readiness, diagnostics, and repair</span></td>
      <td><code>health</code></td>
      <td>Core</td>
      <td><code>1.4.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Images<br/><span>Provider-routed image generation, import, export, prompt routing, and platform surface profiles</span></td>
      <td><code>images</code></td>
      <td>Core</td>
      <td><code>0.1.0</code></td>
      <td><code>assets</code> <code>models</code></td>
    </tr>
    <tr>
      <td>Memory<br/><span>Observability dashboard over runtime memory tiers plus Bakin's audit log</span></td>
      <td><code>memory</code></td>
      <td>Core</td>
      <td><code>2.0.2</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Messaging<br/><span>Content messaging with scheduling, brainstorming, and multi-agent content pipeline</span></td>
      <td><code>messaging</code></td>
      <td>Official</td>
      <td><code>0.8.0</code></td>
      <td><code>team</code> <code>workflows</code></td>
    </tr>
    <tr>
      <td>Models<br/><span>Agent model configuration — per-agent models, aliases, available models, per-turn model/thinking routing, and spend/budget tracking</span></td>
      <td><code>models</code></td>
      <td>Core</td>
      <td><code>2.1.1</code></td>
      <td><code>team</code></td>
    </tr>
    <tr>
      <td>Projects<br/><span>Project management with specs, checklists, task linking, and agent access via MCP tools</span></td>
      <td><code>projects</code></td>
      <td>Official</td>
      <td><code>0.7.0</code></td>
      <td><code>tasks</code> <code>assets</code> <code>team</code></td>
    </tr>
    <tr>
      <td>Schedule<br/><span>Cron job scheduling through the runtime adapter with task creation</span></td>
      <td><code>schedule</code></td>
      <td>Core</td>
      <td><code>1.2.0</code></td>
      <td><code>tasks</code></td>
    </tr>
    <tr>
      <td>Tasks<br/><span>Kanban task management with Bakin task-store persistence, agent assignment, and dependency tracking</span></td>
      <td><code>tasks</code></td>
      <td>Core</td>
      <td><code>2.3.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Team<br/><span>Agent team management — adapter layer over runtime agent workspaces</span></td>
      <td><code>team</code></td>
      <td>Core</td>
      <td><code>1.2.0</code></td>
      <td>none</td>
    </tr>
    <tr>
      <td>Workflows<br/><span>Workflow runtime — enforces step-by-step agent execution with gated delivery, parallel steps, human gates, and output validation</span></td>
      <td><code>workflows</code></td>
      <td>Core</td>
      <td><code>2.1.0</code></td>
      <td><code>tasks</code></td>
    </tr>
  </tbody>
</table>

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Jul 30, 2026 · Bakin 0.0.0-dev</span>
</aside>
