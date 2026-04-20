# Issue #115 — Dispatch: retry transient `fetch failed`, shorten transient cooldown

_Created: 2026-04-20 | Owner: Mark_

## Problem

`src/core/dispatch.ts` records every `openclaw.sendMessage` failure — including
transient `TypeError: fetch failed` / `ECONNRESET` — into
`state.failedDispatches[taskId]` and then skips the task for
`settings.dispatch.failureCooldownMs` (default **30 minutes**).

One transient network blip against an otherwise-healthy OpenClaw gateway = 30 min
of dispatch silence per task. Live reproduction on 2026-04-20: task `8ba3a224`
hit two `fetch failed` events 37 minutes apart; both required manually clearing
`~/.bakin/.dispatch-state.json#failedDispatches` to unstick the agent. The
gateway's `/healthz` was green both times.

Two problems conflated into one cooldown:

1. No in-call retry — the first `fetch` blip immediately escalates to failure.
2. `failureCooldownMs` treats "agent unreachable" and "transient fetch error"
   identically. "Agent unreachable" is what the watchdog exists to detect via
   heartbeat staleness; dispatch should not be doing that job.

## Goals

- A transient `fetch failed` / `ECONNRESET` against a healthy gateway resolves
  within the current dispatch cycle, not 30 minutes later.
- A 4xx/5xx gateway response (real outage, auth failure, malformed request)
  still triggers the long 30-min cooldown — no regression for genuine outages.
- Classification lives in one place (`classifyDispatchError`) so the rule is
  clear and testable.
- No legacy-shim handling of the old `failedDispatches` format — this is a
  single-user machine; we bump the state shape cleanly.

## Non-goals

- Watchdog race in #114 — out of scope; referenced only because it can produce
  the back-to-back dispatches that surface this bug.
- Gateway-side serialization-conflict detection (proposal #4 in the issue) —
  requires gateway cooperation; defer until the gateway actually returns a
  distinguishable 409-class response.
- UI surfacing of the new cooldown knob. `failureCooldownMs` isn't surfaced
  in System & Alerts today; we won't start now.
- Workflow dispatch path's failure record (`state.failedDispatches[task.id] = Date.now()`
  on line 606 of `dispatch.ts`) — it currently writes the legacy number format
  and bypasses the retry/count logic. We fix that drive-by so the new model is
  uniform across both dispatch paths, but it's not the primary fix.

## Design

### 1. In-call retry in `openclaw-client.sendMessage`

Wrap the `fetch` call in a retry loop, 3 attempts total with **1 s / 2 s** backoff
between them (total added wall-clock ≤ 3 s on a fully failing path, which stays
well under the 3-minute `DISPATCH_TIMEOUT_MS` per cycle).

Retry **only** on transient network errors:

- `TypeError` whose `message` includes `"fetch failed"` (node-undici's generic
  wrapper — the real cause lives on `err.cause`).
- `err.cause?.code` in `{ 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE' }`.
- `err.name === 'AbortError'` when our own timeout fires (not currently set,
  but cheap to list so we don't regress if we add a fetch timeout later).

Do **not** retry on:

- `!res.ok` paths (4xx/5xx). Those are "the gateway talked to us and said no" —
  retrying just spams it.
- JSON parse errors on a 200 response — those are structural bugs, not transient.

Emit a single `log.warn` per retry attempt with `{ agentId, attempt, error }` so
the pattern is visible in `server.log` without burying signal.

### 2. Error classification in `dispatch.ts`

A new internal helper:

```ts
type DispatchFailureKind = 'transient' | 'structural'

function classifyDispatchError(err: unknown): DispatchFailureKind {
  // Structural: "OpenClaw sendMessage failed (<status>): <body>"
  if (err instanceof Error && /^OpenClaw sendMessage failed \(\d+\)/.test(err.message)) {
    return 'structural'
  }
  // Transient: node-undici fetch wrapper and direct socket errors
  if (err instanceof TypeError && err.message.includes('fetch failed')) return 'transient'
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_CODES.has(cause.code)) return 'transient'
  if (err instanceof Error && err.name === 'AbortError') return 'transient'
  return 'structural'  // default safe side — if we don't recognize it, treat as real
}
```

### 3. Cooldown selection

`FailureRecord` gains one field: `kind: 'transient' | 'structural'`. When a
dispatch fails:

- Record `{ lastAttempt, count, kind }`.
- On the next cycle, the cooldown to wait is:
  - `kind === 'transient'` → `settings.dispatch.transientCooldownMs` (new, default **60 s**)
  - `kind === 'structural'` → `settings.dispatch.failureCooldownMs` (unchanged, 30 min)
- `count` increments across **both** kinds so the `maxRetries`-escalates-to-
  blocked path still works. A task that alternates transient/structural still
  hits the retry ceiling and gets blocked. This matches the issue's intent:
  "only escalate to cooldown if all retries fail."

### 4. Settings schema

Add to `BakinSettings.dispatch`:

```ts
dispatch: {
  intervalMs: number
  failureCooldownMs: number       // structural failures (unchanged)
  transientCooldownMs: number     // NEW — network/fetch failures, default 60_000
  maxDispatched: number
  maxRetries: number
}
```

Default:

```ts
dispatch: {
  ...,
  transientCooldownMs: 60 * 1000,
}
```

### 5. State migration

The existing `getFailureRecord()` helper already migrates the legacy plain-number
form to `{ lastAttempt, count }`. We add `kind: 'structural'` as the default for
any record missing that field — safe, because the structural cooldown is the
current behavior. No disk-shape migration script; `getFailureRecord()` is the
read path and always normalizes. On next dispatch cycle the normalized record
gets written back.

The workflow-dispatch branch at line 606 (`state.failedDispatches[task.id] = Date.now()`)
gets promoted to the same `{ lastAttempt, count, kind }` shape so there's no
second code path writing the legacy format.

## Acceptance criteria

1. **Unit**: `tests/core/openclaw-client.test.ts` — a mocked `fetch` that throws
   `TypeError('fetch failed')` twice then succeeds on attempt 3 causes
   `sendMessage()` to return successfully after 3 fetch calls.
2. **Unit**: same file — a mocked `fetch` that returns a 500 response causes
   `sendMessage()` to throw **without** retrying (only 1 fetch call observed).
3. **Unit**: `tests/core/dispatch.test.ts` — after `sendMessage` throws a
   transient error through all retries, the task's `FailureRecord` has
   `kind: 'transient'`, and a subsequent `dispatchTasks()` call 65 s later
   re-attempts dispatch (cooldown expired).
4. **Unit**: same file — after `sendMessage` throws a structural error
   (`OpenClaw sendMessage failed (500): ...`), the task's record has
   `kind: 'structural'`, and a subsequent `dispatchTasks()` 65 s later still
   skips the task (structural cooldown is 30 min).
5. **Unit**: same file — after 5 consecutive transient failures (`maxRetries`
   default), the task is moved to `blocked` via `tasks.blockTask` — ceiling
   behavior unchanged.
6. **Unit**: same file — the workflow dispatch path records the new shape, not
   the legacy number (`typeof state.failedDispatches[id] === 'object'`).
7. **Manual smoke**: kill the gateway mid-dispatch cycle, restart within 5 s,
   confirm the task lands within the same cycle (dispatch log shows retry
   warnings, then success). Gateway left dead for 10 min confirms long cooldown
   still applies.

## Test plan

- Extend `tests/core/openclaw-client.test.ts` with a retry block (mocks
  `fetch` via `global.fetch = vi.fn()`).
- Extend `tests/core/dispatch.test.ts` with a cooldown-classification block.
  Existing fake timers + mocked `openclaw.sendMessage` make this direct.
- No new integration test needed — the manual smoke covers the live gateway
  path; wiring is fully exercised by the unit tests.

## Risks

- **Retry amplification on a real outage.** If the gateway is down for a while,
  every dispatch cycle does 3 × fetch-fail = ~3 s per task before cooldown
  starts. With ~10 todo tasks that's 30 s of wasted work per cycle (cycle is
  5 min). Acceptable — small constant factor, and `ping()`-style pre-checks
  aren't reliable because the gateway can answer `/healthz` while routing
  fails.
- **Classification false negative.** If the gateway someday returns a 5xx as
  a plain TCP reset (not an HTTP response), we'd misclassify it as transient.
  Low likelihood; the fallback cost is 60 s of retry-pressure instead of
  30 min of silence, which is still better than today.
- **Default 60 s might still be too long** for chained subtask dispatches that
  assume "kick returns quickly." Mitigation: `dispatchSingleTask` (the kick
  path) goes through the same cooldown, so an `auto-kick` that races a
  transient failure will also wait 60 s. Acceptable for v1; revisit if the
  subtask flow feels sticky.
- **State-file blast**: we're writing to `.dispatch-state.json` on every
  classified-failure transition. The state lock (`withStateLock`) already
  serializes writes; adding one more field to the record is noise-level.

## Commit strategy

Checkpoint-able slices, in order:

1. **`feat(openclaw): retry transient fetch failures in sendMessage`** —
   retry loop + transient-code set in `src/core/openclaw-client.ts`, new unit
   tests. Safe to ship alone: behavior change is purely "try harder before
   throwing." No settings change yet.
2. **`feat(dispatch): classify transient vs structural failures; shorter transient cooldown`** —
   `classifyDispatchError`, `FailureRecord.kind`, `transientCooldownMs`
   setting, fix to workflow-dispatch failure recorder. New unit tests. Depends
   on (1) to be meaningful (retry exhausts → transient classification), but
   the code change itself is independent.
3. **`docs(dispatch): document retry + cooldown classification`** — update
   `.claude/knowledge/repo-architecture.md` (if it covers dispatch) and
   `CLAUDE.md` (Key Patterns section — one paragraph under a new "Dispatch
   Failure Handling" sub-bullet). Pure docs, trivial rollback.

Each commit stands alone and is individually revertable. After (1) the system
is already better (retries hide blips from the cooldown logic). After (2) the
classification is in place. (3) locks in the knowledge for future agents.

Branch: `issue-115-dispatch-retry` off `main`.

## Out-of-scope drive-bys we will NOT do

- Replacing `execFile` fallback in `sendChannelMessageCLI`.
- Adding `ping()` before dispatch to pre-check gateway health.
- Touching `watchdog.ts` — #114's territory.
- Surfacing dispatch knobs in the settings UI.
