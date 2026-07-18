---
title: Runtime Paths
description: Reference for Bakin runtime files under the resolved Bakin home directory.
---

<div class="runtime-paths-intro">
  <p>Bakin keeps local state under one home directory. Use these keys when you need to find logs, settings, assets, task metadata, workflow state, or other files created by the runtime.</p>
</div>

## Home Resolution

<table class="runtime-paths-table">
  <thead>
    <tr><th>Source</th><th>When Used</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>BAKIN_HOME</code></td>
      <td>Used when the environment variable is set.</td>
    </tr>
    <tr>
      <td><code>~/.bakin/</code></td>
      <td>Default location when no override is present.</td>
    </tr>
  </tbody>
</table>

## Path Keys

<table class="runtime-paths-table">
  <thead>
    <tr><th>Key</th><th>Purpose</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>home</code></td>
      <td>Resolved Bakin home directory.</td>
    </tr>
    <tr>
      <td><code>settings</code></td>
      <td>Runtime settings file.</td>
    </tr>
    <tr>
      <td><code>memoryLog</code></td>
      <td>Shared memory log.</td>
    </tr>
    <tr>
      <td><code>audit</code></td>
      <td>Append-only audit log.</td>
    </tr>
    <tr>
      <td><code>logs</code></td>
      <td>Server and runtime logs.</td>
    </tr>
    <tr>
      <td><code>assets</code></td>
      <td>Asset runtime root.</td>
    </tr>
    <tr>
      <td><code>assets.store</code></td>
      <td>Month-sharded asset files.</td>
    </tr>
    <tr>
      <td><code>assets.inbox</code></td>
      <td>Asset ingestion inbox.</td>
    </tr>
    <tr>
      <td><code>assets.trash</code></td>
      <td>Soft-deleted asset files.</td>
    </tr>
    <tr>
      <td><code>agents</code></td>
      <td>Agent runtime assets.</td>
    </tr>
    <tr>
      <td><code>team</code></td>
      <td>Team runtime data.</td>
    </tr>
    <tr>
      <td><code>personas</code></td>
      <td>Agent persona files.</td>
    </tr>
    <tr>
      <td><code>heartbeats</code></td>
      <td>Agent heartbeat files.</td>
    </tr>
    <tr>
      <td><code>inbox</code></td>
      <td>General inbox directory.</td>
    </tr>
    <tr>
      <td><code>tasks</code></td>
      <td>Task metadata store.</td>
    </tr>
    <tr>
      <td><code>workflows</code></td>
      <td>Workflow definitions, skills, and instances.</td>
    </tr>
  </tbody>
</table>

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Jul 17, 2026 · Bakin 0.0.0-dev</span>
</aside>
