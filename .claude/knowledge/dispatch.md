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

## Where to look

- `src/core/app-services.ts` — boot-created runtime/search/task service object
- `packages/adapter-openclaw/src/runtime.ts` — OpenClaw adapter transport
- `src/core/dispatch.ts` — `classifyDispatchError`, cooldown selection, blocked escalation
- `src/core/restart-recovery.ts` — post-boot recovery of orphaned `inProgress` tasks
- `.claude/knowledge/adapter-architecture.md` — adapter boundaries and task/runtime ownership
