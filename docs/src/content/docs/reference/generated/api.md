---
title: API
description: Generated OpenAPI-backed reference for documented Bakin HTTP API routes.
---

<div class="api-reference-intro">
  <p>This reference is generated from Bakin route contracts and the OpenAPI document emitted at <code>/docs/openapi.json</code>.</p>
</div>

## Core

<section class="api-operation" id="core-get-api-activity">
  <h3><code>GET /api/activity</code></h3>
  <p>List activity feed events</p>
  <p>Returns unified activity data from audit events and task logs.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-activity</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-activity-emit">
  <h3><code>POST /api/activity/emit</code></h3>
  <p>Emit activity event</p>
  <p>Emits an activity event via SSE.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-activity-emit</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;agent&quot;:&quot;string&quot;,&quot;message&quot;:&quot;string&quot;,&quot;ts&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agent-packages">
  <h3><code>GET /api/agent-packages</code></h3>
  <p>List agent packages</p>
  <p>Lists installed agent packages.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agent-packages</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-delete-api-agent-packages-by-agentId">
  <h3><code>DELETE /api/agent-packages/:agentId</code></h3>
  <p>Remove agent package</p>
  <p>Removes an installed agent package.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-delete-api-agent-packages-by-agentId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>{&quot;keepBlocks&quot;:&quot;boolean?&quot;,&quot;deleteAgent&quot;:&quot;boolean?&quot;,&quot;force&quot;:&quot;boolean?&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agent-packages-by-agentId-knowledge">
  <h3><code>GET /api/agent-packages/:agentId/knowledge</code></h3>
  <p>List agent package knowledge</p>
  <p>Lists knowledge lessons and enablement state for an installed agent package.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agent-packages-by-agentId-knowledge</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agent-packages-by-agentId-knowledge-by-lessonId">
  <h3><code>POST /api/agent-packages/:agentId/knowledge/:lessonId</code></h3>
  <p>Toggle agent package knowledge</p>
  <p>Enables or disables one knowledge lesson for an installed agent package.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agent-packages-by-agentId-knowledge-by-lessonId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>lessonId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>{&quot;enabled&quot;:&quot;boolean&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agent-packages-by-agentId-update">
  <h3><code>POST /api/agent-packages/:agentId/update</code></h3>
  <p>Update agent package</p>
  <p>Updates an installed agent package from its recorded source.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agent-packages-by-agentId-update</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>{&quot;refreshTemplate&quot;:&quot;boolean?&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agent-packages-install">
  <h3><code>POST /api/agent-packages/install</code></h3>
  <p>Install agent package</p>
  <p>Installs an agent package from a local path or GitHub source.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agent-packages-install</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;source&quot;:&quot;string&quot;,&quot;adopt&quot;:&quot;boolean?&quot;,&quot;installAs&quot;:&quot;string?&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents">
  <h3><code>GET /api/agents</code></h3>
  <p>List agents</p>
  <p>Lists all agents with status and active tasks.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-by-id">
  <h3><code>GET /api/agents/:id</code></h3>
  <p>Get agent status</p>
  <p>Returns agent status.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-by-id</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agents-by-id-message">
  <h3><code>POST /api/agents/:id/message</code></h3>
  <p>Send message to agent</p>
  <p>Sends a message to an agent.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agents-by-id-message</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>{&quot;message&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-by-id-status">
  <h3><code>GET /api/agents/:id/status</code></h3>
  <p>Get detailed agent status</p>
  <p>Returns detailed status for one agent.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-by-id-status</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-by-id-tasks">
  <h3><code>GET /api/agents/:id/tasks</code></h3>
  <p>Get agent tasks</p>
  <p>Returns tasks assigned to an agent.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-by-id-tasks</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-avatar">
  <h3><code>GET /api/agents/avatar</code></h3>
  <p>Get agent avatar</p>
  <p>Serves an agent avatar image.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-avatar</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-health">
  <h3><code>GET /api/agents/health</code></h3>
  <p>List agent health status</p>
  <p>Returns enriched heartbeat and staleness data for agents.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-health</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agents-restart">
  <h3><code>POST /api/agents/restart</code></h3>
  <p>Restart an agent</p>
  <p>Restarts an agent through the active runtime.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agents-restart</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;agentId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-agents-settings">
  <h3><code>GET /api/agents/settings</code></h3>
  <p>Get agent settings</p>
  <p>Returns host display and behavior settings for agents.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-agents-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-put-api-agents-settings">
  <h3><code>PUT /api/agents/settings</code></h3>
  <p>Update agent settings</p>
  <p>Updates host display and behavior settings for agents.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-put-api-agents-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON object with agent settings keys to update</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agents-start">
  <h3><code>POST /api/agents/start</code></h3>
  <p>Start an agent</p>
  <p>Starts an agent through the active runtime.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agents-start</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;agentId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-agents-stop">
  <h3><code>POST /api/agents/stop</code></h3>
  <p>Stop an agent</p>
  <p>Stops an agent through the active runtime.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-agents-stop</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;agentId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-assets-by-path">
  <h3><code>GET /api/assets/:path</code></h3>
  <p>Serve asset file</p>
  <p>Serves a runtime asset file by canonical path.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-assets-by-path</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>path</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-curated">
  <h3><code>GET /api/curated</code></h3>
  <p>List curated installable packages</p>
  <p>Lists curated packages available for installation.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-curated</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-dev-events">
  <h3><code>GET /api/dev/events</code></h3>
  <p>Dev SSE event stream</p>
  <p>Development-only browser reload and notification event stream.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-dev-events</code></dd>
    <dt>Stability</dt><dd><code>experimental</code></dd>
    <dt>Visibility</dt><dd><code>internal</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-dev-notify">
  <h3><code>POST /api/dev/notify</code></h3>
  <p>Emit development notification</p>
  <p>Development-only watcher bridge for browser rebuild notifications.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-dev-notify</code></dd>
    <dt>Stability</dt><dd><code>experimental</code></dd>
    <dt>Visibility</dt><dd><code>internal</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;type&quot;:&quot;string&quot;,&quot;payload&quot;:&quot;object&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-dispatch">
  <h3><code>GET /api/dispatch</code></h3>
  <p>Get dispatch timer state</p>
  <p>Returns interval, last run, next run, and dispatched count.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-dispatch</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-dispatch">
  <h3><code>POST /api/dispatch</code></h3>
  <p>Trigger dispatch</p>
  <p>Triggers an immediate task dispatch cycle.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-dispatch</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-docs">
  <h3><code>GET /api/docs</code></h3>
  <p>Get API documentation</p>
  <p>Returns API route documentation as JSON.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-docs</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-events">
  <h3><code>GET /api/events</code></h3>
  <p>SSE event stream</p>
  <p>Real-time updates for file changes, task events, alerts.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-events</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-exec-tools-by-toolName">
  <h3><code>POST /api/exec-tools/:toolName</code></h3>
  <p>Run an exec tool</p>
  <p>Invokes a registered Bakin execution tool.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-exec-tools-by-toolName</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>toolName</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>Tool-specific JSON object.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-internal-continuation">
  <h3><code>POST /api/internal/continuation</code></h3>
  <p>Trigger continuation check</p>
  <p>Triggers dependency continuation checks.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-internal-continuation</code></dd>
    <dt>Stability</dt><dd><code>experimental</code></dd>
    <dt>Visibility</dt><dd><code>internal</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;completedTaskId&quot;:&quot;string&quot;,&quot;completedTitle&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-memory-log">
  <h3><code>POST /api/memory/log</code></h3>
  <p>Append memory log entry</p>
  <p>Appends a decision, learned item, or note to the shared memory log.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-memory-log</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;type&quot;:&quot;decision|learned|note&quot;,&quot;message&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-packages">
  <h3><code>GET /api/packages</code></h3>
  <p>List reusable packages</p>
  <p>Lists installed reusable agent packages.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-packages</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-delete-api-packages-by-packageId">
  <h3><code>DELETE /api/packages/:packageId</code></h3>
  <p>Remove reusable package</p>
  <p>Removes an installed reusable package when it is not referenced by agents.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-delete-api-packages-by-packageId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>packageId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-packages-by-packageId-update">
  <h3><code>POST /api/packages/:packageId/update</code></h3>
  <p>Update reusable package</p>
  <p>Updates a reusable package from its recorded source.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-packages-by-packageId-update</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>packageId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-packages-install">
  <h3><code>POST /api/packages/install</code></h3>
  <p>Install reusable package</p>
  <p>Installs a reusable agent package from a local path or GitHub source.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-packages-install</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;source&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-paths">
  <h3><code>GET /api/paths</code></h3>
  <p>Get resolved runtime paths</p>
  <p>Returns important local filesystem paths used by the runtime.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-paths</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugin-settings-by-pluginId">
  <h3><code>GET /api/plugin-settings/:pluginId</code></h3>
  <p>Get plugin settings</p>
  <p>Returns persisted settings for one plugin.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugin-settings-by-pluginId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>pluginId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-put-api-plugin-settings-by-pluginId">
  <h3><code>PUT /api/plugin-settings/:pluginId</code></h3>
  <p>Update plugin settings</p>
  <p>Updates persisted settings for one plugin.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-put-api-plugin-settings-by-pluginId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>pluginId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>Plugin settings JSON object.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugin-settings-schemas">
  <h3><code>GET /api/plugin-settings/schemas</code></h3>
  <p>List plugin settings schemas</p>
  <p>Returns settings schemas registered by plugins.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugin-settings-schemas</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugins-by-pluginId-assets-by-path">
  <h3><code>GET /api/plugins/:pluginId/assets/:path</code></h3>
  <p>Serve plugin client asset</p>
  <p>Serves a plugin client JavaScript, CSS, or static asset file.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugins-by-pluginId-assets-by-path</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>pluginId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>path</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-plugins-install">
  <h3><code>POST /api/plugins/install</code></h3>
  <p>Install plugin</p>
  <p>Installs a plugin.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-plugins-install</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;source&quot;:&quot;string&quot;,&quot;type&quot;:&quot;local|github&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-plugins-link">
  <h3><code>POST /api/plugins/link</code></h3>
  <p>Link local plugin</p>
  <p>Registers a developer-owned plugin source tree as a live linked plugin.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-plugins-link</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;path&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugins-manifest">
  <h3><code>GET /api/plugins/manifest</code></h3>
  <p>Get plugin manifest bundle</p>
  <p>Returns the aggregated plugin manifest used by the host UI.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugins-manifest</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugins-memory-audit">
  <h3><code>GET /api/plugins/memory/audit</code></h3>
  <p>List memory audit entries</p>
  <p>Returns recent entries from the memory plugin audit log.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugins-memory-audit</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-plugins-memory-workspace">
  <h3><code>GET /api/plugins/memory/workspace</code></h3>
  <p>Get memory workspace bundle</p>
  <p>Returns workspace memory files for one agent.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-plugins-memory-workspace</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-plugins-remove">
  <h3><code>POST /api/plugins/remove</code></h3>
  <p>Remove plugin</p>
  <p>Removes an installed plugin.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-plugins-remove</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;pluginId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-plugins-unlink">
  <h3><code>POST /api/plugins/unlink</code></h3>
  <p>Unlink local plugin</p>
  <p>Removes a linked plugin symlink and lockfile entry.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-plugins-unlink</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;pluginId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-plugins-upgrade">
  <h3><code>POST /api/plugins/upgrade</code></h3>
  <p>Upgrade plugin</p>
  <p>Updates a user plugin from its recorded source.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-plugins-upgrade</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>{&quot;pluginId&quot;:&quot;string&quot;}</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-reindex">
  <h3><code>POST /api/reindex</code></h3>
  <p>Trigger reindex</p>
  <p>Triggers a full content reindex through the search adapter.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-reindex</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-search">
  <h3><code>GET /api/search</code></h3>
  <p>Search indexed content</p>
  <p>Searches across indexed content through the search adapter.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-search</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-settings">
  <h3><code>GET /api/settings</code></h3>
  <p>Get settings</p>
  <p>Returns current Bakin settings.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-post-api-settings">
  <h3><code>POST /api/settings</code></h3>
  <p>Update settings</p>
  <p>Updates Bakin settings with a partial merge.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-post-api-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON object with settings keys to update</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-state">
  <h3><code>GET /api/state</code></h3>
  <p>Get dashboard state snapshot</p>
  <p>Returns the current host dashboard state.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-state</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="core-get-api-version">
  <h3><code>GET /api/version</code></h3>
  <p>Get runtime version</p>
  <p>Returns the running Bakin version.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>core-get-api-version</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Assets

Centralized content store for all artifacts with rich rendering, search, task linking, manual upload, and clipboard paste

<section class="api-operation" id="assets-get-root">
  <h3><code>GET /api/plugins/assets/</code></h3>
  <p>List assets with filters</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-delete-root">
  <h3><code>DELETE /api/plugins/assets/</code></h3>
  <p>Soft-delete an asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-delete-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-put-content">
  <h3><code>PUT /api/plugins/assets/content</code></h3>
  <p>Update text content of an editable asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-put-content</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-get-file">
  <h3><code>GET /api/plugins/assets/file</code></h3>
  <p>Serve asset file</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-get-file</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-patch-link">
  <h3><code>PATCH /api/plugins/assets/link</code></h3>
  <p>Relink or unlink an asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-patch-link</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-patch-retype">
  <h3><code>PATCH /api/plugins/assets/retype</code></h3>
  <p>Change asset type classification</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-patch-retype</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-get-trash">
  <h3><code>GET /api/plugins/assets/trash</code></h3>
  <p>List trashed assets</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-get-trash</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-delete-trash">
  <h3><code>DELETE /api/plugins/assets/trash</code></h3>
  <p>Empty entire trash</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-delete-trash</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-delete-trash-by-file">
  <h3><code>DELETE /api/plugins/assets/trash/:file</code></h3>
  <p>Permanently delete a trashed asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-delete-trash-by-file</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>file</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-post-trash-by-file-restore">
  <h3><code>POST /api/plugins/assets/trash/:file/restore</code></h3>
  <p>Restore a trashed asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-post-trash-by-file-restore</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>file</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="assets-post-upload">
  <h3><code>POST /api/plugins/assets/upload</code></h3>
  <p>Upload asset files</p>
  <dl>
    <dt>Operation ID</dt><dd><code>assets-post-upload</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Health

System health dashboard — MCP stats, diagnostics, and uptime

<section class="api-operation" id="health-get-checks">
  <h3><code>GET /api/plugins/health/checks</code></h3>
  <p>List registered plugin health checks (metadata only; does not execute them).</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-checks</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-doctor">
  <h3><code>GET /api/plugins/health/doctor</code></h3>
  <p>Run or read cached doctor diagnostics</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-doctor</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-registry">
  <h3><code>GET /api/plugins/health/registry</code></h3>
  <p>Inspect registered plugin and runtime surfaces</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-registry</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-search-status">
  <h3><code>GET /api/plugins/health/search-status</code></h3>
  <p>Read search indexing health and adapter status</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-search-status</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-summary">
  <h3><code>GET /api/plugins/health/summary</code></h3>
  <p>Get a compact system health summary</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-summary</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-usage">
  <h3><code>GET /api/plugins/health/usage</code></h3>
  <p>Get current token and cost usage metrics</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-usage</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="health-get-usage-feed">
  <h3><code>GET /api/plugins/health/usage-feed</code></h3>
  <p>Stream usage updates for the health dashboard</p>
  <dl>
    <dt>Operation ID</dt><dd><code>health-get-usage-feed</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Memory

Observability dashboard over runtime memory tiers plus Bakin's audit log

<section class="api-operation" id="memory-get-audit">
  <h3><code>GET /api/plugins/memory/audit</code></h3>
  <p>List indexed audit entries with optional filters</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-audit</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-checkpoints">
  <h3><code>GET /api/plugins/memory/checkpoints</code></h3>
  <p>List compaction checkpoints for an agent (optionally by session)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-checkpoints</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-checkpoints-by-agent-by-sessionId-by-checkpointId">
  <h3><code>GET /api/plugins/memory/checkpoints/:agent/:sessionId/:checkpointId</code></h3>
  <p>Read one checkpoint by (agent, sessionId, checkpointId)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-checkpoints-by-agent-by-sessionId-by-checkpointId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>sessionId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>checkpointId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-daily-notes">
  <h3><code>GET /api/plugins/memory/daily-notes</code></h3>
  <p>List daily notes for an agent (sorted by date desc)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-daily-notes</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-daily-notes-by-agent-by-filename">
  <h3><code>GET /api/plugins/memory/daily-notes/:agent/:filename</code></h3>
  <p>Read one daily note</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-daily-notes-by-agent-by-filename</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>filename</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-post-daily-notes-compare-search">
  <h3><code>POST /api/plugins/memory/daily-notes/compare-search</code></h3>
  <p>Run the same query against Bakin search and runtime memory search</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-post-daily-notes-compare-search</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-dreams">
  <h3><code>GET /api/plugins/memory/dreams</code></h3>
  <p>List dream artifacts for an agent (optional phase/date/artifactType filters)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-dreams</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-dreams-by-agent-by-artifactType">
  <h3><code>GET /api/plugins/memory/dreams/:agent/:artifactType</code></h3>
  <p>Read one dream artifact by (agent, artifactType[, phase, date])</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-dreams-by-agent-by-artifactType</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>artifactType</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-durable">
  <h3><code>GET /api/plugins/memory/durable</code></h3>
  <p>List canonical durable files present for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-durable</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-durable-by-agent-by-basename">
  <h3><code>GET /api/plugins/memory/durable/:agent/:basename</code></h3>
  <p>Read one canonical durable file for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-durable-by-agent-by-basename</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>basename</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-recent">
  <h3><code>GET /api/plugins/memory/recent</code></h3>
  <p>Recent memory items across tiers, sorted by updated_at desc</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-recent</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-sessions">
  <h3><code>GET /api/plugins/memory/sessions</code></h3>
  <p>List sessions for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-sessions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-sessions-by-agent-by-sessionKey">
  <h3><code>GET /api/plugins/memory/sessions/:agent/:sessionKey</code></h3>
  <p>Read one session by key</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-sessions-by-agent-by-sessionKey</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>sessionKey</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-sessions-by-agent-by-sessionKey-turns">
  <h3><code>GET /api/plugins/memory/sessions/:agent/:sessionKey/turns</code></h3>
  <p>List turns belonging to one session (indexed)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-sessions-by-agent-by-sessionKey-turns</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agent</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>sessionKey</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-status">
  <h3><code>GET /api/plugins/memory/status</code></h3>
  <p>Indexer health: per-tier row counts + offset snapshot</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-status</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="memory-get-turns">
  <h3><code>GET /api/plugins/memory/turns</code></h3>
  <p>List turns by (agent, sessionId)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>memory-get-turns</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Messaging

Content messaging with scheduling, brainstorming, and multi-agent content pipeline

<section class="api-operation" id="messaging-get-root">
  <h3><code>GET /api/plugins/messaging/</code></h3>
  <p>List messaging items</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-root">
  <h3><code>POST /api/plugins/messaging/</code></h3>
  <p>Create a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-get-by-itemId">
  <h3><code>GET /api/plugins/messaging/:itemId</code></h3>
  <p>Get a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-get-by-itemId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-put-by-itemId">
  <h3><code>PUT /api/plugins/messaging/:itemId</code></h3>
  <p>Update a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-put-by-itemId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-delete-by-itemId">
  <h3><code>DELETE /api/plugins/messaging/:itemId</code></h3>
  <p>Delete a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-delete-by-itemId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-by-itemId-approve">
  <h3><code>POST /api/plugins/messaging/:itemId/approve</code></h3>
  <p>Approve and optionally publish a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-by-itemId-approve</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>runtime.channels</code> <code>assets.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-by-itemId-reject">
  <h3><code>POST /api/plugins/messaging/:itemId/reject</code></h3>
  <p>Reject a messaging item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-by-itemId-reject</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-by-itemId-unapprove">
  <h3><code>POST /api/plugins/messaging/:itemId/unapprove</code></h3>
  <p>Move an approved messaging item back to draft</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-by-itemId-unapprove</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-brainstorm">
  <h3><code>POST /api/plugins/messaging/brainstorm</code></h3>
  <p>Send a one-shot brainstorm prompt</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-brainstorm</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>runtime.messaging</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-get-search">
  <h3><code>GET /api/plugins/messaging/search</code></h3>
  <p>Search messaging brainstorm sessions</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-get-search</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>search.read</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-get-sessions">
  <h3><code>GET /api/plugins/messaging/sessions</code></h3>
  <p>List planning sessions</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-get-sessions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-sessions">
  <h3><code>POST /api/plugins/messaging/sessions</code></h3>
  <p>Create a planning session</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-sessions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-get-sessions-by-id">
  <h3><code>GET /api/plugins/messaging/sessions/:id</code></h3>
  <p>Get a planning session</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-get-sessions-by-id</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-put-sessions-by-id">
  <h3><code>PUT /api/plugins/messaging/sessions/:id</code></h3>
  <p>Update a planning session</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-put-sessions-by-id</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-delete-sessions-by-id">
  <h3><code>DELETE /api/plugins/messaging/sessions/:id</code></h3>
  <p>Delete a planning session</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-delete-sessions-by-id</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-sessions-by-id-confirm">
  <h3><code>POST /api/plugins/messaging/sessions/:id/confirm</code></h3>
  <p>Confirm planning-session proposals into calendar items</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-sessions-by-id-confirm</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>runtime.channels</code> <code>assets.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-post-sessions-by-id-messages">
  <h3><code>POST /api/plugins/messaging/sessions/:id/messages</code></h3>
  <p>Send a message to a planning session</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-post-sessions-by-id-messages</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>runtime.messaging</code> <code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="messaging-put-sessions-by-id-proposals-by-proposalId">
  <h3><code>PUT /api/plugins/messaging/sessions/:id/proposals/:proposalId</code></h3>
  <p>Update a planning-session proposal</p>
  <dl>
    <dt>Operation ID</dt><dd><code>messaging-put-sessions-by-id-proposals-by-proposalId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>id</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>proposalId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Models

Agent model configuration — per-agent models, aliases, task profiles, available models from Anthropic API

<section class="api-operation" id="models-get-aliases">
  <h3><code>GET /api/plugins/models/aliases</code></h3>
  <p>List model aliases</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-get-aliases</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-post-aliases">
  <h3><code>POST /api/plugins/models/aliases</code></h3>
  <p>Create or update a model alias</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-post-aliases</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-get-available">
  <h3><code>GET /api/plugins/models/available</code></h3>
  <p>Bypass cache and fetch the model list fresh from the runtime adapter</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-get-available</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-get-config">
  <h3><code>GET /api/plugins/models/config</code></h3>
  <p>Get effective agent model configuration</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-get-config</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-post-config">
  <h3><code>POST /api/plugins/models/config</code></h3>
  <p>Update agent model configuration</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-post-config</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-post-defaults">
  <h3><code>POST /api/plugins/models/defaults</code></h3>
  <p>Update default model selections</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-post-defaults</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-get-profiles">
  <h3><code>GET /api/plugins/models/profiles</code></h3>
  <p>List model task profiles</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-get-profiles</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-put-profiles">
  <h3><code>PUT /api/plugins/models/profiles</code></h3>
  <p>Check if runtime config is out of sync (needs restart)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-put-profiles</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-post-refresh">
  <h3><code>POST /api/plugins/models/refresh</code></h3>
  <p>Bypass cache and fetch the model list fresh from the runtime adapter</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-post-refresh</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-post-runtime-restart">
  <h3><code>POST /api/plugins/models/runtime/restart</code></h3>
  <p>List available AI models with tier classification (budget/standard/premium). Use this to discover what models are available for assignment.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-post-runtime-restart</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="models-get-runtime-status">
  <h3><code>GET /api/plugins/models/runtime/status</code></h3>
  <p>Check if runtime config is out of sync (needs restart)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>models-get-runtime-status</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Projects

Project management with specs, checklists, task linking, and agent access via MCP tools

<section class="api-operation" id="projects-get-root">
  <h3><code>GET /api/plugins/projects/</code></h3>
  <p>List projects</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-root">
  <h3><code>POST /api/plugins/projects/</code></h3>
  <p>Create a project</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>runtime.agents</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-get-by-projectId">
  <h3><code>GET /api/plugins/projects/:projectId</code></h3>
  <p>Get a project</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-get-by-projectId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.read</code> <code>tasks.read</code> <code>assets.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-put-by-projectId">
  <h3><code>PUT /api/plugins/projects/:projectId</code></h3>
  <p>Update a project</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-put-by-projectId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-delete-by-projectId">
  <h3><code>DELETE /api/plugins/projects/:projectId</code></h3>
  <p>Delete a project</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-delete-by-projectId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>tasks.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-by-projectId-ask">
  <h3><code>POST /api/plugins/projects/:projectId/ask</code></h3>
  <p>Ask an agent about a project</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-by-projectId-ask</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>runtime.messaging</code> <code>storage.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-by-projectId-assets">
  <h3><code>POST /api/plugins/projects/:projectId/assets</code></h3>
  <p>Attach an asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-by-projectId-assets</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>assets.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-delete-by-projectId-assets-by-filename">
  <h3><code>DELETE /api/plugins/projects/:projectId/assets/:filename</code></h3>
  <p>Detach an asset</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-delete-by-projectId-assets-by-filename</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>filename</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-by-projectId-checklist">
  <h3><code>POST /api/plugins/projects/:projectId/checklist</code></h3>
  <p>Add a checklist item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-by-projectId-checklist</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-put-by-projectId-checklist-by-itemId">
  <h3><code>PUT /api/plugins/projects/:projectId/checklist/:itemId</code></h3>
  <p>Update a checklist item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-put-by-projectId-checklist-by-itemId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-delete-by-projectId-checklist-by-itemId">
  <h3><code>DELETE /api/plugins/projects/:projectId/checklist/:itemId</code></h3>
  <p>Remove a checklist item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-delete-by-projectId-checklist-by-itemId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-by-projectId-checklist-by-itemId-link">
  <h3><code>POST /api/plugins/projects/:projectId/checklist/:itemId/link</code></h3>
  <p>Link a checklist item to a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-by-projectId-checklist-by-itemId-link</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>tasks.read</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-post-by-projectId-checklist-by-itemId-promote">
  <h3><code>POST /api/plugins/projects/:projectId/checklist/:itemId/promote</code></h3>
  <p>Promote a checklist item to a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-post-by-projectId-checklist-by-itemId-promote</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code> <code>tasks.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-put-by-projectId-checklist-by-itemId-toggle">
  <h3><code>PUT /api/plugins/projects/:projectId/checklist/:itemId/toggle</code></h3>
  <p>Toggle a checklist item</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-put-by-projectId-checklist-by-itemId-toggle</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>storage.write</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>projectId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>itemId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="projects-get-search">
  <h3><code>GET /api/plugins/projects/search</code></h3>
  <p>Search projects</p>
  <dl>
    <dt>Operation ID</dt><dd><code>projects-get-search</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
    <dt>Permissions</dt><dd><code>search.read</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Schedule

Cron job scheduling through the runtime adapter with task creation

<section class="api-operation" id="schedule-get-root">
  <h3><code>GET /api/plugins/schedule/</code></h3>
  <p>List all scheduled jobs</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-post-root">
  <h3><code>POST /api/plugins/schedule/</code></h3>
  <p>Create a scheduled job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-post-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-get-by-jobId">
  <h3><code>GET /api/plugins/schedule/:jobId</code></h3>
  <p>Get details for a single scheduled job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-get-by-jobId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-put-by-jobId">
  <h3><code>PUT /api/plugins/schedule/:jobId</code></h3>
  <p>Update an existing scheduled job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-put-by-jobId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-delete-by-jobId">
  <h3><code>DELETE /api/plugins/schedule/:jobId</code></h3>
  <p>Delete a scheduled job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-delete-by-jobId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-post-by-jobId-pause">
  <h3><code>POST /api/plugins/schedule/:jobId/pause</code></h3>
  <p>Pause/resume/skip a job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-post-by-jobId-pause</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-post-by-jobId-run">
  <h3><code>POST /api/plugins/schedule/:jobId/run</code></h3>
  <p>Trigger immediate run</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-post-by-jobId-run</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-get-by-jobId-runs">
  <h3><code>GET /api/plugins/schedule/:jobId/runs</code></h3>
  <p>Get run history for a job</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-get-by-jobId-runs</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>jobId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-post-bridge">
  <h3><code>POST /api/plugins/schedule/bridge</code></h3>
  <p>Cron bridge webhook</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-post-bridge</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="schedule-post-parse">
  <h3><code>POST /api/plugins/schedule/parse</code></h3>
  <p>Parse schedule expression</p>
  <dl>
    <dt>Operation ID</dt><dd><code>schedule-post-parse</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Tasks

Kanban task management with Bakin task-store persistence, agent assignment, and dependency tracking

<section class="api-operation" id="tasks-get-root">
  <h3><code>GET /api/plugins/tasks/</code></h3>
  <p>List all tasks</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-root">
  <h3><code>POST /api/plugins/tasks/</code></h3>
  <p>Create a new task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-get-by-taskId">
  <h3><code>GET /api/plugins/tasks/:taskId</code></h3>
  <p>Get a single task by ID</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-get-by-taskId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-put-by-taskId">
  <h3><code>PUT /api/plugins/tasks/:taskId</code></h3>
  <p>Update a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-put-by-taskId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-delete-by-taskId">
  <h3><code>DELETE /api/plugins/tasks/:taskId</code></h3>
  <p>Delete a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-delete-by-taskId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-assign">
  <h3><code>POST /api/plugins/tasks/:taskId/assign</code></h3>
  <p>Assign a task to an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-assign</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-block">
  <h3><code>POST /api/plugins/tasks/:taskId/block</code></h3>
  <p>Mark a task as blocked</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-block</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-complete">
  <h3><code>POST /api/plugins/tasks/:taskId/complete</code></h3>
  <p>Mark a task as complete</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-complete</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-dependency">
  <h3><code>POST /api/plugins/tasks/:taskId/dependency</code></h3>
  <p>Set a dependency between tasks</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-dependency</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-log">
  <h3><code>POST /api/plugins/tasks/:taskId/log</code></h3>
  <p>Add a log entry to a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-log</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-by-taskId-move">
  <h3><code>POST /api/plugins/tasks/:taskId/move</code></h3>
  <p>Move a task to a different column</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-by-taskId-move</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="tasks-post-reorder">
  <h3><code>POST /api/plugins/tasks/reorder</code></h3>
  <p>Reorder tasks within a column</p>
  <dl>
    <dt>Operation ID</dt><dd><code>tasks-post-reorder</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Team

Agent team management — adapter layer over runtime agent workspaces

<section class="api-operation" id="team-get-root">
  <h3><code>GET /api/plugins/team/</code></h3>
  <p>List all agents with runtime status</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-post-root">
  <h3><code>POST /api/plugins/team/</code></h3>
  <p>Create a new agent in the active runtime</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-post-root</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId">
  <h3><code>GET /api/plugins/team/:agentId</code></h3>
  <p>Get full agent profile merged from runtime state</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-delete-by-agentId">
  <h3><code>DELETE /api/plugins/team/:agentId</code></h3>
  <p>Remove an agent from the active runtime and move workspace to trash</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-delete-by-agentId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-active-context">
  <h3><code>GET /api/plugins/team/:agentId/active-context</code></h3>
  <p>Read the most recent session JSONL parsed into a message stream</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-active-context</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-avatar">
  <h3><code>GET /api/plugins/team/:agentId/avatar</code></h3>
  <p>Serve agent avatar image</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-avatar</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-post-by-agentId-avatar">
  <h3><code>POST /api/plugins/team/:agentId/avatar</code></h3>
  <p>Upload agent avatar image</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-post-by-agentId-avatar</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-files">
  <h3><code>GET /api/plugins/team/:agentId/files</code></h3>
  <p>List workspace files for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-files</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-files-by-filename">
  <h3><code>GET /api/plugins/team/:agentId/files/:filename</code></h3>
  <p>Read a specific workspace file</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-files-by-filename</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>filename</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-by-agentId-files-by-filename">
  <h3><code>PUT /api/plugins/team/:agentId/files/:filename</code></h3>
  <p>Write a workspace file through the active runtime</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-by-agentId-files-by-filename</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>filename</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-heartbeat">
  <h3><code>GET /api/plugins/team/:agentId/heartbeat</code></h3>
  <p>Read the agent's HEARTBEAT.md narrative + file mtime</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-heartbeat</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-by-agentId-identity">
  <h3><code>PUT /api/plugins/team/:agentId/identity</code></h3>
  <p>Update agent identity fields and persona files</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-by-agentId-identity</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-memory">
  <h3><code>GET /api/plugins/team/:agentId/memory</code></h3>
  <p>List memory files for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-memory</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-memory-by-date">
  <h3><code>GET /api/plugins/team/:agentId/memory/:date</code></h3>
  <p>Read a specific memory file</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-memory-by-date</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>date</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-by-agentId-permissions">
  <h3><code>PUT /api/plugins/team/:agentId/permissions</code></h3>
  <p>Update agent dispatch permissions (subagents.allowAgents)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-by-agentId-permissions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-recent-activity">
  <h3><code>GET /api/plugins/team/:agentId/recent-activity</code></h3>
  <p>Per-agent dispatch + error counts across 5m / 1h / 24h windows (resets on server restart)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-recent-activity</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-skills">
  <h3><code>GET /api/plugins/team/:agentId/skills</code></h3>
  <p>List installed skills for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-skills</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-skills-by-skillId">
  <h3><code>GET /api/plugins/team/:agentId/skills/:skillId</code></h3>
  <p>Read SKILL.md for a specific skill</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-skills-by-skillId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
    <tr><td><code>skillId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-post-by-agentId-start">
  <h3><code>POST /api/plugins/team/:agentId/start</code></h3>
  <p>Start an agent via the active runtime</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-post-by-agentId-start</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-by-agentId-stats">
  <h3><code>GET /api/plugins/team/:agentId/stats</code></h3>
  <p>Get token usage and cost stats for an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-by-agentId-stats</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-post-by-agentId-stop">
  <h3><code>POST /api/plugins/team/:agentId/stop</code></h3>
  <p>Stop an agent</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-post-by-agentId-stop</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-by-agentId-team">
  <h3><code>PUT /api/plugins/team/:agentId/team</code></h3>
  <p>Assign an agent to an organizational team</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-by-agentId-team</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>agentId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-settings">
  <h3><code>GET /api/plugins/team/settings</code></h3>
  <p>Get agent display settings</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-settings">
  <h3><code>PUT /api/plugins/team/settings</code></h3>
  <p>Update agent display settings</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-settings</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-teams">
  <h3><code>GET /api/plugins/team/teams</code></h3>
  <p>List organizational teams</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-teams</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-post-teams">
  <h3><code>POST /api/plugins/team/teams</code></h3>
  <p>Create an organizational team</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-post-teams</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-put-teams-by-teamId">
  <h3><code>PUT /api/plugins/team/teams/:teamId</code></h3>
  <p>Update an organizational team</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-put-teams-by-teamId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>teamId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-delete-teams-by-teamId">
  <h3><code>DELETE /api/plugins/team/teams/:teamId</code></h3>
  <p>Delete an organizational team</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-delete-teams-by-teamId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>teamId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="team-get-teams-by-teamId-members">
  <h3><code>GET /api/plugins/team/teams/:teamId/members</code></h3>
  <p>List agents belonging to a team</p>
  <dl>
    <dt>Operation ID</dt><dd><code>team-get-teams-by-teamId-members</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>teamId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

## Workflows

Workflow runtime — enforces step-by-step agent execution with gated delivery, parallel steps, human gates, and output validation

<section class="api-operation" id="workflows-get-definitions">
  <h3><code>GET /api/plugins/workflows/definitions</code></h3>
  <p>List all workflow templates with step counts and resolved sub-workflows</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-definitions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-post-definitions">
  <h3><code>POST /api/plugins/workflows/definitions</code></h3>
  <p>Create a new user-owned workflow definition</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-post-definitions</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-definitions-by-name">
  <h3><code>GET /api/plugins/workflows/definitions/:name</code></h3>
  <p>Get a specific workflow definition by name</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-definitions-by-name</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>name</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-put-definitions-by-name">
  <h3><code>PUT /api/plugins/workflows/definitions/:name</code></h3>
  <p>Update or shadow a workflow definition (writes user YAML)</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-put-definitions-by-name</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>name</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-delete-definitions-by-name">
  <h3><code>DELETE /api/plugins/workflows/definitions/:name</code></h3>
  <p>Delete a user-owned workflow definition</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-delete-definitions-by-name</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>name</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-post-gates-by-taskId-approve">
  <h3><code>POST /api/plugins/workflows/gates/:taskId/approve</code></h3>
  <p>Approve a human gate step</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-post-gates-by-taskId-approve</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-post-gates-by-taskId-reject">
  <h3><code>POST /api/plugins/workflows/gates/:taskId/reject</code></h3>
  <p>Reject a gate step, rewinds workflow</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-post-gates-by-taskId-reject</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-gates-pending">
  <h3><code>GET /api/plugins/workflows/gates/pending</code></h3>
  <p>List all gates awaiting approval</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-gates-pending</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-gates-status">
  <h3><code>GET /api/plugins/workflows/gates/status</code></h3>
  <p>Batch check gate status for tasks</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-gates-status</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-instances">
  <h3><code>GET /api/plugins/workflows/instances</code></h3>
  <p>List active workflow instances. Optional status filter.</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-instances</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-instances-by-taskId">
  <h3><code>GET /api/plugins/workflows/instances/:taskId</code></h3>
  <p>Get full workflow instance state for a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-instances-by-taskId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-post-instances-start">
  <h3><code>POST /api/plugins/workflows/instances/start</code></h3>
  <p>Start a workflow instance for a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-post-instances-start</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-node-types">
  <h3><code>GET /api/plugins/workflows/node-types</code></h3>
  <p>List registered workflow node types (builtin + plugin-registered) for the canvas palette</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-node-types</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-notification-channels">
  <h3><code>GET /api/plugins/workflows/notification-channels</code></h3>
  <p>List registered notification channels</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-notification-channels</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-get-steps-by-taskId">
  <h3><code>GET /api/plugins/workflows/steps/:taskId</code></h3>
  <p>Get current workflow step for a task</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-get-steps-by-taskId</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<section class="api-operation" id="workflows-post-steps-by-taskId-complete">
  <h3><code>POST /api/plugins/workflows/steps/:taskId/complete</code></h3>
  <p>Submit step output, validates against schema, advances workflow</p>
  <dl>
    <dt>Operation ID</dt><dd><code>workflows-post-steps-by-taskId-complete</code></dd>
    <dt>Stability</dt><dd><code>stable</code></dd>
    <dt>Visibility</dt><dd><code>public</code></dd>
  </dl>
  <h4>Parameters</h4>
  <table class="api-parameters-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>taskId</code></td><td>path</td><td>yes</td><td></td></tr>
  </tbody></table>
  <h4>Request Body</h4>
  <p>JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.</p>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
  <h4>Responses</h4>
  <table class="api-responses-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>200</code></td><td>Successful response.</td></tr>
    <tr><td><code>default</code></td><td>Error response.</td></tr>
  </tbody></table>
  <pre><code class="language-json">
{
  &quot;type&quot;: &quot;object&quot;,
  &quot;additionalProperties&quot;: true
}
  </code></pre>
</section>

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Apr 29, 2026 · Bakin 1.0.0</span>
</aside>
