# SPEC — Tasks: reflect real task outcome in Run History

> Status: draft for approval · Owner: Mark · Date: 2026-06-09
> Issue: [#476](https://github.com/markhayden/bakin/issues/476) · Follow-on to #463 / PR #475

## 1. Objective

The Run History timeline in the task drawer shows each run's dispatch status from
the ledger `runs` table. `settled` means *the agent's turn ended cleanly*, not
that the task succeeded — so a green `settled` badge on a task that later
blocked or stalled reads as a false success.

Fix: surface the task's terminal outcome (from the completion ledger + task
column) alongside the dispatch history, and stop using green for `settled`.

Target environment: single-user, self-hosted Bakin. No backwards-compat or
shims — the API response shape may change freely. Priority: reduce tech debt;
keep it clean and clear.

### Acceptance criteria (from the issue)

1. Run history visibly distinguishes "the agent's turn settled" from "the task
   succeeded / failed / blocked".
2. Read-only; reuses the completion ledger + task column. No new audit query
   surface, no new write verbs, no schema changes.
3. A `settled` run on a task that's still in progress no longer reads as a
   success.

## 2. Design decisions (interview-resolved)

| Decision | Resolution |
|---|---|
| Scope | Tasks plugin only. The schedule plugin's `cronFireToEntry` surface is out of scope (follow-up issue if ever needed). |
| Data shape | Sibling object: `GET /api/plugins/tasks/:taskId/runs` returns `{ runs, outcome }`. Outcome is task-level state — it is **not** stamped onto run entries. |
| Derivation location | Server-side, in `plugins/tasks/lib/runs-reader.ts` (`readTaskOutcome`). One tested place owns the semantics; UI stays a dumb renderer. |
| Outcome semantics | Completion row wins: completion exists → `done` (even if since archived). Else by column: `blocked` → `blocked`, `archived` → `archived` (abandoned), `done` → `done` (legacy task with no row), anything else → `in_progress`. |
| UI shape | Outcome badge on the Run History **header** line. Per-run `settled` badge recolored green → neutral blue; green becomes exclusively "task done". `lost` stays red, `running` amber, `superseded` zinc. Outcome colors: done → green, blocked → red, in_progress → amber, archived → zinc. |
| Empty state | Unchanged: component renders nothing when a task has zero runs (no outcome badge either). |

### Outcome derivation (normative)

```
getCompletion(taskId) row exists ──→ done (completedAt, agent from row)
else column = blocked            ──→ blocked
else column = archived           ──→ archived   (never completed)
else column = done               ──→ done       (legacy; no completedAt/agent)
else                             ──→ in_progress
```

Unknown task (no board entry, no completion): `outcome` is omitted — the route
already returns an empty runs list for unknown tasks and must not start
erroring.

### Types

```ts
/** Task-level terminal outcome, derived from completion ledger + column. */
export interface TaskOutcome {
  state: 'done' | 'blocked' | 'archived' | 'in_progress'
  /** Set when state === 'done' and a completion row exists. */
  completedAt?: string // ISO
  /** Agent that recorded the completion, when known. */
  agent?: string
}
```

Declared in `plugins/tasks/types.ts`, mirrored in
`src/hooks/use-task-run-history.ts` (existing keep-in-sync pattern for
`TaskRunEntry`). The hook returns `{ runs, outcome, loading }`.

## 3. Touched files (project structure)

| File | Change |
|---|---|
| `plugins/tasks/lib/runs-reader.ts` | Add `readTaskOutcome(taskId): TaskOutcome \| undefined` using `getCompletion` (from `src/core/execution-ledger`, already exported) + `getTaskWithColumn` (from `src/core/task-store`). |
| `plugins/tasks/types.ts` | Add `TaskOutcome`. |
| `plugins/tasks/index.ts` | `/:taskId/runs` handler returns `{ runs, outcome }`. |
| `src/hooks/use-task-run-history.ts` | Mirror `TaskOutcome`; expose `outcome` from the hook. |
| `plugins/tasks/components/task-run-history.tsx` | Header outcome badge; recolor `settled` to blue. |
| `tests/plugins/tasks/*` | Coverage for derivation + route shape (see §5). |
| `.claude/knowledge/execution-ledger.md` | Update the read-only consumers table (run-history row) to note the outcome join on `completions`. |

No new source files except possibly a dedicated test file. No `packages/core`
changes (`getCompletion` already exists). No README impact (verified — no
run-history mention). No SDK/vendor/build changes.

## 4. Commands & code style

- Dev: `bun run dev` (plugin HMR covers the component; server-side changes to
  `runs-reader.ts`/`index.ts` need a manual server restart).
- Full suite: `bun run test`. Single file: `bun test tests/plugins/tasks/<f>.test.ts --isolate`.
- Conventions per CLAUDE.md: strict TS (no `any` across boundaries), Zod at
  API boundaries, `const` over `let`, kebab-case files, import order
  (builtins → external → SDK → `@/*` → relative).
- Commits: conventional with scope (see §6).

## 5. Testing strategy

Per CLAUDE.md testing rules: mock **both** content-dir resolvers, OpenClaw
home, logger, watcher; temp dirs + `afterAll` cleanup; `closeDb()` before
`rmSync` if the real ledger is exercised; use `tests/plugins/test-helpers.ts`
for route tests.

Unit — `readTaskOutcome` derivation (table-driven over the normative rules):
1. Completion row exists, column done → `done` with `completedAt` + `agent`.
2. Completion row exists, column archived → `done` (completion wins).
3. No completion, column blocked → `blocked`.
4. No completion, column archived → `archived`.
5. No completion, column done (legacy) → `done`, no `completedAt`.
6. No completion, column inProgress/todo/backlog/review → `in_progress`.
7. Unknown task → `undefined`.

Route — `GET /:taskId/runs` returns `{ runs, outcome }`; unknown task returns
`{ runs: [] }` without error.

Existing tests in `tests/plugins/tasks/routes.test.ts` asserting the runs
response must keep passing (updated only if they pin the exact response keys).

## 6. Commit strategy (rollback checkpoints)

Branch: `feat/task-outcome-run-history`. Each commit builds + tests green —
natural rollback points:

1. `feat(tasks): add readTaskOutcome derivation over completions + column`
   — runs-reader + types + unit tests. Pure addition; nothing consumes it yet.
2. `feat(tasks): return task outcome from the runs route`
   — route + route tests + hook mirror. API now serves `{ runs, outcome }`;
   UI unchanged and tolerant of the extra key.
3. `feat(tasks): show task outcome in run history header, demote settled to blue`
   — component change, the user-visible payoff.
4. `docs(ledger): note run-history outcome join in execution-ledger knowledge`
   — knowledge doc update (can fold into 2 if trivial).

Reverting 3 leaves a useful API; reverting 2–3 leaves a harmless helper.

## 7. Boundaries

**Always:**
- Read-only against the ledger — only `getCompletion`; never write verbs.
- Respect the adapter boundary: everything stays in `plugins/tasks` +
  existing `src/core` facades.
- Outcome derivation stays server-side in one function.

**Ask first:**
- Any change to ledger schema or verbs (should be unnecessary).
- Any change to the schedule plugin (out of scope).

**Never:**
- Backwards-compat shims for the old response shape (single-user machine).
- New audit-log queries for outcome (issue explicitly excludes this).
- Per-run outcome stamping.
- Fabricating outcome states beyond the four derived ones.
