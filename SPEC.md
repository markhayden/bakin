# Spec: Scheduled Tasks Hardening + Plugin-Contributed Scheduled Domain Events (#191)

> Issue: https://github.com/markhayden/bakin/issues/191
> Status: DRAFT — awaiting approval
> Date: 2026-07-14
> Owner: Mark Hayden (single-user machine; no backwards compatibility, no shims)

## Objective

Make scheduled recurring **and one-shot** tasks rock solid — surviving runtime switches and long uptimes on a single runtime — then extend Schedule into the single calendar surface for everything time-shaped in Bakin: cron jobs, one-shot schedules, and read-only **scheduled domain events** contributed by any plugin (in-tree or external) through a typed SDK contract.

**User:** the single operator of this Bakin install (plus external plugin authors who adopt the contract).

**Success looks like:** you open Schedule's calendar and see, on correct timezone-aware math, every upcoming cron fire, every one-shot task you've queued for later, every task waiting on `availableAt` or due by `dueAt`, and (after bits adoption) every Messaging publish date and Projects milestone — each clearly labeled by source, deep-linked to its owner, and — where the owner supports it — reschedulable from a date-picker dialog. None of it breaks when a plugin is missing, the runtime is switched, or the box has been up for a year.

## Cron Stability Review (pi + openclaw) — audit findings

This review was requested alongside #191. Findings drive Workstream A.

### The Bakin-owned scheduler (fires all Bakin schedules) — SOLID
- Own tick engine (`plugins/schedule/lib/scheduler.ts` + `scheduler-loop.ts`), dependency-injected, fake-clock tested.
- Exactly-once via execution-ledger claims (`cron_fires` `(job_id, run_id)` PK); re-ticks and crashes are no-ops; `healPendingCronClaims` recovers claim-then-crash gaps.
- Startup catch-up coalesces an outage to one occurrence; within-window fires into `todo`, older into `blocked` triage; skips are visible (`schedule.fire_skipped` + `skip_reason`).
- Runtime cron is **never** in the fire path for Bakin schedules (post-#473). Runtime switches cannot kill Bakin schedules — they fire from the store regardless of adapter.

### OpenClaw cron (native, surfaced read-only) — FUNCTIONAL, LOWEST-ASSURANCE SURFACE
- Transport is CLI-shelling (`execFileAsync` per call), not gateway RPC. CRUD works with the gateway down; `runNow` implicitly needs it and doesn't surface gateway-down distinctly.
- No retries anywhere (deliberate for non-idempotent ops); 30s/35s timeouts; heavy defensive loose-JSON normalization in `cron-store.ts` signals unstable CLI output shape; `listRuns` falls back to reading `~/.openclaw/cron/runs/*.jsonl` directly.
- **Zero conformance/integration coverage** — only argv-shape unit tests with mocked exec. The conformance suite (`tests/integration/runtime-conformance/`) never touches the optional `cron` member.
- Degrade path is good: `readMergedJobs` try/catches `cron.list()` and falls back to Bakin-owned schedules with a warning.

### Pi cron — CORRECTLY ABSENT
- The `cron` member is intentionally omitted (not stubbed); consumers feature-detect member presence. Bakin schedules ARE the scheduling answer on Pi; agents self-schedule via `bakin_exec_schedule_*`. No work needed beyond conformance pinning the absence.

### Defects / gaps found (fixed in this initiative)
1. **`schedule-sync` health check is dead code that claims to be live** — written, tested, its file header says it's registered, but `plugins/schedule/index.ts` only registers `schedule-cutover`. Orphan native crons are silently undetected. → PR1
2. **`ScheduleDef.kind` allows `'at' | 'every'` but both are dead** — nothing produces them (every creation path hardcodes `kind: 'cron'`) and `scheduler.ts:62` feeds `expr` straight to the cron parser, so an `'at'` job could never fire. Vestigial type noise sitting on a latent bug. → PR2 (make `'at'` real, delete `'every'`)
3. **Calendar views hand-parse raw cron strings client-side** (`calendar-weekly.tsx`, `calendar-monthly.tsx`, `calendar-today.tsx` split cron fields by hand) instead of using the server's `cron-eval` engine — wrong for TZ/DST and anything beyond simple exprs; no server endpoint returns future occurrences. → PR3
4. **`cron_fires` ledger rows are never pruned** — unbounded growth; deleted jobs' rows linger forever. Slow on a single-user box, but real on a years-uptime machine. → PR1
5. **No test pins "Bakin schedules survive a runtime switch"** — the initiative's core fear is only enforced by architecture, not by a test. → PR1
6. Minor: duplicated hardcoded agent-color maps in `calendar-weekly.tsx` / `calendar-monthly.tsx`. → PR3 (consolidated during the calendar refactor)

### Deliberate stances we are NOT changing (documented, not fixed)
- No retry on the OpenClaw cron CLI surface (safe default for non-idempotent ops; degrade path already honest).
- `--adopt-cron` on runtime switch stays opt-in.
- Cron stays out of `CapabilitySet` (member-presence detection is the contract).

## Tech Stack

Existing stack, no new dependencies: Bun ≥1.2, TypeScript strict, Zod at boundaries, React 19 + TanStack Router (client), `cron-parser` (already sole-imported by `cron-eval.ts`), execution ledger (`bun:sqlite` via `packages/core/src/storage/db.ts`), HookRegistry for all cross-plugin calls.

## Commands

```
Full test suite:   bun run test
Single test file:  bun test tests/plugins/schedule/scheduler.test.ts --isolate
Typecheck:         bun run typecheck
Build (binary):    bun run build        # never commit generated-version.ts
Dev loop:          bun run dev          # server code NOT watched; manual restart
Dev with mock:     bun run dev:mock
Live verify:       Skill: /verify (isolated server from source)
```

## Design Decisions (locked in interview 2026-07-14)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope & order | All three workstreams, A (harden) → B (one-shot) → C (#191 events) |
| D2 | C UI surface | Full calendar grid — extend the existing Today/Week/Month views |
| D3 | Calendar math debt | Fix now: server-side occurrences endpoint via `cron-eval`; delete client-side cron parsing |
| D4 | One-shot primitive | Make `kind: 'at'` real in the scheduler; **delete** dead `'every'`; keep task `availableAt` as-is (different job: task exists now, dispatch later) |
| D5 | One-shot semantics | Post-fire: auto-disable, display "completed", run history preserved, never auto-delete. Missed-fire: identical to cron (catch-up window → todo, older → blocked triage, ledger exactly-once). Creation: NL parse ("tomorrow at 9am"), job form, exec tools |
| D6 | C contract mechanism | Hook suffix convention: providers register `{pluginId}.scheduledEvents` (hookKind `'rpc'`); Schedule discovers via `getRegisteredHooks()` suffix match, invokes each with a range, zod-validates per provider, isolates failures. `ScheduledDomainEvent` type exported from `@makinbakin/sdk`. No new core machinery |
| D7 | v1 in-tree providers | Tasks only (`availableAt` → scheduled, `dueAt` → due). Workflows deferred (no future-dated concepts in-tree). Contract additionally proven by a test-harness provider |
| D8 | Actions on events | Read-only + deep link + ONE optional verb: **reschedule** via conventional `{pluginId}.rescheduleEvent` hook; Schedule renders a date-picker ConfirmDialog. Tasks implements it. Generic action protocol rejected |
| D9 | Data path | ONE endpoint `GET /api/plugins/schedule/occurrences?from=&to=`: unified chronological feed of job occurrences (server-computed) + domain events (hook fan-in). Calendars consume it exclusively. SSE-driven refetch |
| D10 | PR structure | Four sequential PRs (below), each live-tested on 3737 before merge |
| D11 | External adoption | **In scope**: bits work item — messaging (publish dates) + projects (milestones) in `bakin-bits-official` implement the contract after PR4 merges |

## Contract Shapes (v1)

```typescript
// @makinbakin/sdk — exported for external authors
export interface ScheduledDomainEvent {
  id: string                    // stable within the owning plugin
  pluginId: string              // owner (must match the registering plugin)
  title: string
  startsAt?: string             // ISO; at least one of startsAt/dueAt required
  endsAt?: string               // ISO; optional range end
  dueAt?: string                // ISO; deadline semantics (rendered distinctly)
  kind: string                  // owner vocabulary, e.g. 'task-due' | 'publish' | 'milestone'
  status?: string               // owner vocabulary, display-only
  url?: string                  // deep link into the owner's UI
  reschedulable?: boolean       // true → owner registered {pluginId}.rescheduleEvent
  metadata?: Record<string, unknown>  // read-only extras
}

// Hook: `{pluginId}.scheduledEvents` (hookKind 'rpc')
//   input:  { from: string; to: string }        // ISO range
//   output: ScheduledDomainEvent[]
// Hook: `{pluginId}.rescheduleEvent` (hookKind 'rpc', optional)
//   input:  { eventId: string; to: string }     // new ISO instant for the event's primary date
//   output: { ok: true } | { ok: false; error: string }
```

Occurrences endpoint item (server-internal, consumed by calendars):

```typescript
type OccurrenceItem =
  | { source: 'schedule'; jobId: string; at: string; job: /* summary */ }   // cron + 'at' occurrences via cron-eval
  | { source: 'event'; event: ScheduledDomainEvent }                        // validated hook fan-in
```

Zod-validate every provider's output at Schedule's boundary; a provider that throws, times out, or returns invalid rows is dropped from the feed with a logged warning — never breaks the endpoint (acceptance criterion of #191).

## Work Breakdown & Commit Strategy

Every commit conventional, one logical change, suite green at every commit. Branches in the MAIN checkout (3737 serves them); Mark live-tests each PR before merge.

### PR1 — `fix(schedule): harden scheduling foundation` (Workstream A)
1. `fix(schedule): register the schedule-sync health check` — wire the orphaned check into `activate()`; reconcile its file-header claim with reality.
2. `feat(core): cron_fires retention sweep` — age+count-bounded pruning in the ledger (preserve rows inside the catch-up window and the most recent N per job so exactly-once dedup and run history keep working); sweep job-removed rows; wired into the existing watchdog/doctor cadence.
3. `test(conformance): pin the optional cron member` — conformance checks: member honesty (present on openclaw mock via `mockCron()`, absent on pi), CRUD round-trip against the mock, adoption path; teeth entry proving the checks bite.
4. `test(integration): Bakin schedules survive runtime switch` — both directions (openclaw→pi, pi→openclaw), with and without `--adopt-cron`; schedules keep firing post-switch.
5. `docs(knowledge): record audit stances` — update `.claude/knowledge/bakin-owned-scheduler.md` (+ `runtime-capabilities.md` cron note).

**Rollback:** pure hardening; reverting restores today's behavior exactly.

### PR2 — `feat(schedule): first-class one-shot 'at' schedules` (Workstream B)
1. `refactor(schedule): delete dead 'every' schedule kind` — narrow `ScheduleDef.kind` to `'cron' | 'at'`.
2. `feat(schedule): evaluate 'at' schedules in the engine` — `cron-eval` (or a thin kind-dispatch above it) understands `'at'` (ISO expr, exactly one occurrence); scheduler tick + startup catch-up + `nextRun`/`prevRun` handle it; post-fire auto-disable with preserved history; "completed" derivation in `MergedJob`.
3. `feat(schedule): create one-shot schedules end-to-end` — NL parse one-shot phrases; `schedule-input` + `job-form` support; routes + zod; exec tools (`bakin_exec_schedule_create` accepts one-shots) so agents self-schedule on any runtime.
4. `test(schedule): one-shot lifecycle` — fake-clock: fires once, never re-fires, catch-up within window, blocked triage beyond, completed display state.
5. `docs(knowledge): one-shot semantics` — scheduler knowledge doc section.

**Rollback:** reverting removes the feature; no schema migration (sidecar JSON is additive).

### PR3 — `refactor(schedule): server-computed occurrences feed the calendars` (Workstream C1 — behavior-preserving debt fix)
1. `feat(schedule): occurrences endpoint` — `GET /occurrences?from=&to=` computing per-job occurrences via `occurrencesBetween` (jobs only at this stage; TZ-correct).
2. `refactor(schedule): calendars consume the occurrences endpoint` — Today/Week/Month render fetched occurrences; DELETE all client-side cron parsing (`getJobHour`/`jobOnDow`/`expandField`/`jobFiringOnDay`); consolidate the duplicated agent-color maps into one shared module.
3. `test(schedule): occurrence endpoint + calendar rendering` — TZ/DST cases the old client math got wrong; calendar view tests updated to fixture the endpoint.

**Rollback:** revert restores client-side math; zero feature loss (this PR adds none).

### PR4 — `feat(schedule): plugin-contributed scheduled domain events` (Workstream C2 — the #191 feature)
1. `feat(sdk): ScheduledDomainEvent contract types` — SDK-exported types + zod schema.
2. `feat(schedule): domain-event fan-in on the occurrences endpoint` — hook discovery by suffix, per-provider validation/isolation/timeout, unified sorted feed, SSE refetch conventions.
3. `feat(tasks): tasks.scheduledEvents provider` — availableAt/dueAt tasks as events, deep links to the board.
4. `feat(schedule): render domain events on the calendars` — visually distinct from job occurrences (source/kind badges), event popover with deep link; graceful empty/missing-provider behavior.
5. `feat(schedule): reschedule verb` — `reschedulable` events get a date-picker ConfirmDialog invoking `{pluginId}.rescheduleEvent`; `feat(tasks): rescheduleEvent hook` implements it for availableAt/dueAt.
6. `test(schedule|tasks|sdk): contract, providers, isolation` — including the #191 acceptance criterion: a broken/missing provider drops its events without breaking Schedule.
7. `docs: contract authoring guide` — `docs/src/content/docs/extending/plugins/` page for external authors; `.claude/knowledge/` doc for the contract; CLAUDE.md Key Patterns blurb; schedule + tasks plugin manifest version bumps.

**Rollback:** revert leaves PR3's correct calendars intact; contract disappears cleanly (hooks unregister with plugins).

### Work item 5 — bits adoption (`bakin-bits-official`, after PR4 merges)
- `messaging.scheduledEvents` (publish dates, reschedulable) + `projects.scheduledEvents` (milestones, read-only) in their respective plugins; manifest version bumps per bits convention.
- Live-verified against the real install; note: installed projects plugin was previously hot-patched — reconcile installed state with repo state first.

## Project Structure (touched surfaces)

```
plugins/schedule/lib/         → scheduler, cron-eval kind dispatch, occurrences, event fan-in
plugins/schedule/lib/routes/  → occurrences route
plugins/schedule/components/  → calendar-{today,weekly,monthly}, event popover, reschedule dialog
plugins/tasks/lib/            → scheduledEvents + rescheduleEvent providers
packages/sdk/src/             → ScheduledDomainEvent types (+ zod)
packages/core/src/execution/  → cron_fires retention
tests/plugins/schedule/       → engine/endpoint/calendar/contract tests
tests/integration/runtime-conformance/ → cron member conformance
tests/integration/            → switch-survival test
.claude/knowledge/            → bakin-owned-scheduler.md update + scheduled-events doc
docs/src/content/docs/extending/plugins/ → external-author contract guide
```

## Code Style

Match surrounding code. Example of the provider registration (the pattern external authors copy):

```typescript
// plugins/tasks/index.ts — inside activate(ctx)
ctx.hooks.register(
  'tasks.scheduledEvents',
  async (data: { from: string; to: string }): Promise<ScheduledDomainEvent[]> => {
    return listScheduledTaskEvents(parseRange(data))
  },
  { pluginId: 'tasks', metadata: { hookKind: 'rpc', label: 'Scheduled task events' } },
)
```

Conventions: kebab-case files, PascalCase types, zod at every boundary, `createLogger('schedule')`, no empty catches, `const` over `let`, URL-backed view state via `useQueryState`.

## Testing Strategy

- **bun:test**, all files mock both content-dir resolvers + OpenClaw home per CLAUDE.md; `--isolate`; RTL files import `rtl-settle`.
- Engine/lifecycle: fake-clock unit tests (existing harness in `tests/plugins/schedule/helpers/`).
- Ledger retention: real-ledger temp-dir tests with `closeDb()` teardown.
- Conformance: shared checks across mock/pi/openclaw-mock + teeth file.
- Contract: zod validation, per-provider fault isolation (throwing provider, invalid rows, slow provider), missing-plugin graceful drop.
- UI: calendar view tests against fixtured occurrences endpoint; reschedule dialog flow.
- Every PR: full `bun run test` green + live verification on 3737 by Mark before merge.

## Boundaries

- **Always:** ledger claims before any fire; zod at hook boundaries; per-provider fault isolation; occurrence math server-side only; docs updated in the same PR as the change; bits plugin manifest version bumps in the same PR.
- **Ask first:** any ledger schema migration beyond the retention sweep; any change to dispatch semantics of `availableAt`; any new settings keys; touching the live `~/.bakin` state.
- **Never:** runtime cron in the Bakin-schedule fire path; Schedule mutating plugin domain data outside the typed reschedule hook; parallel occurrence-math implementations; auto-converting raw dates/files into events; backwards-compat shims (single-user machine — delete dead surface instead).

## Success Criteria

1. `bakin doctor --full` runs the schedule-sync check; orphan native crons are detected and repairable.
2. Conformance suite fails if an adapter lies about cron presence/behavior; teeth prove it.
3. Integration test proves Bakin schedules fire after a runtime switch in both directions.
4. `cron_fires` is bounded; retention never breaks exactly-once inside the catch-up window (test-pinned).
5. "Remind me tomorrow at 9am" as an agent exec-tool call creates a one-shot that fires exactly once, survives a restart, catches up if missed, and shows "completed" with history afterward.
6. Calendars place a `30 21 * * *` job correctly across a DST boundary in the job's tz (test-pinned; the old client math demonstrably couldn't).
7. A plugin registering `{pluginId}.scheduledEvents` appears on the calendar, clearly badged, deep-linked; killing that plugin removes its events and nothing else breaks.
8. A waiting task's date can be moved from the calendar via the reschedule dialog; the task's `availableAt` actually changes.
9. Messaging publish dates + Projects milestones visible on the calendar (bits work item).
10. All knowledge docs + external-author docs updated; README checked (no impact expected); zero regressions in the existing schedule test suite.

## Open Questions (for the plan phase, not blockers)

All resolved at plan review 2026-07-14 (details in `tasks/schedule-hardening-and-events/plan.md`):
1. Retention: max-age **30 days**, keep-last-20-per-job, never prune pending/recent rows; sweep daily.
2. Provider timeout: 2s per provider — ship it, log elapsed time on every drop, watch real latencies during live testing and retune if tight.
3. `'at'` NL vocabulary: enumerated in plan (tomorrow/today/weekday/in-N/date phrases + ISO + date-picker fallback).
4. Past occurrences: yes — full-range feed annotated past/future, past fires enriched with ledger disposition.
