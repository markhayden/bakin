# Plan: Issue #115 — Dispatch retry + transient cooldown

**Spec:** `.claude/specs/issue-115-dispatch-retry.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/115
**Branch:** `issue-115-dispatch-retry`
**Created:** 2026-04-20
**Author:** claude (opus-4-7) / roscoe

---

## Dependency graph

```
T0 — branch setup (issue-115-dispatch-retry from main)
       │
       ▼
T1 — feat(openclaw): retry transient fetch failures in sendMessage
     (src/core/openclaw-client.ts + tests/core/openclaw-client.test.ts)
       │
       ▼
T2 — feat(dispatch): classify transient vs structural; shorter transient cooldown
     (packages/core/src/settings.ts + src/core/dispatch.ts + tests/core/dispatch.test.ts)
       │
       ▼
T3 — docs(dispatch): document retry + cooldown classification
     (CLAUDE.md + .claude/knowledge new/updated entry)
       │
       ▼
T4 — PR + close issue
```

Linear chain — no parallelism. T2 depends on T1 logically (retry exhaustion →
transient classification is what makes T2 useful), though the code changes are
independent. T3 documents the shipped state of T1+T2 together.

---

## T0 — Branch setup

**Command:** `git checkout -b issue-115-dispatch-retry`

**Verification:** `git branch --show-current` → `issue-115-dispatch-retry`

**Risks:** None.

---

## T1 — feat(openclaw): retry transient fetch failures in sendMessage

### Files

- `src/core/openclaw-client.ts` — wrap the single `fetch` at line 69 in a
  3-attempt loop with 1 s / 2 s backoff. Add module-level
  `TRANSIENT_FETCH_CODES` set and `isTransientFetchError(err)` helper.
- `tests/core/openclaw-client.test.ts` — expand from 2 tests to 5. Mocks
  `global.fetch` directly.

### Exact change shape

In `openclaw-client.ts`:

```ts
const TRANSIENT_FETCH_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

function isTransientFetchError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch failed')) return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_FETCH_CODES.has(cause.code)) return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

// Inside sendMessage, replace the direct fetch with:
const backoffMs = [1000, 2000]  // before attempts 2 and 3
let lastErr: unknown
let res: Response | undefined
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    res = await fetch(...)
    break  // non-transient result (ok OR http error) — exit loop
  } catch (err) {
    lastErr = err
    if (!isTransientFetchError(err) || attempt === 3) throw err
    log.warn('sendMessage transient fetch failure — retrying', { agentId, attempt, error: String(err) })
    await new Promise(r => setTimeout(r, backoffMs[attempt - 1]))
  }
}
if (!res) throw lastErr  // defensive — loop invariant
```

The rest of `sendMessage` (the `!res.ok` path, JSON parsing, reply recording)
is unchanged.

### Test additions (tests/core/openclaw-client.test.ts)

Replace the thin existing file with full retry coverage:

1. `sendMessage retries on transient TypeError('fetch failed') and succeeds on attempt 3`
2. `sendMessage does NOT retry on 500 response (fetch returned, !res.ok path)`
3. `sendMessage does NOT retry on 4xx response`
4. `sendMessage throws after 3 transient failures`
5. `sendMessage retries on err.cause.code=ECONNRESET`

Keep the existing `exports expected functions` and `ping returns boolean`
tests.

Mock shape:
```ts
const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch
fetchMock
  .mockRejectedValueOnce(new TypeError('fetch failed'))
  .mockRejectedValueOnce(new TypeError('fetch failed'))
  .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
```

Use `vi.useFakeTimers()` + `vi.runAllTimersAsync()` to skip the 1s/2s backoff
waits (otherwise tests add 3 s of wall time each).

### Verification

```bash
pnpm vitest run tests/core/openclaw-client.test.ts
pnpm vitest run tests/core/dispatch.test.ts        # regression — still passes with retry in place
pnpm tsc --noEmit
```

All three must pass. The full test suite is not required at this commit
(will run at T2's checkpoint).

### Checkpoint

- [ ] `pnpm vitest run tests/core/openclaw-client.test.ts` → 7 tests passing (5 new + 2 kept)
- [ ] `pnpm vitest run tests/core/dispatch.test.ts` → existing tests still pass
- [ ] `pnpm tsc --noEmit` → no new errors in `src/core/openclaw-client.ts`
- [ ] Commit: `feat(openclaw): retry transient fetch failures in sendMessage`

### Risks

- Fake timers interaction with `await new Promise(r => setTimeout(r, ...))` —
  need `vi.runAllTimersAsync()`, not `vi.advanceTimersByTime` alone, because
  the awaited promise yields the microtask queue. If a test hangs, that's
  the cause.
- `global.fetch = fetchMock` must be restored in `afterEach` so other test
  files don't inherit the mock.

---

## T2 — feat(dispatch): classify transient vs structural; shorter transient cooldown

### Files

- `packages/core/src/settings.ts` — add `transientCooldownMs: number` to
  `BakinSettings.dispatch` (line 17 area) + default `60 * 1000` (line 144 area).
- `src/core/dispatch.ts`:
  - Extend `FailureRecord` with `kind?: 'transient' | 'structural'` (the `?`
    lets legacy-format normalizer default to structural).
  - Add `classifyDispatchError(err)` + `TRANSIENT_CODES` set.
  - Update `getFailureRecord()` to default `kind` to `'structural'` when
    migrating a legacy number or a record missing the field.
  - In the `todoTasks` loop (lines 160-173): select cooldown by
    `failure.kind === 'transient' ? settings.dispatch.transientCooldownMs
    : settings.dispatch.failureCooldownMs`.
  - In the catch block (lines 204-219): classify the caught error and write
    `{ lastAttempt: Date.now(), count: (prev?.count || 0) + 1, kind }`.
  - Same three changes in `dispatchSingleTask` (lines 266-275 and 346-349).
  - Workflow drive-by at line 606: replace `state.failedDispatches[task.id] = Date.now()`
    with a proper `FailureRecord` write using the same classification.
- `tests/core/dispatch.test.ts`:
  - Update the settings mock to include `transientCooldownMs: 60000`.
  - Add tests (see below).

### Exact change shape

Settings:
```ts
dispatch: {
  intervalMs: number
  failureCooldownMs: number
  transientCooldownMs: number   // NEW
  maxDispatched: number
  maxRetries: number
}
// DEFAULTS:
dispatch: {
  intervalMs: 5 * 60 * 1000,
  failureCooldownMs: 30 * 60 * 1000,
  transientCooldownMs: 60 * 1000,  // NEW
  maxDispatched: 500,
  maxRetries: 5,
},
```

Dispatch classification helper:
```ts
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

type DispatchFailureKind = 'transient' | 'structural'

function classifyDispatchError(err: unknown): DispatchFailureKind {
  if (err instanceof Error && /^OpenClaw sendMessage failed \(\d+\)/.test(err.message)) {
    return 'structural'
  }
  if (err instanceof TypeError && err.message.includes('fetch failed')) return 'transient'
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_CODES.has(cause.code)) return 'transient'
  if (err instanceof Error && err.name === 'AbortError') return 'transient'
  return 'structural'
}
```

FailureRecord:
```ts
interface FailureRecord {
  lastAttempt: number
  count: number
  kind: 'transient' | 'structural'
}

function getFailureRecord(entry: FailureRecord | number | undefined): FailureRecord | null {
  if (!entry) return null
  if (typeof entry === 'number') return { lastAttempt: entry, count: 1, kind: 'structural' }
  return { ...entry, kind: entry.kind ?? 'structural' }
}
```

Cooldown selection in the dispatch loop:
```ts
const cooldownMs = failure.kind === 'transient'
  ? settings.dispatch.transientCooldownMs
  : settings.dispatch.failureCooldownMs
if (Date.now() - failure.lastAttempt < cooldownMs) continue
```

Failure write:
```ts
const kind = classifyDispatchError(err)
state.failedDispatches[task.id] = {
  lastAttempt: Date.now(),
  count: (prev?.count || 0) + 1,
  kind,
}
```

Same write in `dispatchSingleTask` catch block and in the workflow dispatch
branch (replacing the legacy `= Date.now()` line).

### Test additions (tests/core/dispatch.test.ts)

New `describe('failure classification and cooldown')` block:

1. `transient fetch failure records kind="transient" and expires after transientCooldownMs`
2. `structural 5xx failure records kind="structural" and does not expire after transientCooldownMs`
3. `5 transient failures still escalates to blocked via tasks.blockTask`
4. `workflow dispatch failure writes FailureRecord shape, not legacy number`
5. `legacy number entries are normalized with kind="structural"`

Test structure (for #1):
```ts
// Seed a todo task, make openclaw.sendMessage reject with TypeError('fetch failed')
// Run dispatchTasks → expect failedDispatches[id].kind === 'transient' and count === 1
// Advance timers by 30s → run again → task still skipped (30s < 60s transient cooldown)
// Advance timers by 35s more (65s total) → run again → dispatch retried
```

### Verification

```bash
pnpm vitest run tests/core/openclaw-client.test.ts tests/core/dispatch.test.ts tests/core/settings.test.ts
pnpm vitest run                    # full suite — no regressions elsewhere
pnpm tsc --noEmit
```

Full suite must pass (or match the pre-existing unrelated failures already
documented in Phase 2 checkpoint of issue #90's plan — antfly-reranker,
search-auto-registration, search-tools-mcp, brainstorm, project-grid).

### Checkpoint

- [ ] `pnpm vitest run tests/core/dispatch.test.ts` → all tests passing (pre-existing 6 + 5 new)
- [ ] `pnpm vitest run tests/core/settings.test.ts` → still passing
- [ ] `pnpm vitest run` → no new failures vs the pre-refactor baseline
- [ ] `pnpm tsc --noEmit` → no new errors introduced
- [ ] Commit: `feat(dispatch): classify transient vs structural failures; shorter transient cooldown`

### Risks

- **Settings mock drift:** tests that mock `getSettings` and don't include
  `transientCooldownMs` in `dispatch.*` will produce `undefined`, and the
  `Date.now() - failure.lastAttempt < undefined` comparison resolves to
  `false` — meaning the task would never be skipped during cooldown. Audit
  the mocks in `tests/core/dispatch.test.ts`, `tests/core/dispatch-assets.test.ts`,
  `tests/integration/usage-wiring-agent.test.ts`, and `tests/core/settings.test.ts`.
- **Legacy state migration:** a real `~/.bakin/.dispatch-state.json` on this
  machine may still have the plain-number form. The `getFailureRecord()`
  normalizer handles it; verify manually after landing by inspecting the
  file once.
- **Import location:** `settings.test.ts` may already assert the exact shape
  of `DEFAULTS.dispatch` — adding a field means updating the expected shape.

---

## T3 — docs(dispatch): document retry + cooldown classification

### Files

- `CLAUDE.md` — add a new sub-bullet under "Key Patterns": "### Dispatch Failure
  Handling". ~6 lines. Describes: retry happens in `openclaw-client.sendMessage`
  (3 attempts, 1s/2s), classification splits transient vs structural in
  `dispatch.ts`, transient uses `dispatch.transientCooldownMs` (60 s default),
  structural keeps `dispatch.failureCooldownMs` (30 min default), both share
  `maxRetries` for the block-escalation ceiling.
- `.claude/knowledge/repo-architecture.md` (IF it covers dispatch — check
  first and only add if it fits; otherwise skip and let CLAUDE.md be the
  single source).

### Verification

```bash
pnpm vitest run            # docs-only commit, but run full suite for safety
```

Grep to confirm no stale references to the old single-cooldown model remain:

```bash
# expect: only the new sub-bullet and the new settings field
grep -rn "failureCooldownMs" CLAUDE.md .claude/
```

### Checkpoint

- [ ] `CLAUDE.md` has a "Dispatch Failure Handling" sub-bullet under Key Patterns
- [ ] `pnpm vitest run` — still clean
- [ ] Commit: `docs(dispatch): document retry + cooldown classification`

### Risks

- Scope creep — resist rewriting other CLAUDE.md sections.

---

## T4 — PR + close issue

- Push branch: `git push -u origin issue-115-dispatch-retry`
- Open PR against `main` with:
  - Title: `fix(dispatch): retry transient fetch failures and classify cooldowns (#115)`
  - Body: references #115, lists the three commits, summarizes the "before/after"
    behavior (30 min lockout → 60 s for transient), calls out the related #114
    watchdog race, includes the manual smoke plan.
- Wait for CI (no CI checks on this repo currently per recent merges, but `gh pr checks` will confirm).
- Merge when green.
- After merge: close #115 with a comment referencing the PR, archive
  `tasks/plan.md` + `tasks/todo.md`.

---

## Global checkpoints

- **After T1:** `pnpm vitest run tests/core/openclaw-client.test.ts` passes.
  System is already better — retries hide most blips. Safe to stop here if
  something goes wrong at T2.
- **After T2:** full `pnpm vitest run` + `pnpm tsc --noEmit`. No new failures.
  Manual smoke: kill gateway briefly during a dispatch cycle → task lands within
  one cycle. Gateway dead for 10 min → long cooldown still applies.
- **After T3:** docs in place, full suite still green, PR opens cleanly.

## Rollback plan

Each commit is individually revertable. If T2 breaks something subtle in the
state-file shape, `git revert <T2-sha>` + delete `~/.bakin/.dispatch-state.json`
(safe — it auto-heals on next cycle). T1 is purely additive inside sendMessage;
reverting it returns to the single-attempt behavior. T3 is docs only.

## Out-of-scope reminders

- No watchdog changes (#114).
- No gateway-side serialization detection.
- No UI for `transientCooldownMs`.
- No replacement of `execFile` CLI fallbacks.
- No cleanup of unrelated `.claude/` specs / stale TODOs.
