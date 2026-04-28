# Dispatch Failure Handling — Deep Reference

Two layers of defense against transient network blips (issue #115).

## Layer 1: Runtime adapter send retry

Agent delivery goes through `src/core/runtime-registry.ts` and the active
runtime adapter. Adapter implementations may retry transport-level failures,
but Bakin treats retry policy as an adapter concern. The OpenClaw adapter keeps
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

## Where to look

- `src/core/runtime-registry.ts` — runtime adapter access
- `packages/adapter-openclaw/src/runtime.ts` — OpenClaw adapter transport
- `src/core/dispatch.ts` — `classifyDispatchError`, cooldown selection, blocked escalation
