# Bakin Hooks

Docs version: Bakin 0.0.0-dev

Audience: coding agents and technical authors.

Canonical docs: https://makinbakin.com/docs/

Hooks are plugin integration points. Use them from plugin code through `ctx.hooks`.

Invocation style depends on `kind`:

- `rpc`: `await ctx.hooks.invoke(name, payload)`
- `event`: `await ctx.hooks.callAll(name, payload)`
- `waterfall`: `await ctx.hooks.call(name, payload)`

## Assets

Asset hooks expose file, sidecar, variant, and trash helpers for plugins that need to work with Bakin-managed files.

### assets.describe

Label: Describe assets by id.
Purpose: Batch {description, enrichment caption, type, exists} per assetId — lets brand asset groups (and any consumer) label members without direct imports.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:49

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.describe',
  {},
)
```

### assets.enrichmentStats

Label: Enrichment queue stats.
Purpose: Returns the vision-enrichment queue depth and processed/failed/skipped counters for telemetry.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:30

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.enrichmentStats',
  {},
)
```

### assets.getAssetTypes

Label: List asset types.
Purpose: Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:44

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.getAssetTypes',
  {},
)
```

### assets.listByTask

Label: List assets linked to a task.
Purpose: Returns {assetId, description, type} for every versioned asset whose manifest taskId matches. Backed by an in-memory index — the sanctioned way for core (dispatch) to resolve a task’s attached assets without scanning plugin storage.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:36

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.listByTask',
  {},
)
```

### assets.purgeClipboardForTask

Label: Purge task clipboard assets.
Purpose: Deletes clipboard-sourced assets associated with a completed task when that cleanup setting is enabled. Use it from task completion flows that want asset cleanup to stay centralized.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:99

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.purgeClipboardForTask',
  {
    taskId: 'task-123'
  },
)
```

### assets.resolveServe

Label: Resolve versioned asset serve request.
Purpose: Resolves an /api/assets/<assetId> path (current, /v/<n>, /thumb, /export/<name>) to a file on disk for serving.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:67

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.resolveServe',
  {
    segments: [
      '20260401-hero-a1b2c3d4',
      'thumb'
    ]
  },
)
```

### assets.saveFromSource

Label: Save a file as a managed asset.
Purpose: Upserts a file into the versioned asset store by source path (new asset, version bump, or no-op when unchanged). The sanctioned cross-plugin/core save path; mirrors bakin_exec_assets_save.
Kind: rpc
Source: plugins/assets/lib/register-hooks.ts:73

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.saveFromSource',
  {},
)
```

## Chat

### chat.resolveActiveTurn

Label: chat.resolveActiveTurn
Kind: rpc
Source: plugins/chat/index.ts:37

Example:

```ts
const result = await ctx.hooks.invoke(
  'chat.resolveActiveTurn',
  {},
)
```

## Health

Health hooks expose registered readiness and diagnostic checks so other surfaces can list or inspect them.

### health.getCheck

Label: Get a health check.
Purpose: Returns canonical metadata for one registered Health check by stable id without executing it.
Kind: rpc
Source: plugins/health/index.ts:767

Example:

```ts
const result = await ctx.hooks.invoke(
  'health.getCheck',
  {
    id: 'runtime'
  },
)
```

### health.list

Label: List health checks.
Purpose: Returns canonical metadata for registered Health checks without executing them.
Kind: rpc
Source: plugins/health/index.ts:766

Example:

```ts
const result = await ctx.hooks.invoke(
  'health.list',
  {},
)
```

## Models

Model hooks expose the effective model configuration and notify dependent surfaces when runtime model state changes.

### models.configChanged

Label: Model config changed.
Purpose: Notifies listeners after an agent model assignment changes. Use it to refresh dependent state, update UI, or invalidate plugin caches that depend on model routing.
Kind: event
Source: plugins/models/lib/register-hooks.ts:22

Example:

```ts
await ctx.hooks.callAll(
  'models.configChanged',
  {
    agentId: 'patch',
    oldModel: 'gpt-5.4',
    newModel: 'gpt-5.5'
  },
)
```

### models.getAvailableModels

Label: List available models.
Purpose: Returns the model catalog available from the currently configured providers. Use it to populate pickers, validate assignments, or compare model options before saving config.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:38

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getAvailableModels',
  {},
)
```

### models.getBudgetPolicy

Label: Get budget policy.
Purpose: Returns the spend-cap rule list that dispatch consults before each turn (legacy shapes migrate on read). Use it to read the current budget limits.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:127

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getBudgetPolicy',
  {},
)
```

### models.getEffectiveModel

Label: Get effective model.
Purpose: Resolves the model an agent will actually use after defaults, overrides, and provider settings are applied. Use it when a plugin needs runtime-ready model information for one agent.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:26

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getEffectiveModel',
  {
    agentId: 'patch'
  },
)
```

### models.getRoutingConfig

Label: Get routing config.
Purpose: Returns the per-turn model/thinking routing policy (origins + tag overrides) that dispatch applies before each agent turn. Use it to read the current routing rules.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:117

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getRoutingConfig',
  {},
)
```

### models.markConfigDirty

Label: Mark config dirty.
Purpose: Marks model configuration as changed so the runtime knows a refresh is needed. Use it after writing model settings that should not be treated as live yet.
Kind: event
Source: plugins/models/lib/register-hooks.ts:34

Example:

```ts
await ctx.hooks.callAll(
  'models.markConfigDirty',
  {},
)
```

### models.markRuntimeRestarted

Label: Mark runtime refreshed.
Purpose: Records that the runtime has picked up the latest model configuration. Use it after restart or reload flows so stale dirty-state warnings can clear.
Kind: event
Source: plugins/models/lib/register-hooks.ts:36

Example:

```ts
await ctx.hooks.callAll(
  'models.markRuntimeRestarted',
  {},
)
```

### models.priceImage

Label: Price an image.
Purpose: Returns billing attribution plus an estimated cost in micro-dollars for an image generation (count × the model’s flat per-image rate), or null cost when the model is provider-priced or the provider is overridden to the subscription lane. The agent’s chat auth never affects image billing.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:78

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.priceImage',
  {},
)
```

### models.priceTurn

Label: Price a turn.
Purpose: Resolves the model an agent turn ran on and returns billing attribution (provider, metered/subscription lane) plus an estimated micro-dollar cost from the catalog pricing. Cost is null when the model is unpriced or the lane is subscription (tokens are the unit there).
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:49

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.priceTurn',
  {},
)
```

### models.resolveBilling

Label: Resolve billing.
Purpose: Returns the provider, billing lane (metered vs subscription), and normalized model for an agent/model pair — falling back to the agent’s effective model when none is given. Use it to attribute or gate prospective spend before a turn or billed media call.
Kind: rpc
Source: plugins/models/lib/register-hooks.ts:101

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.resolveBilling',
  {},
)
```

## Schedule

### schedule.adoptCronJobs

Label: Adopt runtime cron jobs
Purpose: Adopt snapshotted runtime cron jobs into Bakin schedules during a runtime switch (opt-in, idempotent per job id).
Kind: rpc
Source: plugins/schedule/index.ts:76

Example:

```ts
const result = await ctx.hooks.invoke(
  'schedule.adoptCronJobs',
  {},
)
```

### schedule.ensureBakinJob

Label: Ensure Bakin schedule
Purpose: Create or update a Bakin-managed runtime cron job and return the provider job id.
Kind: rpc
Source: plugins/schedule/index.ts:70

Example:

```ts
const result = await ctx.hooks.invoke(
  'schedule.ensureBakinJob',
  {},
)
```

## Tasks

Task hooks let plugins enrich task details and react to task lifecycle changes.

### tasks.enrichDetails

Label: Add project task context.
Purpose: Adds project title, status, progress, and excerpt data to task detail payloads. Use it when a task surface wants project context without depending on project storage.
Kind: waterfall
Source: bakin-bits-official/plugins/projects/index.ts:241

Example:

```ts
const next = await ctx.hooks.call(
  'tasks.enrichDetails',
  {
    task: {
      id: 'task-123',
      projectId: 'launch-docs'
    }
  },
)
```

### tasks.statusChanged

Label: Sync project task state.
Purpose: Updates linked project checklist items when a task moves into a completed state. Use it to keep project progress in sync with task lifecycle events.
Kind: event
Source: bakin-bits-official/plugins/projects/index.ts:230

Example:

```ts
await ctx.hooks.callAll(
  'tasks.statusChanged',
  {
    taskId: 'task-123',
    from: 'doing',
    to: 'done'
  },
)
```

## Team

Team hooks expose runtime agent and team metadata for plugins that need agent-aware behavior.

### team.exists

Label: Check team exists.
Purpose: Returns true when the given teamId is a configured team. Use it for write-time validation of team assignments.
Kind: rpc
Source: plugins/team/index.ts:316

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.exists',
  {},
)
```

### team.getAgent

Label: Get an agent.
Purpose: Returns one runtime agent by id, including team-aware metadata when available. Use it when a plugin already has an agent id and needs the full display record.
Kind: rpc
Source: plugins/team/index.ts:294

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.getAgent',
  {
    id: 'patch'
  },
)
```

### team.getAgentIds

Label: List agent ids.
Purpose: Returns the ids of agents currently known to the runtime. Use it for lightweight validation, assignment pickers, or loops that do not need full agent metadata.
Kind: rpc
Source: plugins/team/index.ts:299

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.getAgentIds',
  {},
)
```

### team.getAgentTeam

Label: Get agent team.
Purpose: Returns the team currently assigned to an agent, or null when the agent is unassigned. Use it to add team context to task, workflow, or activity views.
Kind: rpc
Source: plugins/team/index.ts:306

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.getAgentTeam',
  {
    id: 'patch'
  },
)
```

### team.getOrgStructure

Label: Get org structure.
Purpose: Returns the current organization structure for teams and agents. Use it when a plugin needs the full hierarchy instead of individual team or agent records.
Kind: rpc
Source: plugins/team/index.ts:313

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.getOrgStructure',
  {},
)
```

### team.getTeamMembers

Label: List team members.
Purpose: Returns the agents assigned to one team. Use it for team dashboards, routing rules, or workflow logic that needs team membership.
Kind: rpc
Source: plugins/team/index.ts:303

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.getTeamMembers',
  {
    teamId: 'docs'
  },
)
```

### team.list

Label: List agents.
Purpose: Returns runtime agents with their display and team metadata attached. Use it when another plugin needs the agent roster as Bakin presents it.
Kind: rpc
Source: plugins/team/index.ts:293

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.list',
  {},
)
```

### team.resolveAssignment

Label: Resolve team assignment.
Purpose: Resolves a team-assigned task to the best-suited member via the routing LLM (#189). Returns {ok:true, agentId, reason, model} or {ok:false, kind: transient|structural, message} — dispatch classifies by kind. Use it from dispatch or any surface that must turn a teamId into a concrete agent.
Kind: rpc
Source: plugins/team/index.ts:319

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.resolveAssignment',
  {},
)
```

### team.resolveProfile

Label: Resolve agent profile.
Purpose: Returns the runtime profile for an agent id. Use it when a plugin needs the lower-level profile data behind an agent display record.
Kind: rpc
Source: plugins/team/index.ts:300

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.resolveProfile',
  {
    id: 'patch'
  },
)
```

## Workflows

Workflow hooks expose workflow definitions, instances, steps, gates, and notification helpers for task automation.

### workflows.approveGate

Label: Approve workflow gate.
Purpose: Approves a pending workflow gate and advances the instance. Use it from plugins that own an external review surface for workflow-backed tasks.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:43

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.approveGate',
  {},
)
```

### workflows.authorizeToolUse

Label: Authorize workflow tool use.
Purpose: Checks whether an agent may perform a workflow-scoped tool action for a task. Use it before executing workflow-sensitive automation.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:69

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.authorizeToolUse',
  {},
)
```

### workflows.cancelInstance

Label: Cancel workflow instance.
Purpose: Cancels the workflow instance attached to a task. Use it when task state changes make the workflow no longer relevant or safe to continue.
Kind: event
Source: plugins/workflows/lib/register-hooks.ts:79

Example:

```ts
await ctx.hooks.callAll(
  'workflows.cancelInstance',
  {
    taskId: 'task-123'
  },
)
```

### workflows.cancelMapChild

Label: Cancel map child.
Purpose: Cancels one fan-out child of a map_workflow step. The join stays blocked until the child is retried or the parent is cancelled — silently skipping children is never the default.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:77

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.cancelMapChild',
  {},
)
```

### workflows.clearSkillCache

Label: Clear workflow skill cache.
Purpose: Drops the in-memory workflow-skill resolution cache so the next lookup re-reads disk and the registries. Use it after agent-package sync, migration, install, or removal changes which skills resolve.
Kind: event
Source: plugins/workflows/lib/register-hooks.ts:82

Example:

```ts
await ctx.hooks.callAll(
  'workflows.clearSkillCache',
  {},
)
```

### workflows.completeStep

Label: Complete workflow step.
Purpose: Submits output for a workflow step and advances the instance when validation passes. Use it from agents or tools that finish a workflow action.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:61

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.completeStep',
  {
    taskId: 'task-123',
    stepId: 'review',
    output: {
      ok: true
    }
  },
)
```

### workflows.createInstance

Label: Create workflow instance.
Purpose: Creates a workflow instance for a task and optional assignee context. Use it when task creation or routing should immediately attach a workflow.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:41

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.createInstance',
  {
    taskId: 'task-123',
    workflowId: 'docs-review',
    assignee: 'patch'
  },
)
```

### workflows.definitions.list

Label: List workflow definitions.
Purpose: Returns available workflow definitions from the configured content directory. Use it to populate workflow selectors or validate workflow ids before creating instances.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:63

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.definitions.list',
  {},
)
```

### workflows.deleteInstance

Label: Delete workflow instance.
Purpose: Removes the workflow instance file attached to a task. Use it when the task itself is deleted so no orphaned instance state is left behind.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:42

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.deleteInstance',
  {},
)
```

### workflows.getActiveAgents

Label: List active workflow agents.
Purpose: Returns agents currently active in a workflow task. Use it for coordination, notification, or assignment views that need live workflow participants.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:68

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.getActiveAgents',
  {
    taskId: 'task-123'
  },
)
```

### workflows.getCurrentStep

Label: Get current step.
Purpose: Returns the current workflow step for a task, optionally scoped to an agent. Use it when a plugin needs to know what work is currently actionable.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:60

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.getCurrentStep',
  {
    taskId: 'task-123',
    agentId: 'patch'
  },
)
```

### workflows.getNotificationChannel

Label: Get notification channel.
Purpose: Returns one workflow notification channel by id. Use it before sending or configuring alerts that depend on a specific channel implementation.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:88

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.getNotificationChannel',
  {
    id: 'slack'
  },
)
```

### workflows.instances.list

Label: List workflow instances.
Purpose: Returns workflow instances, optionally filtered by status. Use it for dashboards, queues, and maintenance flows that need a broad view of active workflow state.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:59

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.instances.list',
  {
    statusFilter: 'in_progress'
  },
)
```

### workflows.isGateNotified

Label: Check gate notification.
Purpose: Checks whether a workflow gate notification has already been sent. Use it to avoid duplicate alerts for the same task and gate step.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:70

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.isGateNotified',
  {
    taskId: 'task-123',
    stepId: 'approval'
  },
)
```

### workflows.listMapChildren

Label: List map children.
Purpose: Lists a map_workflow step's fan-out children with LIVE instance statuses (the parent's cached entries can lag out-of-band changes). Use it to drive recovery UIs.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:78

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.listMapChildren',
  {},
)
```

### workflows.loadDefinition

Label: Load workflow definition.
Purpose: Loads one workflow definition by name. Use it when a plugin needs the template shape, steps, or metadata behind a workflow id.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:64

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.loadDefinition',
  {
    name: 'docs-review'
  },
)
```

### workflows.loadInstance

Label: Load workflow instance.
Purpose: Loads the workflow instance attached to a task. Use it when a plugin needs current workflow state without reading workflow files directly.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:39

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.loadInstance',
  {
    taskId: 'task-123'
  },
)
```

### workflows.markGateNotified

Label: Mark gate notified.
Purpose: Records that a workflow gate notification was sent. Use it immediately after notifying a reviewer or channel so future checks can suppress duplicates.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:71

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.markGateNotified',
  {
    taskId: 'task-123',
    stepId: 'approval'
  },
)
```

### workflows.matchWorkflow

Label: Match workflow.
Purpose: Suggests a workflow based on a task title and description. Use it when creating tasks that should automatically pick the most relevant workflow template.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:62

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.matchWorkflow',
  {
    title: 'Improve hook docs',
    description: 'Add generated examples'
  },
)
```

### workflows.notificationChannels.list

Label: List notification channels.
Purpose: Returns workflow notification channels registered by core or plugins. Use it to show available delivery targets for gate and workflow alerts.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:87

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.notificationChannels.list',
  {},
)
```

### workflows.rejectGate

Label: Reject workflow gate.
Purpose: Rejects a pending workflow gate, records the reason, and rewinds the instance per the workflow gate policy. Use it from plugins that own an external review surface for workflow-backed tasks.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:47

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.rejectGate',
  {},
)
```

### workflows.reopenFromStep

Label: Reopen workflow from step.
Purpose: Reopens an existing workflow instance at a prior actionable step. Use it when a plugin needs explicit user recovery without creating a replacement workflow task.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:52

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.reopenFromStep',
  {},
)
```

### workflows.retryMapChild

Label: Retry map child.
Purpose: Retries one fan-out child of a map_workflow step: live children reopen in place, dead ones re-create under the same child task id. Use it to unblock a map join without rewinding the parent.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:73

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.retryMapChild',
  {},
)
```

### workflows.saveInstance

Label: Save workflow instance.
Purpose: Persists a workflow instance after a plugin has changed its state. Use it to keep workflow updates routed through the workflow plugin storage layer.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:40

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.saveInstance',
  {
    instance: {
      taskId: 'task-123',
      workflowId: 'docs-review'
    }
  },
)
```

### workflows.validateStepOutput

Label: Validate step output.
Purpose: Validates workflow step output against the step schema. Use it before accepting agent or tool output that should advance a workflow.
Kind: rpc
Source: plugins/workflows/lib/register-hooks.ts:72

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.validateStepOutput',
  {
    schema: {
      type: 'object'
    },
    output: {
      approved: true
    }
  },
)
```
