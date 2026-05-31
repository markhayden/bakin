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

### assets.getAssetTypes

Label: List asset types.
Purpose: Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.
Kind: rpc
Source: plugins/assets/index.ts:291

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.getAssetTypes',
  {},
)
```

### assets.purgeClipboardForTask

Label: Purge task clipboard assets.
Purpose: Deletes clipboard-sourced assets associated with a completed task when that cleanup setting is enabled. Use it from task completion flows that want asset cleanup to stay centralized.
Kind: rpc
Source: plugins/assets/index.ts:295

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
Source: plugins/assets/index.ts:292

Example:

```ts
const result = await ctx.hooks.invoke(
  'assets.resolveServe',
  {},
)
```

## Health

Health hooks expose registered readiness and diagnostic checks so other surfaces can list or inspect them.

### health.getCheck

Label: Get a health check.
Purpose: Returns metadata for one registered health check by id, without running the check. Use it when a plugin needs the check name, owner, and autofix capability before deciding what to show or run.
Kind: rpc
Source: plugins/health/index.ts:476

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
Purpose: Returns the health checks registered by core and plugins without executing them. Use it when another surface needs to show the available diagnostics or autofix support.
Kind: rpc
Source: plugins/health/index.ts:475

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
Source: plugins/models/index.ts:700

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
Source: plugins/models/index.ts:716

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getAvailableModels',
  {},
)
```

### models.getEffectiveModel

Label: Get effective model.
Purpose: Resolves the model an agent will actually use after defaults, overrides, and provider settings are applied. Use it when a plugin needs runtime-ready model information for one agent.
Kind: rpc
Source: plugins/models/index.ts:704

Example:

```ts
const result = await ctx.hooks.invoke(
  'models.getEffectiveModel',
  {
    agentId: 'patch'
  },
)
```

### models.markConfigDirty

Label: Mark config dirty.
Purpose: Marks model configuration as changed so the runtime knows a refresh is needed. Use it after writing model settings that should not be treated as live yet.
Kind: event
Source: plugins/models/index.ts:712

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
Source: plugins/models/index.ts:714

Example:

```ts
await ctx.hooks.callAll(
  'models.markRuntimeRestarted',
  {},
)
```

## Schedule

### schedule.ensureBakinJob

Label: Ensure Bakin schedule
Purpose: Create or update a Bakin-managed runtime cron job and return the provider job id.
Kind: rpc
Source: plugins/schedule/index.ts:1066

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
Source: bakin-bits-official/plugins/projects/index.ts:222

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
Source: bakin-bits-official/plugins/projects/index.ts:211

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

### team.getAgent

Label: Get an agent.
Purpose: Returns one runtime agent by id, including team-aware metadata when available. Use it when a plugin already has an agent id and needs the full display record.
Kind: rpc
Source: plugins/team/index.ts:1748

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
Source: plugins/team/index.ts:1753

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
Source: plugins/team/index.ts:1760

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
Source: plugins/team/index.ts:1766

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
Source: plugins/team/index.ts:1757

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
Source: plugins/team/index.ts:1747

Example:

```ts
const result = await ctx.hooks.invoke(
  'team.list',
  {},
)
```

### team.resolveProfile

Label: Resolve agent profile.
Purpose: Returns the runtime profile for an agent id. Use it when a plugin needs the lower-level profile data behind an agent display record.
Kind: rpc
Source: plugins/team/index.ts:1754

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
Source: plugins/workflows/index.ts:1592

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
Source: plugins/workflows/index.ts:1618

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
Source: plugins/workflows/index.ts:1622

Example:

```ts
await ctx.hooks.callAll(
  'workflows.cancelInstance',
  {
    taskId: 'task-123'
  },
)
```

### workflows.completeStep

Label: Complete workflow step.
Purpose: Submits output for a workflow step and advances the instance when validation passes. Use it from agents or tools that finish a workflow action.
Kind: rpc
Source: plugins/workflows/index.ts:1610

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
Source: plugins/workflows/index.ts:1591

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
Source: plugins/workflows/index.ts:1612

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.definitions.list',
  {},
)
```

### workflows.getActiveAgents

Label: List active workflow agents.
Purpose: Returns agents currently active in a workflow task. Use it for coordination, notification, or assignment views that need live workflow participants.
Kind: rpc
Source: plugins/workflows/index.ts:1617

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
Source: plugins/workflows/index.ts:1609

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
Source: plugins/workflows/index.ts:1628

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
Source: plugins/workflows/index.ts:1608

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
Source: plugins/workflows/index.ts:1619

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

### workflows.loadDefinition

Label: Load workflow definition.
Purpose: Loads one workflow definition by name. Use it when a plugin needs the template shape, steps, or metadata behind a workflow id.
Kind: rpc
Source: plugins/workflows/index.ts:1613

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
Source: plugins/workflows/index.ts:1589

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
Source: plugins/workflows/index.ts:1620

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
Source: plugins/workflows/index.ts:1611

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
Source: plugins/workflows/index.ts:1627

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
Source: plugins/workflows/index.ts:1596

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
Source: plugins/workflows/index.ts:1601

Example:

```ts
const result = await ctx.hooks.invoke(
  'workflows.reopenFromStep',
  {},
)
```

### workflows.saveInstance

Label: Save workflow instance.
Purpose: Persists a workflow instance after a plugin has changed its state. Use it to keep workflow updates routed through the workflow plugin storage layer.
Kind: rpc
Source: plugins/workflows/index.ts:1590

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
Source: plugins/workflows/index.ts:1621

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
