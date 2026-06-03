# Dispatch Failure Handling — Deep Reference

Two layers of defense against transient network blips (issue #115).

## Layer 1: Runtime adapter send retry

Agent delivery goes through `getAppServices().runtime` and the active runtime
adapter. Adapter implementations may retry transport-level failures, but Bakin
treats retry policy as an adapter concern. The OpenClaw adapter keeps
provider-specific HTTP details behind `packages/adapter-openclaw`.

- `TypeError('fetch failed')`
- `ECONNRESET`-class socket errors (detected via `err.cause.code`)
- `AbortError`

HTTP responses (including 4xx/5xx) are structural adapter failures from
Bakin's point of view and should propagate immediately.

## Layer 2: Cooldown classification in the dispatch loop

When a failure reaches `dispatch.ts`, `classifyDispatchError()` splits it into:

- **`transient`** — fetch/network errors that escaped the inner retry
- **`structural`** — runtime adapter failures that are not transient network errors

Cooldown chosen by class:

| Class | Setting | Default |
|---|---|---|
| transient | `settings.dispatch.transientCooldownMs` | 60 s |
| structural | `settings.dispatch.failureCooldownMs` | 30 min |

Both classes share the `count` field. `settings.dispatch.maxRetries` (default 5) escalates to **blocked** regardless of classification.

### Provider availability detail

`task.dispatch_failed` audit entries and the matching system task log now carry
structured dispatch failure detail in addition to the retry/cooldown class:

- `category` — `model_provider_unavailable` or `runtime_unavailable`
- `reasonCode` — currently `provider_cooldown`,
  `auth_profile_unavailable`, `dispatch_timeout`, `transport_failure`,
  `runtime_adapter_failure`, or `runtime_dispatch_failed`
- `summary` — compact UI text such as
  `Dispatch failed: model provider unavailable`
- `specificReason` — drawer/debug detail such as
  `Provider in cooldown after timeout` or `Auth profile unavailable`
- `provider`, `model`, `cooldownReason` — optional extracted runtime context
- `retryable` — whether normal dispatch retry/cooldown can reasonably recover
- `rawError` — bounded raw runtime error text for technical details

Task logs store this detail under `entry.data.dispatchFailure`. Audit entries
store the same fields top-level for the activity feed. Compact surfaces should
show the generic provider-unavailable label; task detail drawers and debug
activity views may show the specific cause and raw bounded error. Do not make
raw provider text the primary UI message.

## Post-send task reconciliation

Dispatch moves a task to `inProgress` before sending the runtime message so a
fast agent cannot complete before Bakin records active work. If
`runtime.messaging.send` later rejects, `dispatch.ts` must re-read the current
task state before deciding what to do:

- If the task already left active work (`done`, `blocked`, `review`, or
  `archived`), Bakin leaves it alone and removes stale dispatch markers. This
  handles late gateway errors after an agent already called
  `bakin_exec_tasks_complete` or `bakin_exec_tasks_block`.
- If the task is still `inProgress` and the error is a known accepted-run
  terminal failure, such as `codex app-server turn idle timed out waiting for
  turn/completed`, Bakin moves the task to `blocked` and appends a sanitized
  system log.
- If the task is still `inProgress` but there is no evidence the agent accepted
  the work, Bakin returns it to `todo`, records `failedDispatches`, and lets the
  existing cooldown/retry policy handle the next attempt.

Task logs and audit entries use short sanitized summaries such as
`codex app-server idle timeout waiting for turn completion`; do not write raw
prompts, local paths, tokens, or full runtime trajectories to task logs.

## Task Eligibility

Dispatch only considers `todo` tasks that are actually eligible to run.

Eligibility checks are centralized in `isTaskDispatchEligible(task, ctx)`:

- `availableAt` is absent or at/before the current time
- `dependsOn` is absent or already completed
- assigned agent exists in the runtime roster

Invalid `availableAt` values are treated as unscheduled so malformed metadata
does not permanently strand a task. Explicit user kick dispatches can bypass the
schedule gate, but automatic dispatch and automatic subtasks cannot.

Plugins that need future work should create a real task with `availableAt`
rather than registering a private heartbeat, health check, cron, or sweep.
The dispatcher heartbeat is the wakeup surface for task-backed work.

## Persistence

`FailureRecord` on disk is `{ lastAttempt, count, kind }` at `~/.bakin/.dispatch-state.json#failedDispatches`.

Legacy plain-number entries are migrated to `{ kind: 'structural' }` by `getFailureRecord()` on read — no separate migration step needed.

## Restart recovery

Startup orphan repair lives in `src/core/restart-recovery.ts`, not in the
dispatch loop. After plugins are active and the HTTP server is listening,
`server.ts` runs one recovery pass over Bakin's task store before starting the
normal dispatch/watchdog loops:

- Plain `inProgress` tasks recover when their assigned agent heartbeat is
  missing or stale.
- Workflow-backed tasks ask the workflow plugin for `workflows.loadInstance`
  and `workflows.getActiveAgents`; recovery uses active workflow agents, not
  the card assignee.
- `pending_approval`, `complete`, and `cancelled` workflow instances are left
  alone.
- Partial parallel staleness and workflow states with no active agents are
  reported for manual attention instead of redispatching live work.
- Recovery loops share `settings.watchdog.maxAutoRecoveries`; exhausted tasks
  move to `blocked`.

When recovery returns tasks to `todo`, `server.ts` starts the loops and then
immediately triggers one dispatch cycle so recovered work does not wait for the
next interval.

## Plugin-Owned Cron Commands

The schedule plugin bridge recognizes runtime cron commands shaped like
`bakin:<pluginId>:<action>`. The reserved `pluginId` value `schedule` keeps the
legacy schedule-owned task path: the bridge looks up the schedule sidecar and
creates a Bakin task as before.

This bridge is for recurring cron integrations, not for plugin business logic
that should be represented as board tasks. Prefer `availableAt` tasks for
one-time scheduled work.

For any other plugin id, the bridge bypasses sidecar lookup and invokes
`${pluginId}.${action}.run` through `ctx.hooks`. The hook owns the work and may
return `{ ok: true, taskId? }` or `{ ok: false, error }`; no Bakin task is
created by the schedule bridge itself. Missing hooks are recorded as bridge
failures with a clear `hook plugin.action.run not registered` error.

## Where to look

- `src/core/app-services.ts` — boot-created runtime/search/task service object
- `packages/adapter-openclaw/src/runtime.ts` — OpenClaw adapter transport
- `src/core/dispatch.ts` — `classifyDispatchError`, cooldown selection, blocked escalation
- `src/core/restart-recovery.ts` — post-boot recovery of orphaned `inProgress` tasks
- `plugins/schedule/index.ts` — cron bridge, including `bakin:<pluginId>:<action>` hook dispatch
- `.claude/knowledge/adapter-architecture.md` — adapter boundaries and task/runtime ownership
