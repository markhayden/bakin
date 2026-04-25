# Dispatch Failure Handling — Deep Reference

Two layers of defense against transient network blips (issue #115).

## Layer 1: HTTP retry inside the OpenClaw client

`openclaw-client.sendMessage` wraps `fetch` in a 3-attempt retry loop with 1 s / 2 s backoff, retrying **only** on transient errors:

- `TypeError('fetch failed')`
- `ECONNRESET`-class socket errors (detected via `err.cause.code`)
- `AbortError`

HTTP responses (including 4xx/5xx) **never** retry — those represent a real upstream decision and should propagate immediately.

## Layer 2: Cooldown classification in the dispatch loop

When a failure reaches `dispatch.ts`, `classifyDispatchError()` splits it into:

- **`transient`** — fetch/network errors that escaped the inner retry
- **`structural`** — any `OpenClaw sendMessage failed (<status>)` error (real HTTP failure)

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

- `src/core/openclaw-client.ts` — inner retry loop
- `src/core/dispatch.ts` — `classifyDispatchError`, cooldown selection, blocked escalation
