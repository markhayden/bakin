---
title: Workflows
description: "Visual multi-step recipes with gates, parallel branches, and structured outputs. Reusable across tasks."
---

Rails when your agents need them. A workflow is a graph of connected steps that get worked one at a time. Use them when order matters: review before publish, validation before commit, multi-step jobs you don't want an agent freestyling on.

Workflows attach to tasks. When an agent creates a task it picks the workflow that fits, or skips with a reason. You can change the call later from the task's detail panel: swap workflows, attach one, or detach.

<figure class="screenshot-frame">
  <figcaption>The workflows grid: each card shows the workflow's name, description, step count, and the agents it touches.</figcaption>
</figure>

## Canvas

<figure class="screenshot-frame">
  <figcaption>The canvas with steps stacked top to bottom. A "Start" node up top summarizes the inputs.</figcaption>
</figure>

Open any workflow to see its recipe on the canvas. Steps stacked top to bottom, connected by edges that follow the flow. A `Start` node up top summarizes the inputs. Each step shows its type, label, and the agent that runs it. Click any step to look inside: who owns it, what it depends on, what it expects to output, where it routes on approve or reject.

Same surface for building. No second editor to learn.

## Steps

A workflow is any number of connected steps. Every step has a type:

- **Agent step**: an agent runs the work. Output gets validated against a schema before the workflow advances.
- **Gate**: pauses for your approval before moving on. Optional notifications, configurable approve and reject paths.
- **Parallel**: groups child steps that run side by side. The workflow waits for every child to finish before it continues.
- **Output**: the terminal step. Optionally publishes the final result to channels like Discord, Slack, or email.
- **Sub-workflow**: runs another workflow inline, with its own task on the board so you can watch it move.

## Managing workflows

### Build a workflow

`+ New Workflow` puts the canvas in build mode. Drag steps from the palette, wire them together, click any step to configure it. Save and the workflow's available to attach to any task.

### Attach to a task

Agents creating a task pick the workflow that fits, or skip with a reason. Bakin nudges them with a suggestion based on the task's title, but every attach is intentional. From the task's detail panel you can swap, attach, or detach anytime.

### Approve a gate

Gates pause the workflow until you decide. The task's detail panel shows the gate and the prior step's output for context. Approve and the workflow advances; reject and it rewinds. If notifications are configured, they ping you when one's waiting; with Discord gate alerts on, you can also approve or reject straight from the message.

### Cancel a workflow

Workflows cancel automatically when their task moves to `Done` or `Blocked`, or when the task is deleted. No separate stop button.

## Concepts

- **Definitions vs instances.** A definition is the recipe. An instance is one run of that recipe tied to a specific task. Many instances of one definition.
- **Information gating.** Agents only ever see the current step, never future ones. They submit output, Bakin validates, then releases the next step.

## Where it lives

```
~/.bakin/workflows/
  definitions/*.yaml       # the recipes
  instances/<taskId>.json  # per-task runtime state
  skills/                  # workflow skill markdown
```

Definitions and instances both index into search (table `bakin_workflows`) on name, description, and step content.

## Settings

<!-- docs:settings workflows -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Gate timeout (hours) | `number` | `24` | Auto-reject gates not approved within this time |
| Max concurrent steps | `number` | `3` | Maximum steps running in parallel per workflow |
| Notify on gate | `boolean` | `true` | Send notification when a gate needs approval |
| Channel gate alerts | `boolean` | `false` | Send runtime channel approvals when gates need review |
| Gate approval channel | `string` | `general` | Runtime channel ID for gate approval messages |
| Require reject reason | `boolean` | `true` | Require a reason when rejecting from a channel approval |

</div>
<!-- /docs:settings -->

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

<!-- docs:cli-commands workflows -->
| Command | Purpose |
| --- | --- |
| `bakin workflows list` | List workflow definitions. |
| `bakin workflows start <taskId> <workflowId>` | Start a workflow. |
| `bakin workflows step <taskId>` | Get current workflow step. |
| `bakin workflows submit <taskId> <stepId> <json>` | Submit workflow step output. |
<!-- /docs:cli-commands -->

Full surface in the [CLI reference](/docs/reference/generated/cli/).

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#plugin-workflows).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents work the workflow surface through MCP exec tools. The full set covers definitions, instances, steps, and gates:

<!-- docs:exec-tools workflows -->
- `bakin_exec_workflows_complete_step`: Complete a workflow step with output. Validates output against the step schema, advances the workflow to the next step. Returns success status and whether the workflow is complete.
- `bakin_exec_workflows_get_definition`: Get a workflow definition by filename. Returns the full definition with steps, inputs, and resolved sub-workflows.
- `bakin_exec_workflows_get_instance`: Get the full state of a workflow instance for a task, including step states and history.
- `bakin_exec_workflows_get_step`: Get the current workflow step for a task. Returns only the current step (information gating — future steps are hidden). Critical for agents to know what to do next.
- `bakin_exec_workflows_list`: List all workflow definitions (templates). Returns name, filename, description, and step count for each.
- `bakin_exec_workflows_list_instances`: List workflow instances. Optionally filter by status (in_progress, pending_approval, complete, failed, cancelled).
- `bakin_exec_workflows_start`: Start a workflow instance for a task. The task must exist on the board. Returns the created instance.
<!-- /docs:exec-tools -->

Plus three top-level helpers used during agent step execution:

- `bakin_exec_get_step`: read the current step as human-readable text. Instructions, prior outputs, schema, and rejection context all in one structured view.
- `bakin_exec_submit_step`: submit step output with local pre-validation against the step schema, returning field-level errors without a server round trip.
- `bakin_exec_check_gates`: human-readable overview of every gate in the workflow. Approved, waiting, pending.

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): workflows attach to tasks and drive their execution
- [Schedule](/docs/using/schedule/): scheduled jobs can fire a workflow on cadence
- [Messaging](/docs/using/messaging/): notification channels live here, used by workflow gates
