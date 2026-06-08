# SPEC — Per-task run history UI (#463)

> Status: draft for approval · Owner: Mark · Date: 2026-06-07 · Branch: `feat/task-run-history`

## Objective

Make a task's dispatch history visible in the UI. Today the execution ledger's
`runs` table durably records every dispatch attempt (run_id/seq/agent/status/
boot_id/heartbeats/settle_reason), but the only way to answer "why did this task
dispatch 3 times?" is to grep `audit.jsonl`. This surfaces that record as a
per-task **Run History** timeline in the task detail dialog — the per-*task*
sibling to the per-*schedule* run history shipped in #474, reusing the same
ledger-verb → mapper → hook → route → UI-section pattern.

**Target user:** the single operator inspecting a task that behaved oddly
(superseded by the watchdog, lost across a restart, retried).

## Scope (decided)

- **Runs-table only (MVP).** Each row = one dispatch attempt: seq #, agent,
  started/settled time, duration, status (`running` | `settled` | `superseded`
  | `lost`), settle reason. The runs table already captures supersede/lost, so
  "dispatched 3×: #1 superseded → #2 lost → #3 settled" is answerable from one
  query. **Out of scope:** inlining `task.dispatch_suppressed` /
  `completion_suppressed` audit events (no run row exists for a *blocked*
  duplicate) — a fast-follow if the suppressed-but-no-run case proves valuable.
- **Always-visible, collapsible section** in the task detail dialog: a one-line
  summary header (`N runs · last <status>`), collapsed by default, expandable to
  the full timeline. Single clean run = a one-row expand; abnormal cases stand
  out in the header.

## Acceptance criteria

1. `GET /api/plugins/tasks/:taskId/runs?limit=` returns the task's runs
   newest-first as a typed list; unknown task → `{ runs: [] }`, not an error.
2. The task detail dialog shows a **Run History** section: header
   `N run(s) · last <status>`, collapsed by default; expanding lists each
   attempt with seq, agent, relative start time, duration, a status badge, and
   settle reason when present.
3. Status badges: `settled`→green, `superseded`→zinc, `lost`→red,
   `running`→amber (mirrors `run-history.tsx`).
4. A task with zero runs renders no section (nothing to show ≠ noise).
5. Native/non-ledger tasks are unaffected; no change to existing task routes.

## Commands (unchanged)

- Test: `bun test <file> --isolate` · full: `bun run test`
- `bun run typecheck` · `bun run lint` · `bun run docs:check`
- Manual: `bun run dev:mock` (the mock seeds tasks; runs come from the ledger)

## Project structure (files touched)

- **Ledger** `packages/core/src/execution/ledger.ts` — new `listRunsByTask(taskId,
  limit)` read verb (mirrors `listCronFires`); facade re-export in
  `src/core/execution-ledger.ts`.
- **Mapper** `plugins/tasks/lib/runs-reader.ts` (new) — `RunRow` → `TaskRunEntry`.
- **Types** `plugins/tasks/types.ts` — `TaskRunEntry`; client mirror in the hook.
- **Route** `plugins/tasks/index.ts` — `GET /:taskId/runs` after `GET /:taskId`.
- **Hook** `src/hooks/use-task-run-history.ts` (new) — `useTaskRunHistory(taskId,
  limit)`, fetch `/api/plugins/tasks/:taskId/runs` (mirrors `useRunHistory`).
- **UI** new `RunHistory`-style component rendered in
  `plugins/tasks/components/task-detail-dialog.tsx`, inserted after
  `{workflowProgressJSX}` (≈ line 984).
- **Docs** `.claude/knowledge/execution-ledger.md` — note the read verb + surface.

## Code style / conventions

- Mirror #474 exactly (verb naming, `guard()` wrapper, prepared statements,
  facade re-export, `RunEntry`-style mapper, fetch-on-demand hook).
- TS strict; functional; `whitespace-nowrap`/badge classes consistent with
  `plugins/schedule/components/run-history.tsx`.

## Testing strategy

- **Ledger** (`tests/core/execution-ledger.test.ts`): `listRunsByTask` returns a
  task's runs newest-first across all statuses, bounded by limit, empty for
  unknown task. Real ledger + `closeDb()` before teardown.
- **Route** (`tests/plugins/tasks/…`): `GET /:taskId/runs` returns mapped
  entries (seq/agent/status/settleReason) for a task with seeded runs; `[]` for
  none. Mirror the schedule routes test isolation.
- Mapper unit test for status/duration derivation.

## Boundaries

- **Always:** read-only over the ledger; reuse the #474 pattern; keep it
  tasks-plugin + one core read verb.
- **Ask first:** any audit-log coupling, any new SSE channel, deep-linking a run
  to a session/trajectory viewer.
- **Never:** mutate the runs table from this feature; add a parallel
  stat/history store; block on the suppressed-events fast-follow.

## Commit / rollback

One commit per slice: (A) ledger verb + facade + test → (B) mapper + route +
test → (C) hook + UI section. Each independently green; A is additive so B/C can
land later. Branch `feat/task-run-history`.
