---
title: Workflows
description: "Visual multi-step recipes with gates, parallel branches, and structured outputs. Reusable across tasks."
---

Workflows are the recipes Bakin runs against tasks. Multi-step, optionally gated, optionally parallel. Define them visually as node graphs, attach them to tasks, and watch instances move through the steps as agents work.

## The workflows view

<figure class="screenshot-frame">
  <figcaption>The workflows grid showing definitions with step counts and last-run status.</figcaption>
</figure>

Card grid of workflow definitions. Each card shows name, description, step count, and last instance status. Click in for the detail view (definition graph + recent instances).

## The canvas editor

<figure class="screenshot-frame">
  <figcaption>The visual workflow editor with a node-type palette on the left and the graph canvas on the right.</figcaption>
</figure>

`+ New Workflow` (or edit an existing one) opens the canvas. Drag nodes from the palette, connect them with edges, configure each step in the side drawer. Save persists to YAML.

Built-in node types:

- **Trigger** — entry point, fires when the workflow starts.
- **Agent step** — an agent performs work and emits structured output.
- **Gate** — human approval required before the workflow advances.
- **Parallel** — branches run concurrently and rejoin.
- **Output** — final structured result.
- **Sub-workflow** — call another workflow inline.

Plugins can add more node types via `registerNodeRenderer` so custom visualizations slot in.

## Common actions

### Start a workflow on a task

From a task's detail panel, attach a workflow. A new instance gets created and the first step dispatches to the assigned agent.

### Submit step output

When an agent finishes a step, it submits structured output that gets validated against the step's schema. Validation fails fast with a clear error.

### Approve a gate

Gates pause the workflow until you approve from the UI or via the CLI. Channels (Slack, Discord, email) ping you when a gate is ready.

### Cancel an in-flight instance

From the instance view, cancel to short-circuit. The task stays; the workflow just stops advancing.

## Concepts

- **Definitions vs instances.** A definition is a YAML template. An instance is a single run tied to a specific task. You can have many instances of one definition.
- **Schemas validate every output.** Each step declares what its output must look like. Bakin enforces it on submit so downstream steps get predictable data.
- **Gates and channels.** Gates are paired with notification channels. Workflows owns the channel registry, so anything that needs to ping a human wires through here.

## Where it lives

```
~/.bakin/workflows/
  definitions/*.yaml       # the recipes
  instances/<taskId>.json  # per-task runtime state
  skills/                  # workflow skill markdown
```

Definitions and instances both index into search (table `bakin_workflows`) on name, description, and step content.

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

- `bakin_exec_get_step`: fetch the current step's input data
- `bakin_exec_submit_step`: submit step output (same as the CLI form)
- `bakin_exec_check_gates`: ask whether a gate is open and ready to advance

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Tasks](/docs/using/tasks/): workflows attach to tasks and drive their execution
- [Schedule](/docs/using/schedule/): scheduled jobs can fire a workflow on cadence
- [Messaging](/docs/using/messaging/): notification channels live here, used by workflow gates
