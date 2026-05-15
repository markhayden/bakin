# Spec: Task Availability And Messaging Refactor Foundation

## Objective

Add the core task scheduling primitives needed by the Messaging refactor:

- tasks can declare when they become dispatch-eligible
- dispatch skips future scheduled tasks
- the task board can show scheduled work without using a separate column
- workflows can create follow-up tasks with the same task contract
- Schedule remains focused on cron/recurring jobs, not plugin business sweeps

This spec supports the companion Messaging refactor in `bakin-bits-official`.

## Commands

```bash
bun test --isolate
bun run typecheck
bun run lint
bun run docs:generate
bun run docs:check
```

## Task Contract

```ts
interface Task {
  availableAt?: string
  dueAt?: string
  source?: {
    pluginId?: string
    entityType?: string
    entityId?: string
    purpose?: string
  }
}
```

`availableAt` is the earliest dispatch pickup time.

`dueAt` is a deadline or user-facing expected completion time.

`source` records the plugin/domain entity that created the task.

## Dispatch Eligibility

Dispatch must only pick up todo tasks that are eligible:

```ts
isDispatchEligible(task, now) =
  task.column === 'todo'
  && (!task.availableAt || Date.parse(task.availableAt) <= now)
  && dependenciesAreComplete(task)
  && agentExists(task.agent)
```

Invalid `availableAt` values should not brick dispatch. Treat invalid timestamps as unscheduled, and rely on validation at create/update boundaries to prevent bad values from normal callers.

## UI Contract

Scheduled tasks are not a column. They stay in their normal column and render in a grouped scheduled section when `availableAt > now`.

The task board must expose a `Show scheduled` filter.

## Workflow Contract

Workflows should support a built-in `createTask` node. It creates real board tasks and accepts `availableAt`, `dueAt`, `source`, `parentId`, `workflowId`, `agent`, and an idempotency key.

Implemented as the built-in `createTask` step. The runtime uses a deterministic
task id by default (`${parentTaskId}--${step.id}`) and treats an existing task as
an idempotent success instead of creating a duplicate.

## Schedule Boundary

The Schedule plugin remains responsible for cron and recurring runtime jobs. It should not be the one-shot task scheduling mechanism for Messaging prep work, and plugins should not register cron jobs to wake their own business logic.

## Verification Completed

- `bun run typecheck`
- `bun run lint`
- `bun test --isolate`
- `bun run docs:check`
- stale sweep scan for `bakin:messaging:sweep`, `messaging.sweep.run`,
  `runMessagingContentSweep`, `content-sweep`, and `sweepCronSchedule`
