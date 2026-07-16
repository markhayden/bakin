# Implementation Plan: Schedule Hardening + Plugin-Contributed Scheduled Domain Events (#191)

> Spec: `SPEC.md` (root). Issue: https://github.com/markhayden/bakin/issues/191
> Four sequential PRs in this repo + one bits work item. Each PR: branch in MAIN checkout, full suite green at every commit, Mark live-tests on 3737, merge after approval.

## Overview

Harden the scheduling foundation (register the dead `schedule-sync` doctor check, bound `cron_fires`, pin cron conformance + switch survival), make one-shot `'at'` schedules real, move occurrence math server-side, then ship the #191 contract: `{pluginId}.scheduledEvents` hook fan-in rendered on the existing calendars, with a single `reschedule` verb, proven in-tree by tasks and externally by messaging/projects in bakin-bits-official.

## Architecture Decisions (carried from SPEC.md D1–D11, plus plan-phase resolutions)

- **Open Q1 — retention parameters (RESOLVED 2026-07-14):** prune `cron_fires` rows older than **30 days**, always keeping the **most recent 20 per job**, and NEVER pruning `pending` rows or rows newer than `max(catchUpWindowMinutes, 7 days)` (dedup safety margin). Sweep runs once per day from the scheduler loop (schedule plugin owns its data lifecycle; ledger exposes the verb).
- **Open Q2 — provider timeout (RESOLVED, observe in practice):** 2s per provider, invoked in parallel; a timed-out provider is dropped from that response with a logged warning (same philosophy as the search query budget). Every drop logs the provider's elapsed time; during PR4 live testing and bits adoption we watch real provider latencies and retune if 2s is ever tight.
- **Open Q3 — `'at'` NL vocabulary (deterministic regex tier):** `tomorrow at <time>`, `today at <time>`, `<weekday> at <time>` (next occurrence), `in <N> minutes/hours/days`, `<month> <day> [at <time>]`, ISO-8601 passthrough. UI always offers a datetime-picker fallback; the existing LLM fallback learns to emit `kind: 'at'`.
- **Open Q4 — past occurrences:** yes. The occurrences endpoint returns math-computed occurrences for the full requested range annotated `past`/`future`, and enriches past Bakin-job occurrences with ledger disposition (`created`/`skipped`) so the calendar can show fired-vs-skipped. Additive field; lands in PR3.
- **Zod schema placement:** the `ScheduledDomainEvent` TS type lives in `@makinbakin/sdk` (what external authors import); the zod validation schema lives server-side in `plugins/schedule` (the validation point). Keeps zod out of the SDK client bundle surface.
- **SSE refresh convention:** providers emit a `<pluginId>.scheduled_events_changed` activity event when their domain dates change; the schedule client refetches occurrences on `schedule.*` events (existing behavior) plus any `*.scheduled_events_changed`.

## Dependency Graph

```
PR1 (independent hardening) ──────────────┐
PR2 'at' engine ── depends on nothing new ┤
PR3 occurrences endpoint ── benefits from PR2 ('at' occurrences flow through)
PR4 contract + providers + UI ── depends on PR3 (fan-in extends the endpoint)
bits adoption ── depends on PR4 merged
```

PR1 and PR2 are independent of each other; order kept A→B for risk (fail fast on foundation). PR3 must precede PR4.

---

## Phase 1 — PR1 `fix(schedule): harden scheduling foundation`

### Task 1: Register the schedule-sync health check
**Description:** Wire the orphaned `checkScheduleSync`/`scheduleSyncRepair` into `activate()` alongside `schedule-cutover`; make the file-header claim true.
**Acceptance:**
- [ ] `bakin doctor --full` lists and runs `schedule.schedule-sync`
- [ ] An orphan native cron (present in `cron.list()`, absent from sidecar) yields a warn finding with working repair
- [ ] Runtimes without cron (pi) → check returns OK, never errors
**Verify:** `bun test tests/plugins/schedule/health-checks.test.ts --isolate` + new registration assertion in activation test
**Dependencies:** None
**Files:** `plugins/schedule/index.ts`, `plugins/schedule/lib/health-checks.ts`, `tests/plugins/schedule/health-checks.test.ts`
**Size:** S

### Task 2: cron_fires retention sweep
**Description:** New ledger verb `pruneCronFires({ maxAgeDays, keepPerJob, minAgeMs })` (domain verb in `packages/core/src/execution/ledger.ts`, facade re-export). Deletes old `created`/`skipped`/`seeded` rows per the Q1 policy (30d); never touches `pending` or rows newer than the safety margin. Scheduler loop calls it at most once per day.
**Acceptance:**
- [ ] Rows older than 30d pruned; newest 20 per job always survive; `pending` rows never pruned regardless of age
- [ ] Dedup still holds: a re-tick inside the catch-up window after a sweep does not double-fire (test-pinned)
- [ ] Sweep is audited (`schedule.retention_swept` activity event with counts) — never silent
**Verify:** new `tests/core/ledger-retention.test.ts` (real ledger in temp dir, `closeDb()` teardown) + fake-clock scheduler test for the daily cadence
**Dependencies:** None
**Files:** `packages/core/src/execution/ledger.ts`, `src/core/execution-ledger.ts`, `plugins/schedule/lib/scheduler-loop.ts`, tests
**Size:** M

### Task 3: Cron conformance coverage
**Description:** Add a cron section to the runtime-conformance suite: when the adapter exposes `cron`, CRUD round-trip + `listRuns` shape + `get` of missing id behave per contract; when absent (pi), the member is truly absent (not a throwing stub). Mock opts in via existing `mockCron()`. Teeth entry proves the checks bite.
**Acceptance:**
- [ ] Conformance fails on a lying adapter (teeth: a stub that throws on `list` or returns malformed jobs)
- [ ] pi conformance asserts `cron` is `undefined`
- [ ] openclaw-mock + mock adapters pass the CRUD round-trip
**Verify:** `bun test tests/integration/runtime-conformance/ --isolate`
**Dependencies:** None
**Files:** `tests/integration/runtime-conformance/conformance.ts`, the four `*.conformance.test.ts` files
**Size:** M

### Task 4: Switch-survival integration test
**Description:** Integration test: create a Bakin schedule, run `switchRuntime` openclaw→pi and pi→openclaw (mocked adapters), assert the schedule still exists, still ticks, and fires exactly once post-switch; repeat with `--adopt-cron` covering a native cron becoming a Bakin job that then fires.
**Acceptance:**
- [ ] Both directions pass; fired task created exactly once post-switch
- [ ] `--adopt-cron` path: adopted job fires from the Bakin tick after switch
**Verify:** new `tests/integration/schedule-switch-survival.test.ts`
**Dependencies:** Task 3 (reuses mock adapters with `mockCron()`)
**Files:** `tests/integration/schedule-switch-survival.test.ts`
**Size:** M

### Task 5: Knowledge-doc updates for the audit
**Description:** Record audit stances in `.claude/knowledge/bakin-owned-scheduler.md` (retention, schedule-sync now live, conformance coverage) and a cron note in `runtime-capabilities.md` (no-retry stance, member-presence contract now conformance-pinned).
**Acceptance:** docs match shipped behavior; no stale claims
**Verify:** manual read-through
**Dependencies:** Tasks 1–4
**Files:** `.claude/knowledge/bakin-owned-scheduler.md`, `.claude/knowledge/runtime-capabilities.md`
**Size:** XS

### Checkpoint 1 — PR1
- [ ] `bun run test` + `bun run typecheck` green
- [ ] Live on 3737: doctor shows schedule-sync; schedules still fire
- [ ] Mark approves → merge PR1

---

## Phase 2 — PR2 `feat(schedule): first-class one-shot 'at' schedules`

### Task 6: Delete the dead 'every' kind
**Description:** Narrow `ScheduleDef.kind` to `'cron' | 'at'`; remove `'every'` from `types.ts`, `jobs-reader.ts` normalization, and any zod unions. Pure deletion.
**Acceptance:** typecheck green; no `'every'` string remains in plugins/schedule
**Verify:** `bun run typecheck` + `grep -rn "'every'" plugins/schedule` empty
**Dependencies:** None
**Files:** `plugins/schedule/types.ts`, `plugins/schedule/lib/jobs-reader.ts`
**Size:** XS

### Task 7: Evaluate 'at' schedules in the engine
**Description:** Introduce kind-dispatch (`schedule-eval` layer over `cron-eval`): `nextRun`/`prevRun`/`occurrencesBetween` take a `ScheduleDef`; `'at'` = exactly one occurrence at the ISO instant. Scheduler tick + startup catch-up handle it via the existing occurrence-claim path (runId = `jobId:occurrenceISO`, so exactly-once and missed-window semantics are inherited). Post-fire: auto-disable (`enabled: false`) with the run recorded; `MergedJob` derives a `completed` display state (fired one-shot). Sidecar stays additive — no migration.
**Acceptance:**
- [ ] Fake-clock: 'at' fires exactly once at its instant; never re-fires after restart or re-tick
- [ ] Missed within window → todo; missed beyond → blocked with `MISSED_WINDOW_REASON`; both exactly-once
- [ ] After firing, job is disabled, `MergedJob.completed === true`, run history shows the fire
**Verify:** `bun test tests/plugins/schedule/scheduler.test.ts tests/plugins/schedule/cron-eval.test.ts --isolate` (extended) + new one-shot lifecycle test
**Dependencies:** Task 6
**Files:** `plugins/schedule/lib/cron-eval.ts` (or new `schedule-eval.ts`), `lib/scheduler.ts`, `lib/fire-engine.ts`, `lib/jobs-reader.ts`, `types.ts`, tests
**Size:** M

### Task 8: One-shot creation — server paths
**Description:** NL parser learns the Q3 one-shot vocabulary (deterministic tier emits `kind: 'at'` + ISO; LLM fallback prompt updated); `ParseResult` carries kind; create/update routes + zod accept `'at'`; exec tools (`bakin_exec_schedule_create/update/parse`) accept it so agents self-schedule one-shots on any runtime; prompt-guard applies unchanged.
**Acceptance:**
- [ ] `POST /parse` on "tomorrow at 9am" returns kind 'at' with correct ISO in the job tz
- [ ] `bakin_exec_schedule_create` with a one-shot phrase creates a working 'at' job
- [ ] Past-instant creation is rejected with a clear error
**Verify:** `bun test tests/plugins/schedule/cron-parser.test.ts tests/plugins/schedule/routes-jobs.test.ts tests/plugins/schedule/exec-tools.test.ts --isolate`
**Dependencies:** Task 7
**Files:** `plugins/schedule/lib/cron-parser.ts`, `lib/routes/jobs.ts`, `lib/job-service.ts`, `lib/exec-tools.ts`, tests
**Size:** M

### Task 9: One-shot creation — UI
**Description:** `schedule-input` gains a recurring/one-time mode (NL field still primary; datetime-picker fallback for one-time); `job-form` submits kind 'at'; `job-row`/`job-drawer` display the "completed" state and the one-shot's target instant; list filtering treats completed one-shots sensibly (shown, badged, not "active").
**Acceptance:**
- [ ] Create a one-shot from the UI end-to-end; drawer shows completed state + run history after fire
- [ ] Existing recurring flow unchanged (no regressions in job-form tests)
**Verify:** `bun test tests/plugins/schedule/schedule-page.test.tsx tests/plugins/schedule/job-drawer.test.tsx --isolate` (extended)
**Dependencies:** Task 8
**Files:** `plugins/schedule/components/schedule-input.tsx`, `job-form.tsx`, `job-row.tsx`, `job-drawer.tsx`, tests
**Size:** M

### Task 10: Docs — one-shot semantics
**Description:** `.claude/knowledge/bakin-owned-scheduler.md` gains the one-shot section (semantics, completed state, NL vocabulary); schedule plugin README/manifest version bump.
**Verify:** manual read-through; manifest version bumped
**Dependencies:** Tasks 7–9
**Files:** `.claude/knowledge/bakin-owned-scheduler.md`, `plugins/schedule/bakin-plugin.json`, `plugins/schedule/README.md`
**Size:** XS

### Checkpoint 2 — PR2
- [ ] Full suite + typecheck green
- [ ] Live: "remind me tomorrow at 9am" via exec tool → job visible, fires (test with a near-future instant), completed state correct
- [ ] Mark approves → merge PR2

---

## Phase 3 — PR3 `refactor(schedule): server-computed occurrences feed the calendars`

### Task 11: Occurrences endpoint
**Description:** `GET /api/plugins/schedule/occurrences?from=&to=` (zod-validated ISO range, capped span e.g. 62 days). For every merged job: occurrences via the kind-aware eval (Task 7), each annotated `past`/`future`; past Bakin-job occurrences enriched with ledger disposition (`created`/`skipped` + taskId/skipReason). Sorted ascending. Jobs-only at this stage.
**Acceptance:**
- [ ] DST-crossing cron in a non-UTC tz places correctly (pinned with the exact case the client math got wrong)
- [ ] 'at' jobs appear once; disabled jobs excluded from future (past fires still shown)
- [ ] Range >62 days → 400
**Verify:** new `tests/plugins/schedule/occurrences-route.test.ts`
**Dependencies:** PR2 merged (kind-aware eval)
**Files:** `plugins/schedule/lib/routes/jobs.ts` (or new `routes/occurrences.ts`), `lib/occurrences.ts`, tests
**Size:** M

### Task 12: Calendars consume the endpoint
**Description:** New `useOccurrences(from, to)` client hook (SSE-refetch on `schedule.*`); Today/Week/Month render fetched occurrences; DELETE `getJobHour`/`getJobMinute`/`jobOnDow`/`formatJobTime`/`expandField`/`jobFiringOnDay` and all client cron parsing; consolidate the duplicated `AGENT_STYLES`/`AGENT_DOT_GLOW` maps into one shared module; past-fire disposition dots (fired/skipped).
**Acceptance:**
- [ ] All three views render from the endpoint; zero cron-string parsing left in components
- [ ] Week/Today/Month visual behavior preserved for simple jobs (existing tests updated, not weakened)
**Verify:** `bun test tests/plugins/schedule/calendar-views.test.tsx --isolate` (rewritten against fixtured endpoint)
**Dependencies:** Task 11
**Files:** `plugins/schedule/components/calendar-{today,weekly,monthly}.tsx`, new shared `components/agent-colors.ts`, `src/hooks/use-schedule.ts` (or new hook file), tests
**Size:** L (mechanical, single-concern)

### Checkpoint 3 — PR3
- [ ] Full suite + typecheck green; live calendar identical-or-better on 3737 (Mark eyeballs week/month against known jobs)
- [ ] Mark approves → merge PR3

---

## Phase 4 — PR4 `feat(schedule): plugin-contributed scheduled domain events`

### Task 13: SDK contract type
**Description:** `ScheduledDomainEvent` interface + hook-shape docs (`{pluginId}.scheduledEvents`, `{pluginId}.rescheduleEvent`) exported from `@makinbakin/sdk` (types module — no runtime code, no new vendor sub-path). Zod schema server-side in `plugins/schedule/lib/domain-events.ts`.
**Acceptance:** type importable from `@makinbakin/sdk`; schema rejects missing-both-dates, wrong pluginId
**Verify:** `bun run typecheck` + schema unit tests
**Dependencies:** PR3 merged
**Files:** `packages/sdk/src/types/*`, `plugins/schedule/lib/domain-events.ts`, tests
**Size:** S

### Task 14: Domain-event fan-in on the occurrences endpoint
**Description:** Endpoint discovers providers via `getRegisteredHooks()` suffix match on `.scheduledEvents`, invokes each in parallel with the `{from,to}` range under a 2s timeout, zod-validates rows (pluginId must match the registrant), drops failing/invalid/slow providers with a logged warning + `meta.droppedProviders` in the response (honest degrade, never silent). Merged + sorted with job occurrences. Client refetch convention extended (`*.scheduled_events_changed`).
**Acceptance:**
- [ ] Throwing / invalid / slow provider → its events absent, others present, `meta.droppedProviders` names it, endpoint 200
- [ ] No providers registered → jobs-only feed, no errors
**Verify:** fan-in unit tests with fixture providers (throwing, slow, invalid, healthy)
**Dependencies:** Task 13
**Files:** `plugins/schedule/lib/domain-events.ts`, occurrences route, `src/hooks` occurrences hook, tests
**Size:** M

### Task 15: Tasks provider
**Description:** `tasks.scheduledEvents` hook: tasks with future `availableAt` → kind `task-scheduled`; tasks with `dueAt` in range → kind `task-due`; deep links to the board (`/tasks?taskId=`); `reschedulable: true`; emits `tasks.scheduled_events_changed` when those fields change. Test-harness provider added to schedule test helpers as the second proving consumer.
**Acceptance:**
- [ ] A waiting task appears on the calendar range feed with correct dates + deep link
- [ ] Done/archived tasks excluded
**Verify:** `bun test tests/plugins/tasks/ --isolate` (new provider test) + fan-in integration
**Dependencies:** Task 14
**Files:** `plugins/tasks/index.ts`, `plugins/tasks/lib/scheduled-events.ts`, tests
**Size:** M

### Task 16: Render domain events on the calendars
**Description:** Event chips visually distinct from job occurrences (source/kind badge, owner plugin label); click → popover with title/status/times + deep link; Month shows event dots distinct from job dots. Graceful empty behavior.
**Acceptance:**
- [ ] Cron occurrence vs domain event unmistakable at a glance in all three views (#191 acceptance criterion)
- [ ] Event click-through navigates to the owner deep link
**Verify:** calendar view tests extended with fixtured events
**Dependencies:** Task 14
**Files:** `plugins/schedule/components/calendar-*.tsx`, new `components/event-popover.tsx`, tests
**Size:** M

### Task 17: Reschedule verb
**Description:** Events with `reschedulable: true` get a Reschedule action in the popover → date-picker ConfirmDialog (whole flow in the modal per house rule) → invokes `{pluginId}.rescheduleEvent`; success refetches, failure surfaces the owner's error. Tasks implements `tasks.rescheduleEvent` (updates `availableAt` or `dueAt` per the event kind, audited).
**Acceptance:**
- [ ] Moving a waiting task from the calendar actually changes `availableAt` (verified via task API)
- [ ] Owner rejection (e.g. past instant) surfaces in the dialog, no partial state
- [ ] Events without the flag show no reschedule affordance
**Verify:** dialog component test + tasks hook test + integration through the fan-in
**Dependencies:** Tasks 15, 16
**Files:** `plugins/schedule/components/reschedule-dialog.tsx`, `event-popover.tsx`, `plugins/tasks/lib/scheduled-events.ts`, tests
**Size:** M

### Task 18: Docs + versions
**Description:** External-author guide (`docs/src/content/docs/extending/plugins/scheduled-events.md`); new `.claude/knowledge/scheduled-domain-events.md`; CLAUDE.md Key Patterns blurb; `bakin-owned-scheduler.md` cross-link; README check (expected no change); schedule + tasks manifest version bumps.
**Verify:** manual read-through; versions bumped
**Dependencies:** Tasks 13–17
**Size:** S

### Checkpoint 4 — PR4
- [ ] Full suite + typecheck green
- [ ] Live: waiting/due tasks visible on calendar, badged, deep-linked; reschedule works; killing the tasks provider (mock) degrades honestly
- [ ] Mark approves → merge PR4. Close #191.

---

## Phase 5 — bits adoption (`bakin-bits-official`)

### Task 19: Messaging + Projects adopt the contract
**Description:** In bakin-bits-official: `messaging.scheduledEvents` (publish dates, `reschedulable: true` via `messaging.rescheduleEvent`) and `projects.scheduledEvents` (milestones, read-only). Manifest version bumps per bits convention (patch/minor judgment). **Pre-step:** reconcile the installed projects plugin's hot-patched state with the repo before branching.
**Acceptance:**
- [ ] Publish dates + milestones render on the live calendar with owner badges
- [ ] Rescheduling a publish date from the calendar moves the content item
**Verify:** bits test suite (`bun run test` in bits repo — needs preload) + live verification on 3737 after plugin upgrade
**Dependencies:** PR4 merged
**Size:** M (external repo)

### Checkpoint 5 — Initiative complete
- [ ] All SPEC.md success criteria checked off
- [ ] SPEC.md + this plan archived per repo convention when the next initiative starts

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Retention sweep breaks exactly-once dedup | High | Never prune `pending` or rows newer than max(catch-up window, 7d); dedup-after-sweep is test-pinned before the sweep ships (Task 2) |
| `cron-parser` edge cases in 'at' dispatch (DST instants, tz of ISO exprs) | Med | 'at' bypasses cron-parser entirely (plain instant compare); DST pins live in occurrences tests (Task 11) |
| Hook fan-in stalls the occurrences endpoint | Med | 2s per-provider timeout, parallel invocation, honest `meta.droppedProviders` (Task 14) |
| Calendar refactor visual regressions | Med | PR3 is feature-free by design; existing calendar tests rewritten not weakened; Mark eyeballs live before merge |
| Conformance vs real OpenClaw drift (suite runs against mocks) | Low | Conformance pins the contract, not the binary; the loose-JSON absorption layer keeps its unit tests; stance documented |
| Installed projects plugin hot-patch conflicts with bits branch | Med | Task 19 pre-step reconciles installed state first (known from memory: runtime-capabilities PR #630 era) |
| SDK type addition ripples into vendor bundles | Low | Types-only export; no new runtime module, no import-map change |

## Parallelization

Tasks within a PR are sequential (each commit green). PR1 Tasks 1–4 are mutually independent and could be parallelized across sessions if desired; everything else follows the PR train.
