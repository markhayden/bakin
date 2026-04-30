---
title: CLI
description: Generated reference for public Bakin CLI commands.
---

<div class="cli-reference-intro">
  <p>The Bakin CLI is the fastest way to run local setup, check health, manage tasks, install plugins, and script repeatable work. Use it when you want a direct command instead of clicking through the dashboard, or when you need Bakin actions inside shell scripts and automation.</p>
</div>

## Popular

<div class="cli-common-grid">
<a class="cli-common-card" href="#start">
  <code>bakin start</code>
  <span>Start the Bakin server.</span>
</a>
<a class="cli-common-card" href="#onboard">
  <code>bakin onboard</code>
  <span>Run first-time onboarding.</span>
</a>
<a class="cli-common-card" href="#doctor">
  <code>bakin doctor</code>
  <span>Run health checks.</span>
</a>
<a class="cli-common-card" href="#tasks-list">
  <code>bakin tasks list</code>
  <span>List tasks.</span>
</a>
<a class="cli-common-card" href="#tasks-create">
  <code>bakin tasks create &lt;title&gt;</code>
  <span>Create a task.</span>
</a>
<a class="cli-common-card" href="#plugins-install">
  <code>bakin plugins install &lt;source&gt;</code>
  <span>Install a plugin.</span>
</a>
<a class="cli-common-card" href="#search">
  <code>bakin search &lt;query&gt;</code>
  <span>Search indexed content.</span>
</a>
</div>

## Agent Packages

<p class="cli-section-description">Agent package commands install and maintain reusable agent definitions, bundled knowledge, prompts, and rules that Bakin manages as local agent state.</p>

<div class="cli-command-list">
<section class="cli-command" id="agents-install">
  <div class="cli-command__heading">
    <code>agents install</code>
    <span class="cli-command__summary">Install an agent package.</span>
    <a class="cli-command__anchor" href="#agents-install" aria-label="Link to agents install"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs or adopts an agent package into Bakin/runtime-managed agent state.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">install</span> <span class="cli-token cli-token--arg">&lt;source&gt;</span> <span class="cli-token cli-token--option">[--adopt]</span> <span class="cli-token cli-token--option">[--install-as &lt;id&gt;]</span> <span class="cli-token cli-token--option">[--replace]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents install &lt;path|github:user/repo[@ref]&gt; [--adopt] [--install-as &lt;id&gt;] [--replace]" aria-label="Copy bakin agents install &lt;path|github:user/repo[@ref]&gt; [--adopt] [--install-as &lt;id&gt;] [--replace]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;source&gt;</code><span class="cli-command__choices"><span>path</span><span>github:user/repo[@ref]</span></span></td><td>choice</td><td>yes</td><td>Choose one of these values.</td></tr>
      <tr><td><code>[--adopt]</code></td><td>option</td><td>no</td><td>Adopt an existing runtime agent.</td></tr>
      <tr><td><code>[--install-as &lt;id&gt;]</code></td><td>option</td><td>no</td><td>Optional flag.</td></tr>
      <tr><td><code>[--replace]</code></td><td>option</td><td>no</td><td>Replace an existing install.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-remove">
  <div class="cli-command__heading">
    <code>agents remove</code>
    <span class="cli-command__summary">Remove an agent package.</span>
    <a class="cli-command__anchor" href="#agents-remove" aria-label="Link to agents remove"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Removes an installed agent package and optionally deletes the runtime agent.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">remove</span> <span class="cli-token cli-token--arg">&lt;agent-id&gt;</span> <span class="cli-token cli-token--option">[--keep-blocks]</span> <span class="cli-token cli-token--option">[--delete-agent]</span> <span class="cli-token cli-token--option">[--force]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents remove &lt;agent-id&gt; [--keep-blocks] [--delete-agent] [--force]" aria-label="Copy bakin agents remove &lt;agent-id&gt; [--keep-blocks] [--delete-agent] [--force]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;agent-id&gt;</code></td><td>argument</td><td>yes</td><td>Agent id to install, update, remove, or inspect.</td></tr>
      <tr><td><code>[--keep-blocks]</code></td><td>option</td><td>no</td><td>Leave managed blocks on disk.</td></tr>
      <tr><td><code>[--delete-agent]</code></td><td>option</td><td>no</td><td>Delete the runtime agent too.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-update">
  <div class="cli-command__heading">
    <code>agents update</code>
    <span class="cli-command__summary">Update agent packages.</span>
    <a class="cli-command__anchor" href="#agents-update" aria-label="Link to agents update"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Updates one or all installed agent packages.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">update</span> <span class="cli-token cli-token--option">[agent-id]</span> <span class="cli-token cli-token--option">[--refresh-template]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents update [agent-id] [--refresh-template]" aria-label="Copy bakin agents update [agent-id] [--refresh-template]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[agent-id]</code></td><td>argument</td><td>no</td><td>Agent id to install, update, remove, or inspect.</td></tr>
      <tr><td><code>[--refresh-template]</code></td><td>option</td><td>no</td><td>Refresh generated package template files.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-knowledge">
  <div class="cli-command__heading">
    <code>agents knowledge</code>
    <span class="cli-command__summary">Manage agent knowledge toggles.</span>
    <a class="cli-command__anchor" href="#agents-knowledge" aria-label="Link to agents knowledge"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists or toggles lesson/knowledge blocks for an agent package.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">knowledge</span> <span class="cli-token cli-token--arg">&lt;action&gt;</span> <span class="cli-token">...</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents knowledge &lt;list|enable|disable&gt; ..." aria-label="Copy bakin agents knowledge &lt;list|enable|disable&gt; ...">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;action&gt;</code><span class="cli-command__choices"><span>list</span><span>enable</span><span>disable</span></span></td><td>choice</td><td>yes</td><td>Knowledge action.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="packages-install">
  <div class="cli-command__heading">
    <code>packages install</code>
    <span class="cli-command__summary">Install a package.</span>
    <a class="cli-command__anchor" href="#packages-install" aria-label="Link to packages install"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs a standalone package.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">packages</span> <span class="cli-token">install</span> <span class="cli-token cli-token--arg">&lt;source&gt;</span> <span class="cli-token cli-token--option">[--install-as &lt;id&gt;]</span> <span class="cli-token cli-token--option">[--replace]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin packages install &lt;path|github:user/repo[@ref]&gt; [--install-as &lt;id&gt;] [--replace]" aria-label="Copy bakin packages install &lt;path|github:user/repo[@ref]&gt; [--install-as &lt;id&gt;] [--replace]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;source&gt;</code><span class="cli-command__choices"><span>path</span><span>github:user/repo[@ref]</span></span></td><td>choice</td><td>yes</td><td>Choose one of these values.</td></tr>
      <tr><td><code>[--install-as &lt;id&gt;]</code></td><td>option</td><td>no</td><td>Optional flag.</td></tr>
      <tr><td><code>[--replace]</code></td><td>option</td><td>no</td><td>Replace an existing install.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="packages-list">
  <div class="cli-command__heading">
    <code>packages list</code>
    <span class="cli-command__summary">List packages.</span>
    <a class="cli-command__anchor" href="#packages-list" aria-label="Link to packages list"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists installed packages.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">packages</span> <span class="cli-token">list</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin packages list" aria-label="Copy bakin packages list">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="packages-remove">
  <div class="cli-command__heading">
    <code>packages remove</code>
    <span class="cli-command__summary">Remove a package.</span>
    <a class="cli-command__anchor" href="#packages-remove" aria-label="Link to packages remove"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Removes an installed package.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">packages</span> <span class="cli-token">remove</span> <span class="cli-token cli-token--arg">&lt;package-id&gt;</span> <span class="cli-token cli-token--option">[--force]</span> <span class="cli-token cli-token--option">[--keep-blocks]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin packages remove &lt;package-id&gt; [--force] [--keep-blocks]" aria-label="Copy bakin packages remove &lt;package-id&gt; [--force] [--keep-blocks]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;package-id&gt;</code></td><td>argument</td><td>yes</td><td>Package id.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
      <tr><td><code>[--keep-blocks]</code></td><td>option</td><td>no</td><td>Leave managed blocks on disk.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="packages-update">
  <div class="cli-command__heading">
    <code>packages update</code>
    <span class="cli-command__summary">Update a package.</span>
    <a class="cli-command__anchor" href="#packages-update" aria-label="Link to packages update"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Updates an installed package.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">packages</span> <span class="cli-token">update</span> <span class="cli-token cli-token--arg">&lt;package-id&gt;</span> <span class="cli-token cli-token--option">[--refresh-template]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin packages update &lt;package-id&gt; [--refresh-template]" aria-label="Copy bakin packages update &lt;package-id&gt; [--refresh-template]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;package-id&gt;</code></td><td>argument</td><td>yes</td><td>Package id.</td></tr>
      <tr><td><code>[--refresh-template]</code></td><td>option</td><td>no</td><td>Refresh generated package template files.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Agents

<p class="cli-section-description">Use these commands to inspect registered agents, review their status and assignments, and send direct messages without opening the dashboard.</p>

<div class="cli-command-list">
<section class="cli-command" id="agents-list">
  <div class="cli-command__heading">
    <code>agents list</code>
    <span class="cli-command__summary">List agents.</span>
    <a class="cli-command__anchor" href="#agents-list" aria-label="Link to agents list"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists runtime agents, or package state when `--packages` is set.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">list</span> <span class="cli-token cli-token--option">[--packages]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents list [--packages]" aria-label="Copy bakin agents list [--packages]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--packages]</code></td><td>option</td><td>no</td><td>Show package state instead of the runtime roster.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-status">
  <div class="cli-command__heading">
    <code>agents status</code>
    <span class="cli-command__summary">Get agent status.</span>
    <a class="cli-command__anchor" href="#agents-status" aria-label="Link to agents status"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Fetches detailed status for an agent.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">status</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents status &lt;id&gt;" aria-label="Copy bakin agents status &lt;id&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-tasks">
  <div class="cli-command__heading">
    <code>agents tasks</code>
    <span class="cli-command__summary">List tasks assigned to an agent.</span>
    <a class="cli-command__anchor" href="#agents-tasks" aria-label="Link to agents tasks"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists tasks currently assigned to an agent.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">tasks</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents tasks &lt;id&gt;" aria-label="Copy bakin agents tasks &lt;id&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agents-send">
  <div class="cli-command__heading">
    <code>agents send</code>
    <span class="cli-command__summary">Send a message to an agent.</span>
    <a class="cli-command__anchor" href="#agents-send" aria-label="Link to agents send"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Sends a message through the running server to an agent.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agents</span> <span class="cli-token">send</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;message&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agents send &lt;id&gt; &lt;message&gt;" aria-label="Copy bakin agents send &lt;id&gt; &lt;message&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;message&gt;</code></td><td>argument</td><td>yes</td><td>Message text.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Assets

<p class="cli-section-description">Asset maintenance currently focuses on the trash flow: reviewing soft-deleted assets, restoring them, or purging them permanently.</p>

<div class="cli-command-list">
<section class="cli-command" id="trash">
  <div class="cli-command__heading">
    <code>trash</code>
    <span class="cli-command__summary">Manage trashed assets.</span>
    <a class="cli-command__anchor" href="#trash" aria-label="Link to trash"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists, restores, or permanently empties soft-deleted assets.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">trash</span> <span class="cli-token cli-token--option">[action]</span> <span class="cli-token">...</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin trash [list|restore|empty] ..." aria-label="Copy bakin trash [list|restore|empty] ...">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[action]</code><span class="cli-command__choices"><span>list</span><span>restore</span><span>empty</span></span></td><td>choice</td><td>no</td><td>Trash action.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Diagnostics and Paths

<p class="cli-section-description">Diagnostics commands expose the information needed when something is not behaving as expected: logs, resolved paths, health checks, API docs, and generated agent rules.</p>

<div class="cli-command-list">
<section class="cli-command" id="doctor">
  <div class="cli-command__heading">
    <code>doctor</code>
    <span class="cli-command__summary">Run health checks.</span>
    <a class="cli-command__anchor" href="#doctor" aria-label="Link to doctor"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Runs Bakin diagnostics for local dependencies, server state, agents, plugin assets, runtime behavior, and recoverable issues.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">doctor</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin doctor" aria-label="Copy bakin doctor">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="paths">
  <div class="cli-command__heading">
    <code>paths</code>
    <span class="cli-command__summary">Show content directory paths.</span>
    <a class="cli-command__anchor" href="#paths" aria-label="Link to paths"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Prints Bakin runtime paths, optionally for one key.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">paths</span> <span class="cli-token cli-token--option">[key]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin paths [key]" aria-label="Copy bakin paths [key]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[key]</code></td><td>argument</td><td>no</td><td>Dot-notation settings key.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="agent-rules">
  <div class="cli-command__heading">
    <code>agent-rules</code>
    <span class="cli-command__summary">Manage orchestrator rules blocks.</span>
    <a class="cli-command__anchor" href="#agent-rules" aria-label="Link to agent-rules"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Applies or checks managed AGENTS.md rule blocks.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">agent-rules</span> <span class="cli-token cli-token--option">[value]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin agent-rules [--apply|--check|--apply-all|--check-all]" aria-label="Copy bakin agent-rules [--apply|--check|--apply-all|--check-all]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--apply]</code></td><td>option</td><td>no</td><td>Apply the managed block.</td></tr>
      <tr><td><code>[--check]</code></td><td>option</td><td>no</td><td>Dry-run; report what would change.</td></tr>
      <tr><td><code>[--apply-all]</code></td><td>option</td><td>no</td><td>Apply managed blocks for all agents.</td></tr>
      <tr><td><code>[--check-all]</code></td><td>option</td><td>no</td><td>Check managed blocks for all agents.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="logs">
  <div class="cli-command__heading">
    <code>logs</code>
    <span class="cli-command__summary">Tail audit logs.</span>
    <a class="cli-command__anchor" href="#logs" aria-label="Link to logs"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Prints audit log entries, optionally filtered by event type or agent.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">logs</span> <span class="cli-token cli-token--option">[filter]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin logs [filter]" aria-label="Copy bakin logs [filter]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[filter]</code></td><td>argument</td><td>no</td><td>Optional log filter.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="docs">
  <div class="cli-command__heading">
    <code>docs</code>
    <span class="cli-command__summary">Print API documentation from the running server.</span>
    <a class="cli-command__anchor" href="#docs" aria-label="Link to docs"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Fetches current API route documentation from `/api/docs`.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">docs</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin docs" aria-label="Copy bakin docs">Copy</button>
  </div>
  </div>
</section>
</div>

## First-Time Setup

<p class="cli-section-description">These commands create the local directories and baseline settings Bakin needs before normal operation. They are most useful on a fresh machine or when repairing a partially configured install.</p>

<div class="cli-command-list">
<section class="cli-command" id="mkdir">
  <div class="cli-command__heading">
    <code>mkdir</code>
    <span class="cli-command__summary">Create the Bakin home directory tree.</span>
    <a class="cli-command__anchor" href="#mkdir" aria-label="Link to mkdir"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Creates or verifies the `~/.bakin` directory tree.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">mkdir</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin mkdir" aria-label="Copy bakin mkdir">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="check">
  <div class="cli-command__heading">
    <code>check</code>
    <span class="cli-command__summary">Run onboarding checks.</span>
    <a class="cli-command__anchor" href="#check" aria-label="Link to check"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Runs one or all first-run readiness checks.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">check</span> <span class="cli-token cli-token--arg">&lt;target&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin check &lt;runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all&gt;" aria-label="Copy bakin check &lt;runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;target&gt;</code><span class="cli-command__choices"><span>runtime</span><span>search</span><span>search-models</span><span>llm</span><span>channels</span><span>plugin-assets</span><span>agent-assets</span><span>recommended-plugins</span><span>all</span></span></td><td>choice</td><td>yes</td><td>Check target.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="install">
  <div class="cli-command__heading">
    <code>install</code>
    <span class="cli-command__summary">Install onboarding components.</span>
    <a class="cli-command__anchor" href="#install" aria-label="Link to install"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs Bakin dependencies, plugin/agent assets, or official recommended plugins.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">install</span> <span class="cli-token cli-token--arg">&lt;component&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin install &lt;search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins&gt;" aria-label="Copy bakin install &lt;search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;component&gt;</code><span class="cli-command__choices"><span>search</span><span>search-models</span><span>mcporter</span><span>plugin-assets</span><span>agent-assets</span><span>recommended-plugins</span></span></td><td>choice</td><td>yes</td><td>Install target.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="onboard">
  <div class="cli-command__heading">
    <code>onboard</code>
    <span class="cli-command__summary">Run first-time onboarding.</span>
    <a class="cli-command__anchor" href="#onboard" aria-label="Link to onboard"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Runs the full first-run setup flow.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">onboard</span> <span class="cli-token cli-token--option">[--check]</span> <span class="cli-token cli-token--option">[--yes]</span> <span class="cli-token cli-token--option">[--json]</span> <span class="cli-token cli-token--option">[--force]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin onboard [--check] [--yes] [--json] [--force]" aria-label="Copy bakin onboard [--check] [--yes] [--json] [--force]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--check]</code></td><td>option</td><td>no</td><td>Dry-run; report what would change.</td></tr>
      <tr><td><code>[--yes]</code></td><td>option</td><td>no</td><td>Accept all defaults non-interactively.</td></tr>
      <tr><td><code>[--json]</code></td><td>option</td><td>no</td><td>Emit machine-readable output.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Lifecycle

<p class="cli-section-description">Use these commands to run the local server, check whether it is healthy, restart it after configuration changes, and keep the installed CLI current.</p>

<div class="cli-command-list">
<section class="cli-command" id="start">
  <div class="cli-command__heading">
    <code>start</code>
    <span class="cli-command__summary">Start the Bakin server.</span>
    <a class="cli-command__anchor" href="#start" aria-label="Link to start"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Starts the Bakin HTTP server and dashboard. This is the default command when the compiled binary is launched without arguments.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">start</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin start" aria-label="Copy bakin start">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="stop">
  <div class="cli-command__heading">
    <code>stop</code>
    <span class="cli-command__summary">Stop a running Bakin server.</span>
    <a class="cli-command__anchor" href="#stop" aria-label="Link to stop"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Finds a running Bakin process and sends SIGTERM.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">stop</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin stop" aria-label="Copy bakin stop">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="restart">
  <div class="cli-command__heading">
    <code>restart</code>
    <span class="cli-command__summary">Restart the Bakin server.</span>
    <a class="cli-command__anchor" href="#restart" aria-label="Link to restart"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Restarts Bakin using the available service manager or standalone process behavior.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">restart</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin restart" aria-label="Copy bakin restart">Copy</button>
  </div>
  <p class="cli-command__meta">Aliases: <code>reboot</code></p>
  </div>
</section>
<section class="cli-command" id="status">
  <div class="cli-command__heading">
    <code>status</code>
    <span class="cli-command__summary">Show dispatch and server status.</span>
    <a class="cli-command__anchor" href="#status" aria-label="Link to status"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Prints local server reachability, dispatch interval, last run, next run, and version information where available.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">status</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin status" aria-label="Copy bakin status">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="dev">
  <div class="cli-command__heading">
    <code>dev</code>
    <span class="cli-command__summary">Run the source-tree development loop.</span>
    <a class="cli-command__anchor" href="#dev" aria-label="Link to dev"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Runs Bakin in watch-mode development from a source checkout. The compiled binary refuses this command outside a repo clone.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">dev</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin dev" aria-label="Copy bakin dev">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="version">
  <div class="cli-command__heading">
    <code>version</code>
    <span class="cli-command__summary">Print the Bakin version.</span>
    <a class="cli-command__anchor" href="#version" aria-label="Link to version"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Prints the version embedded in the running CLI/binary.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">version</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin version" aria-label="Copy bakin version">Copy</button>
  </div>
  <p class="cli-command__meta">Aliases: <code>--version</code> <code>-v</code></p>
  </div>
</section>
<section class="cli-command" id="update">
  <div class="cli-command__heading">
    <code>update</code>
    <span class="cli-command__summary">Replace the current binary with the latest release.</span>
    <a class="cli-command__anchor" href="#update" aria-label="Link to update"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Downloads the latest release binary and verifies checksums before replacing the installed executable.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">update</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin update" aria-label="Copy bakin update">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="setup-service">
  <div class="cli-command__heading">
    <code>setup service</code>
    <span class="cli-command__summary">Install or remove macOS service integration.</span>
    <a class="cli-command__anchor" href="#setup-service" aria-label="Link to setup service"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs or removes the LaunchAgent used for auto-start behavior on macOS.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">setup</span> <span class="cli-token">service</span> <span class="cli-token cli-token--option">[--uninstall]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin setup service [--uninstall]" aria-label="Copy bakin setup service [--uninstall]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--uninstall]</code></td><td>option</td><td>no</td><td>Remove the installed service.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Plugins

<p class="cli-section-description">Plugin commands manage Bakin extensions from the command line, including installing official packages, linking local development plugins, and scaffolding new plugin projects.</p>

<div class="cli-command-list">
<section class="cli-command" id="plugins-list">
  <div class="cli-command__heading">
    <code>plugins list</code>
    <span class="cli-command__summary">List installed plugins.</span>
    <a class="cli-command__anchor" href="#plugins-list" aria-label="Link to plugins list"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists installed plugins and versions. Pass --check to probe remote/source for available upgrades.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">list</span> <span class="cli-token cli-token--option">[--check]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins list [--check]" aria-label="Copy bakin plugins list [--check]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--check]</code></td><td>option</td><td>no</td><td>Dry-run; report what would change.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-install">
  <div class="cli-command__heading">
    <code>plugins install</code>
    <span class="cli-command__summary">Install a plugin.</span>
    <a class="cli-command__anchor" href="#plugins-install" aria-label="Link to plugins install"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs a plugin from a local path or GitHub source. Append #subpath to install from a monorepo directory, or pin a GitHub install with @ref / --ref. --dev symlinks a local source tree for live development. --yes skips the consent prompt. --force replaces an existing install when used with --dev.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">install</span> <span class="cli-token cli-token--option">[--dev]</span> <span class="cli-token cli-token--arg">&lt;source&gt;</span> <span class="cli-token cli-token--option">[--ref &lt;ref&gt;]</span> <span class="cli-token cli-token--option">[--yes]</span> <span class="cli-token cli-token--option">[--force]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins install [--dev] &lt;path|github:user/repo[@ref][#subpath]&gt; [--ref &lt;ref&gt;] [--yes] [--force]" aria-label="Copy bakin plugins install [--dev] &lt;path|github:user/repo[@ref][#subpath]&gt; [--ref &lt;ref&gt;] [--yes] [--force]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--dev]</code></td><td>option</td><td>no</td><td>Install in local development mode.</td></tr>
      <tr><td><code>&lt;source&gt;</code><span class="cli-command__choices"><span>path</span><span>github:user/repo[@ref][#subpath]</span></span></td><td>choice</td><td>yes</td><td>Choose one of these values.</td></tr>
      <tr><td><code>[--ref &lt;ref&gt;]</code></td><td>option</td><td>no</td><td>Optional flag.</td></tr>
      <tr><td><code>[--yes]</code></td><td>option</td><td>no</td><td>Accept all defaults non-interactively.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-export">
  <div class="cli-command__heading">
    <code>plugins export</code>
    <span class="cli-command__summary">Export installed user plugins.</span>
    <a class="cli-command__anchor" href="#plugins-export" aria-label="Link to plugins export"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Writes a portable manifest for installed user plugins from ~/.bakin/plugins/lock.json. Without a file, prints JSON to stdout.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">export</span> <span class="cli-token cli-token--option">[file]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins export [file]" aria-label="Copy bakin plugins export [file]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[file]</code></td><td>argument</td><td>no</td><td>Optional value.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-import">
  <div class="cli-command__heading">
    <code>plugins import</code>
    <span class="cli-command__summary">Import an exported plugin set.</span>
    <a class="cli-command__anchor" href="#plugins-import" aria-label="Link to plugins import"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Installs every plugin in an exported manifest. GitHub plugins are pinned to the recorded commit SHA when present; linked dev plugins are restored as dev installs when their local source path exists.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">import</span> <span class="cli-token cli-token--arg">&lt;file&gt;</span> <span class="cli-token cli-token--option">[--yes]</span> <span class="cli-token cli-token--option">[--force]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins import &lt;file&gt; [--yes] [--force]" aria-label="Copy bakin plugins import &lt;file&gt; [--yes] [--force]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;file&gt;</code></td><td>argument</td><td>yes</td><td>Required value.</td></tr>
      <tr><td><code>[--yes]</code></td><td>option</td><td>no</td><td>Accept all defaults non-interactively.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-upgrade">
  <div class="cli-command__heading">
    <code>plugins upgrade</code>
    <span class="cli-command__summary">Upgrade a user plugin.</span>
    <a class="cli-command__anchor" href="#plugins-upgrade" aria-label="Link to plugins upgrade"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Re-pulls a user plugin from its source and rebuilds. --yes skips the consent prompt.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">upgrade</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--option">[--yes]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins upgrade &lt;id&gt; [--yes]" aria-label="Copy bakin plugins upgrade &lt;id&gt; [--yes]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>[--yes]</code></td><td>option</td><td>no</td><td>Accept all defaults non-interactively.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-remove">
  <div class="cli-command__heading">
    <code>plugins remove</code>
    <span class="cli-command__summary">Remove a plugin.</span>
    <a class="cli-command__anchor" href="#plugins-remove" aria-label="Link to plugins remove"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Removes an installed non-core plugin.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">remove</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins remove &lt;id&gt;" aria-label="Copy bakin plugins remove &lt;id&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-scaffold">
  <div class="cli-command__heading">
    <code>plugins scaffold</code>
    <span class="cli-command__summary">Create a plugin scaffold.</span>
    <a class="cli-command__anchor" href="#plugins-scaffold" aria-label="Link to plugins scaffold"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Creates a starter plugin source tree.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">scaffold</span> <span class="cli-token cli-token--arg">&lt;name&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins scaffold &lt;name&gt;" aria-label="Copy bakin plugins scaffold &lt;name&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;name&gt;</code></td><td>argument</td><td>yes</td><td>Name to create.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-link">
  <div class="cli-command__heading">
    <code>plugins link</code>
    <span class="cli-command__summary">Symlink a local plugin source tree for dev mode.</span>
    <a class="cli-command__anchor" href="#plugins-link" aria-label="Link to plugins link"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Registers a local source tree as a developer-mode plugin via a symlink at ~/.bakin/plugins/&lt;id&gt;/. Used with the hot-reload coordinator. --force overrides id collisions with copied installs or core plugins, but already-linked plugins must be unlinked first.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">link</span> <span class="cli-token cli-token--arg">&lt;localPath&gt;</span> <span class="cli-token cli-token--option">[--force]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins link &lt;localPath&gt; [--force]" aria-label="Copy bakin plugins link &lt;localPath&gt; [--force]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;localPath&gt;</code></td><td>argument</td><td>yes</td><td>Local filesystem path.</td></tr>
      <tr><td><code>[--force]</code></td><td>option</td><td>no</td><td>Bypass the normal safety guard.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="plugins-unlink">
  <div class="cli-command__heading">
    <code>plugins unlink</code>
    <span class="cli-command__summary">Remove a linked plugin symlink.</span>
    <a class="cli-command__anchor" href="#plugins-unlink" aria-label="Link to plugins unlink"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Removes the dev-mode symlink and lockfile entry. Refuses installed (non-linked) plugins — use `bakin plugins remove` for those.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">plugins</span> <span class="cli-token">unlink</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin plugins unlink &lt;id&gt;" aria-label="Copy bakin plugins unlink &lt;id&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Schedule

<p class="cli-section-description">Use the schedule command to list and manage recurring jobs that create tasks automatically on a configured cadence.</p>

<div class="cli-command-list">
<section class="cli-command" id="schedule">
  <div class="cli-command__heading">
    <code>schedule</code>
    <span class="cli-command__summary">Manage scheduled jobs.</span>
    <a class="cli-command__anchor" href="#schedule" aria-label="Link to schedule"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists, creates, pauses, resumes, removes, triggers, or inspects scheduled jobs.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">schedule</span> <span class="cli-token cli-token--option">[action]</span> <span class="cli-token">...</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin schedule [list|add|pause|resume|remove|run|runs] ..." aria-label="Copy bakin schedule [list|add|pause|resume|remove|run|runs] ...">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[action]</code><span class="cli-command__choices"><span>list</span><span>add</span><span>pause</span><span>resume</span><span>remove</span><span>run</span><span>runs</span></span></td><td>choice</td><td>no</td><td>Schedule action.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Search

<p class="cli-section-description">Search commands query indexed Bakin content, report index health, and rebuild indexes after adapter or data changes.</p>

<div class="cli-command-list">
<section class="cli-command" id="reindex">
  <div class="cli-command__heading">
    <code>reindex</code>
    <span class="cli-command__summary">Reindex content.</span>
    <a class="cli-command__anchor" href="#reindex" aria-label="Link to reindex"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Triggers content indexing through the search adapter.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">reindex</span> <span class="cli-token cli-token--option">[--table=&lt;name&gt;]</span> <span class="cli-token cli-token--option">[--rebuild]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin reindex [--table=&lt;name&gt;] [--rebuild]" aria-label="Copy bakin reindex [--table=&lt;name&gt;] [--rebuild]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--table=&lt;name&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
      <tr><td><code>[--rebuild]</code></td><td>option</td><td>no</td><td>Drop and rebuild indexes.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="search">
  <div class="cli-command__heading">
    <code>search</code>
    <span class="cli-command__summary">Search indexed content.</span>
    <a class="cli-command__anchor" href="#search" aria-label="Link to search"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Searches indexed Bakin content.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">search</span> <span class="cli-token cli-token--arg">&lt;query&gt;</span> <span class="cli-token cli-token--option">[--table=&lt;name&gt;]</span> <span class="cli-token cli-token--option">[--agent=&lt;id&gt;]</span> <span class="cli-token cli-token--option">[--limit=&lt;n&gt;]</span> <span class="cli-token cli-token--option">[--facets=&lt;list&gt;]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin search &lt;query&gt; [--table=&lt;name&gt;] [--agent=&lt;id&gt;] [--limit=&lt;n&gt;] [--facets=&lt;list&gt;]" aria-label="Copy bakin search &lt;query&gt; [--table=&lt;name&gt;] [--agent=&lt;id&gt;] [--limit=&lt;n&gt;] [--facets=&lt;list&gt;]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;query&gt;</code></td><td>argument</td><td>yes</td><td>Search query.</td></tr>
      <tr><td><code>[--table=&lt;name&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
      <tr><td><code>[--agent=&lt;id&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
      <tr><td><code>[--limit=&lt;n&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
      <tr><td><code>[--facets=&lt;list&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="search-stats">
  <div class="cli-command__heading">
    <code>search:stats</code>
    <span class="cli-command__summary">Show search index stats.</span>
    <a class="cli-command__anchor" href="#search-stats" aria-label="Link to search:stats"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Prints registered search table/index health and counts.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">search:stats</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin search:stats" aria-label="Copy bakin search:stats">Copy</button>
  </div>
  </div>
</section>
</div>

## Settings

<p class="cli-section-description">Settings commands are the scriptable path for reading, changing, and seeding local configuration values.</p>

<div class="cli-command-list">
<section class="cli-command" id="settings-get">
  <div class="cli-command__heading">
    <code>settings get</code>
    <span class="cli-command__summary">Read settings.</span>
    <a class="cli-command__anchor" href="#settings-get" aria-label="Link to settings get"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Reads all settings or one dot-notation key.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">settings</span> <span class="cli-token">get</span> <span class="cli-token cli-token--option">[key]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin settings get [key]" aria-label="Copy bakin settings get [key]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[key]</code></td><td>argument</td><td>no</td><td>Dot-notation settings key.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="settings-set">
  <div class="cli-command__heading">
    <code>settings set</code>
    <span class="cli-command__summary">Update a setting.</span>
    <a class="cli-command__anchor" href="#settings-set" aria-label="Link to settings set"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Updates one setting using dot notation.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">settings</span> <span class="cli-token">set</span> <span class="cli-token cli-token--arg">&lt;key&gt;</span> <span class="cli-token cli-token--arg">&lt;value&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin settings set &lt;key&gt; &lt;value&gt;" aria-label="Copy bakin settings set &lt;key&gt; &lt;value&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;key&gt;</code></td><td>argument</td><td>yes</td><td>Dot-notation settings key.</td></tr>
      <tr><td><code>&lt;value&gt;</code></td><td>argument</td><td>yes</td><td>Value to write.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="settings-init">
  <div class="cli-command__heading">
    <code>settings init</code>
    <span class="cli-command__summary">Seed default settings.</span>
    <a class="cli-command__anchor" href="#settings-init" aria-label="Link to settings init"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Creates default settings if missing.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">settings</span> <span class="cli-token">init</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin settings init" aria-label="Copy bakin settings init">Copy</button>
  </div>
  </div>
</section>
</div>

## Task Management

<p class="cli-section-description">Task commands cover the day-to-day board workflow: creating work, changing status, recording notes, expressing dependencies, and sending ready tasks to agents.</p>

<div class="cli-command-list">
<section class="cli-command" id="dispatch">
  <div class="cli-command__heading">
    <code>dispatch</code>
    <span class="cli-command__summary">Trigger immediate task dispatch.</span>
    <a class="cli-command__anchor" href="#dispatch" aria-label="Link to dispatch"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Asks the running Bakin server to run the task dispatch cycle immediately.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">dispatch</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin dispatch" aria-label="Copy bakin dispatch">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="tasks-list">
  <div class="cli-command__heading">
    <code>tasks list</code>
    <span class="cli-command__summary">List tasks.</span>
    <a class="cli-command__anchor" href="#tasks-list" aria-label="Link to tasks list"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists tasks from the task board, optionally filtered by column.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">list</span> <span class="cli-token cli-token--option">[--column=&lt;column&gt;]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks list [--column=&lt;column&gt;]" aria-label="Copy bakin tasks list [--column=&lt;column&gt;]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>[--column=&lt;column&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-get">
  <div class="cli-command__heading">
    <code>tasks get</code>
    <span class="cli-command__summary">Get task details.</span>
    <a class="cli-command__anchor" href="#tasks-get" aria-label="Link to tasks get"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Fetches one task by id from the running server.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">get</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks get &lt;id&gt;" aria-label="Copy bakin tasks get &lt;id&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-create">
  <div class="cli-command__heading">
    <code>tasks create</code>
    <span class="cli-command__summary">Create a task.</span>
    <a class="cli-command__anchor" href="#tasks-create" aria-label="Link to tasks create"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Creates a task and optionally assigns an agent or workflow.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">create</span> <span class="cli-token cli-token--arg">&lt;title&gt;</span> <span class="cli-token cli-token--option">[agent]</span> <span class="cli-token cli-token--option">[--workflow=&lt;id&gt;]</span> <span class="cli-token cli-token--option">[--no-workflow=&lt;reason&gt;]</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks create &lt;title&gt; [agent] [--workflow=&lt;id&gt;] [--no-workflow=&lt;reason&gt;]" aria-label="Copy bakin tasks create &lt;title&gt; [agent] [--workflow=&lt;id&gt;] [--no-workflow=&lt;reason&gt;]">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;title&gt;</code></td><td>argument</td><td>yes</td><td>Human-readable title.</td></tr>
      <tr><td><code>[agent]</code></td><td>argument</td><td>no</td><td>Agent id to assign or target.</td></tr>
      <tr><td><code>[--workflow=&lt;id&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
      <tr><td><code>[--no-workflow=&lt;reason&gt;]</code></td><td>option</td><td>no</td><td>Optional flag with a value.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-move">
  <div class="cli-command__heading">
    <code>tasks move</code>
    <span class="cli-command__summary">Move a task.</span>
    <a class="cli-command__anchor" href="#tasks-move" aria-label="Link to tasks move"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Moves a task to a different board column.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">move</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;column&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks move &lt;id&gt; &lt;column&gt;" aria-label="Copy bakin tasks move &lt;id&gt; &lt;column&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;column&gt;</code></td><td>argument</td><td>yes</td><td>Task board column.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-log">
  <div class="cli-command__heading">
    <code>tasks log</code>
    <span class="cli-command__summary">Log task progress.</span>
    <a class="cli-command__anchor" href="#tasks-log" aria-label="Link to tasks log"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Adds a progress log entry to a task.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">log</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;message&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks log &lt;id&gt; &lt;message&gt;" aria-label="Copy bakin tasks log &lt;id&gt; &lt;message&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;message&gt;</code></td><td>argument</td><td>yes</td><td>Message text.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-block">
  <div class="cli-command__heading">
    <code>tasks block</code>
    <span class="cli-command__summary">Block a task.</span>
    <a class="cli-command__anchor" href="#tasks-block" aria-label="Link to tasks block"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Marks a task blocked with a reason.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">block</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;reason&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks block &lt;id&gt; &lt;reason&gt;" aria-label="Copy bakin tasks block &lt;id&gt; &lt;reason&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;reason&gt;</code></td><td>argument</td><td>yes</td><td>Human-readable reason.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-depend">
  <div class="cli-command__heading">
    <code>tasks depend</code>
    <span class="cli-command__summary">Register a task dependency.</span>
    <a class="cli-command__anchor" href="#tasks-depend" aria-label="Link to tasks depend"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Sets a task dependency relationship.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">depend</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;dependsOn&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks depend &lt;id&gt; &lt;dependsOn&gt;" aria-label="Copy bakin tasks depend &lt;id&gt; &lt;dependsOn&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;dependsOn&gt;</code></td><td>argument</td><td>yes</td><td>Task id this task depends on.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="tasks-complete">
  <div class="cli-command__heading">
    <code>tasks complete</code>
    <span class="cli-command__summary">Complete a task.</span>
    <a class="cli-command__anchor" href="#tasks-complete" aria-label="Link to tasks complete"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Marks a task complete with a completion summary.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">tasks</span> <span class="cli-token">complete</span> <span class="cli-token cli-token--arg">&lt;id&gt;</span> <span class="cli-token cli-token--arg">&lt;summary&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin tasks complete &lt;id&gt; &lt;summary&gt;" aria-label="Copy bakin tasks complete &lt;id&gt; &lt;summary&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;id&gt;</code></td><td>argument</td><td>yes</td><td>Resource identifier.</td></tr>
      <tr><td><code>&lt;summary&gt;</code></td><td>argument</td><td>yes</td><td>Completion summary.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

## Workflows

<p class="cli-section-description">Workflow commands are for guided, multi-step task execution. Use them to discover available flows, start one against a task, advance steps, and submit required inputs.</p>

<div class="cli-command-list">
<section class="cli-command" id="workflows-list">
  <div class="cli-command__heading">
    <code>workflows list</code>
    <span class="cli-command__summary">List workflow definitions.</span>
    <a class="cli-command__anchor" href="#workflows-list" aria-label="Link to workflows list"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Lists available workflow definitions.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">workflows</span> <span class="cli-token">list</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin workflows list" aria-label="Copy bakin workflows list">Copy</button>
  </div>
  </div>
</section>
<section class="cli-command" id="workflows-start">
  <div class="cli-command__heading">
    <code>workflows start</code>
    <span class="cli-command__summary">Start a workflow.</span>
    <a class="cli-command__anchor" href="#workflows-start" aria-label="Link to workflows start"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Starts a workflow instance for a task.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">workflows</span> <span class="cli-token">start</span> <span class="cli-token cli-token--arg">&lt;taskId&gt;</span> <span class="cli-token cli-token--arg">&lt;workflowId&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin workflows start &lt;taskId&gt; &lt;workflowId&gt;" aria-label="Copy bakin workflows start &lt;taskId&gt; &lt;workflowId&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;taskId&gt;</code></td><td>argument</td><td>yes</td><td>Task id.</td></tr>
      <tr><td><code>&lt;workflowId&gt;</code></td><td>argument</td><td>yes</td><td>Workflow definition id.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="workflows-step">
  <div class="cli-command__heading">
    <code>workflows step</code>
    <span class="cli-command__summary">Get current workflow step.</span>
    <a class="cli-command__anchor" href="#workflows-step" aria-label="Link to workflows step"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Fetches current workflow step details for a task.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">workflows</span> <span class="cli-token">step</span> <span class="cli-token cli-token--arg">&lt;taskId&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin workflows step &lt;taskId&gt;" aria-label="Copy bakin workflows step &lt;taskId&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;taskId&gt;</code></td><td>argument</td><td>yes</td><td>Task id.</td></tr>
    </tbody>
  </table>
  </div>
</section>
<section class="cli-command" id="workflows-submit">
  <div class="cli-command__heading">
    <code>workflows submit</code>
    <span class="cli-command__summary">Submit workflow step output.</span>
    <a class="cli-command__anchor" href="#workflows-submit" aria-label="Link to workflows submit"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>
  </div>
  <div class="cli-command__box">
  <p class="cli-command__description">Submits JSON output for a workflow step.</p>
  <div class="cli-command__terminal">
    <span class="cli-command__prompt">&gt;</span>
    <code><span class="cli-token cli-token--binary">bakin</span> <span class="cli-token">workflows</span> <span class="cli-token">submit</span> <span class="cli-token cli-token--arg">&lt;taskId&gt;</span> <span class="cli-token cli-token--arg">&lt;stepId&gt;</span> <span class="cli-token cli-token--arg">&lt;json&gt;</span></code>
    <button class="cli-command__copy" type="button" data-cli-copy="bakin workflows submit &lt;taskId&gt; &lt;stepId&gt; &lt;json&gt;" aria-label="Copy bakin workflows submit &lt;taskId&gt; &lt;stepId&gt; &lt;json&gt;">Copy</button>
  </div>
  <table class="cli-command__args">
    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;taskId&gt;</code></td><td>argument</td><td>yes</td><td>Task id.</td></tr>
      <tr><td><code>&lt;stepId&gt;</code></td><td>argument</td><td>yes</td><td>Workflow step id.</td></tr>
      <tr><td><code>&lt;json&gt;</code></td><td>argument</td><td>yes</td><td>JSON payload.</td></tr>
    </tbody>
  </table>
  </div>
</section>
</div>

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated from <code>src/core/cli/registry.ts</code>.</span>
  <span>Bakin 1.0.0.</span>
</aside>
