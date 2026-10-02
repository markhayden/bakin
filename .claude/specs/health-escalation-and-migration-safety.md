# Spec: Health Escalation, Task Liveness & Runtime-Migration Safety

Status: Approved 2026-10-01 (plan rev 2, after Mark's source-based plan review)
Companion plan: `.claude/specs/health-escalation-and-migration-safety-plan.md`

## Objective

Stop the production box (margo, Pi runtime, rc.40) from filling its blocked column with
"Health repair" and "Memory Dreaming Promotion" tasks, by fixing the five root causes in
Bakin rather than cleaning the board, and make an OpenClaw ↔ Pi runtime switch unable to
reproduce the problem.

The diagnosis (2026-09-28, read-only on margo) found:

| # | Root cause | Evidence |
|---|-----------|----------|
| 1 | Health escalation delegates incidents an agent cannot resolve (operator-only resolutions), re-delegates every 12 h while a blocked task "covers" them, and never closes a repair task whose incidents resolved. | 72 repair tasks created since 2026-07-22; 8 sitting blocked. |
| 2 | Task `order` is assigned as the column's current count on create **and** on every move, so any gap in a column produces a duplicate on the next arrival; `tasks:tasks:order-invalid` regenerates after every rebuild. | Rebuild applied 2026-09-28 19:18Z → 0 duplicates; next move re-collides. |
| 3 | `health:system:stale-tasks` reuses the boot-time restart-recovery predicate continuously: any in-progress task whose agent-written heartbeat file is >15 min old is a candidate; the ledger's live run is never consulted. A repair task flags **itself** seconds after dispatch. | Every repair task's blockedReason lists itself as a candidate. |
| 4 | Two real 35-minute stalls feed #3: (a) triage hand-off via `bakin_exec_tasks_assign` only rewrites `agent`; the task stays in progress with no run until the watchdog recovers it; (b) `continuation.ts` skips a parent whose column is in progress even when it has no live run. | Daily Scramble parent: child done 15:06Z → watchdog 15:38Z → finished 15:43Z. Every Dreaming task: 09:03 assign → 09:38 watchdog. |
| 5 | Runtime switch adopted OpenClaw's internal cron marker `__openclaw_memory_core_short_term_promotion_dream__` verbatim as a Bakin schedule (`taskPrompt`), and the `runtime-cron` orphan check's "Track for triage" repair offered the same path earlier. Unexecutable on Pi; burns three agent turns daily; alternating block/complete outcomes defeat the existing three-strikes auto-pause. | Job `9ec10d4b…`, `source: adopted`, `consecutiveFailures: 1`. |

Two smaller gaps ride along: every dispatch prompt references `~/.bakin/team/CONTACTS.md`, which nothing creates (ENOENT on every task), and the server's PATH on margo lacks the directory holding the `bakin` binary, so agents get `bakin: command not found` (13 Pi sessions).

### User
Mark, the single operator of a self-hosted Bakin, who reads the task board and Health page, receives Discord approval cards when the bridge is on, and expects the system to ask when a human decision is needed and otherwise stay quiet.

### Success looks like
- The board is the single inbox for anything that needs a human: agent work in todo, decisions in review with a "Needs approval" signal, nothing accumulating in blocked that the system itself created.
- A fresh OpenClaw → Pi switch on a box like margo adopts the nine real schedules and refuses the two machine markers with a readable reason, and the reverse switch fires every schedule exactly once.
- Health never reports a task as stranded while its run is live, and never asks an agent to press a button.

## Decisions (from the interview, 2026-10-01)

| ID | Decision |
|----|----------|
| D1 | `task` escalation auto-applies the targeted incidents' `safe` deterministic repairs first (same engine as `bakin doctor --fix`), then re-runs diagnostics. Incidents with a `navigate` or one-click `action` resolution are never delegated to an agent. A **blocked** repair task covers its incidents until they change or resolve; the 12 h stale re-escalation applies only to todo/in-progress repair tasks. |
| D2 | Repair tasks auto-close. Each doctor cycle verifies open repair requests; when every covered incident no longer reproduces, the linked task is completed with a system log line and the request marked `verified`. Applies to blocked, todo, review and in-progress tasks alike. |
| D3 | The execution ledger is the sole liveness authority. "Stranded" = in progress with no `running` ledger row. Restart recovery, the watchdog and the `stale-tasks` check share that one predicate. The agent heartbeat file gates nothing; `bakin_exec_heartbeat` survives only as a status note for the Team page. |
| D4 | Hand-off at settle: when a turn settles successfully and the task is still in progress but assigned to a different agent than the turn's, park it in todo with a system log line (the decomposition-parks-in-todo rule becomes one case of this). Continuation: a parent with a live run is left alone; a parent in progress with **no** live run is parked in todo and kicked. |
| D5 | No provider marker list. One structural predicate in the schedule prompt guard: a command that is empty or a single whitespace-free token is "not a task prompt". Adoption refuses such jobs with that reason and the switch report (dry run and real) lists every source job by name with the first line of its command. A schedule-owned health check applies the predicate to already-adopted jobs with a **Remove job** repair. The `runtime-cron` orphan check reports such jobs as runtime-internal, not as orphans to track. The existing three-strikes auto-pause stays unchanged as the generic net. |
| D6 | Approvals move into core as ONE primitive (record store, rehydration, channel wiring, badge + toast + OS attention). Destructive one-click repairs become approval requests (Apply / Dismiss); safe repairs auto-apply with an audit line; navigate-only incidents get toast + OS notification via the same attention provider; the `notify` escalation mode (agent chat message) is deleted. Escalation = auto-apply safe → approval for destructive → delegate the rest. |
| D7 | Every approval hangs off a task; the board is the inbox. Escalation creates one task per incident group: agent-fixable → todo; destructive repair → review, no agent, detail panel = approval card; navigate-only → review with the page link. Approval owner = `{ taskId, kind, … }`; the board's "Needs approval" signal is driven by pending approval records (one source for card, badge, toast, OS, Discord). The Health page keeps its incident buttons; they resolve the same record. Dismiss = complete the task as dismissed + ack the incident under existing ack rules. |
| D8 | Approval settings live at `settings.approvals.{channel, channelAlerts}` on the System & Alerts tab. One-shot boot upgrade moves the workflows plugin keys and deletes them (spend.json-from-models.json pattern); the upgrade code is deleted once margo has booted on it. |
| D9 | Ships as a native `gh` stack of three PRs on branches in the main checkout (live-tested on 3737 before each merge): (1) liveness & flow, (2) approvals in core & escalation policy, (3) schedule migration safety. |

Derived decisions (no interview needed):
- `settings.doctor.escalation` becomes a boolean (default `true`); `escalationCooldownMs` / `escalationStaleAfterMs` keep their meaning for todo/in-progress covers.
- The delegated-repair brief drops the "one-click" and "operator action" sanctioned-fix lines (those incidents are never delegated); it keeps `command`, `rerun`, and "no published fix — diagnose" wording and the integrity rules.
- Task order: the store hands out `max(order in column) + 1` from its index on create and on every column move. The `tasks.order-integrity` check and `reorder-columns` repair stay (cheap, and they catch legacy data).
- The `restart-recovery` module keeps its boot sweep (ledger boot sweep marks prior-boot runs `lost` first, so the predicate is exact at boot) and keeps `block` after `watchdog.maxAutoRecoveries` recoveries.
- CONTACTS.md: the reference is removed from `dispatch-prompts.ts` and its fixtures; no file is created.
- PATH: `secret-env.ts` prepends the directory of the running binary (`dirname(process.execPath)` for the compiled binary; the repo's `node_modules/.bin` under `bun run`) alongside `~/.bakin/bin`.
- Approval records move to `~/.bakin/approvals/<id>.json`. Existing records under `~/.bakin/workflows/approvals/` are migrated by a one-shot boot upgrade with their deliveries intact, and gates already pending without a record get one at workflows' `onReady` (plan review R5a; this reverses the earlier "not migrated" call).

Plan-review revisions (2026-10-01, recorded in the plan's "Plan-review revisions" table): R1 health-repair approvals persist a frozen proposal and revalidate at apply; R2 the Remove-job repair freezes exact job ids; R3 the settle hand-off applies to regular turns only; R4 auto-close requires fresh successful evaluation of the originating checks; R5 one-shot upgrades for approval records and the `doctor.escalation` string; R6 run-heartbeat bumps carry execution identity (exact run id for stream chunks, task+agent with an exactly-one-row rule for exec-tool calls).
- Migration-safety scope is OpenClaw → Pi and Pi → OpenClaw. The schedule cutover already removes the native cron by id on activate, so adopted jobs fire once after a switch back; refused markers stay native. No new work there beyond a test that pins it.
- Blocked **scheduled** tasks (the two Dreaming tasks) are not auto-archived by the Remove-job repair; Mark archives them.

## Tech Stack
Bun 1.3.13 (pinned), TypeScript strict, Zod at boundaries, React 19 + TanStack Router via `@makinbakin/sdk/*` entrypoints, `bun:sqlite` ledger (`packages/core/src/storage/db.ts` is the only importer), Discord delivery bridge (`@discordjs/core`). No new dependencies expected.

## Commands
```
Dev loop:        bun run dev                      (server code not watched — restart manually)
Typecheck:       bun run typecheck
Lint:            bun run lint                     (part of the gate — CI blocks on unused imports)
Cycles:          bun run check:cycles
Unit/integration bun run test                     (local; test:ci is the canonical CI invocation)
One file:        bun test tests/path/foo.test.ts --isolate
UI conformance:  bun run ui:conformance --quick   (full mode for the board/approval UI changes)
Isolated e2e:    /verify skill                    (boots a throwaway BAKIN_HOME; never 3737)
Build:           bun run build                    (never commit generated-version.ts afterwards)
```

## Project Structure (touched areas)
```
packages/core/src/approvals/        NEW  durable approval record store (pure fs, zod), owner kinds
packages/core/src/tasks/store.ts         nextOrderSync(column) from the index; move() uses it
packages/core/src/execution/ledger.ts    (read-only use) getLiveRun / boot sweep
src/core/approvals/                 NEW  request/resolve/rehydrate orchestration, channel wiring, settings upgrade
src/core/doctor-escalation.ts            policy: auto-apply safe → approval → delegate; cover rules
src/core/doctor-delegate.ts              brief wording; approval-task creation; verify → auto-close
src/core/restart-recovery.ts             ledger-only predicate (shared helper)
src/core/watchdog.ts                     uses the shared predicate
src/core/continuation.ts                 ledger-aware re-dispatch
src/core/dispatch-turns.ts               settle-time hand-off parking
src/core/dispatch-prompts.ts             CONTACTS.md reference removed
src/core/secret-env.ts                   binary dir on PATH
src/core/settings.ts / packages/core/src/settings.ts   doctor.escalation boolean; settings.approvals
plugins/health/lib/system-checks/restart-recovery.ts   shared predicate
plugins/health/components/               incident card buttons resolve approval records; attention
plugins/workflows/lib/{approval-store,approval-rehydration,channel-approvals}.ts  → consume core approvals (deleted/thinned)
plugins/workflows/components/approvals-badge-provider.tsx → host-owned attention provider
plugins/tasks/components/task-card.tsx   "Needs approval" from pending approval records
plugins/tasks/components/task-detail-*   approval card panel for kind=health-repair / navigate
plugins/schedule/lib/prompt-guard.ts     isTaskPrompt(command) predicate
plugins/schedule/lib/cron-adoption.ts    refusal + per-job report lines
plugins/schedule/lib/health-checks.ts    adopted-job check + Remove job repair; orphan check honours predicate
src/core/runtime-switch.ts + src/cli/commands/runtime.ts   per-job listing in the switch report
packages/host/src/                       approvals attention provider in the shell; System & Alerts approvals fields
tests/core/, tests/plugins/{health,schedule,tasks,workflows}/, tests/integration/runtime-conformance/, tests/fixtures/dispatch-prompts/
.claude/knowledge/{doctor-and-health-checks,execution-ledger,dispatch,bakin-owned-scheduler,runtime-capabilities,delivery-bridge,workflows-plugin}.md + NEW approvals.md
docs/src/content/docs/ (health, schedule, runtime switch pages as impacted); README.md if the feature list names escalation modes
```

## Code Style
Repo conventions apply (CLAUDE.md). The one pattern this work adds — a single liveness predicate consumed everywhere:

```ts
// src/core/task-liveness.ts
import { getLiveRun } from './execution-ledger'

/** A task is stranded when it is in progress and the ledger holds no running run for it.
 *  The ledger is the ONLY liveness authority — heartbeat files never gate this. */
export function isStrandedInProgress(task: { id: string; column: string }): boolean {
  if (task.column !== 'inProgress') return false
  return getLiveRun(task.id) === null
}
```

Approval owners are a discriminated union, never optional bags:

```ts
export type ApprovalOwner =
  | { kind: 'workflow-gate'; taskId: string; workflowId: string; runId: string; stepId: string }
  | { kind: 'health-repair'; taskId: string; requestId: string; planId: string; incidentIds: string[] }
  | { kind: 'health-navigate'; taskId: string; requestId: string; incidentIds: string[]; href: string }
```

Naming: `kebab-case.ts`, `PascalCase` types, `UPPER_SNAKE_CASE` constants, `createLogger('module')`, no empty catches, `const` over `let`.

## Testing Strategy
Framework: `bun test` with the repo preloads (act gate, completeness gate, silent logger). Every filesystem-touching test mocks both content-dir facades and the OpenClaw home; ledger tests call `closeDb()` before `rmSync`.

| Concern | Level | Location |
|---------|-------|----------|
| Stranded predicate (live run ⇒ never a candidate; no run ⇒ candidate; boot sweep) | unit, real ledger in temp dir | `tests/core/task-liveness.test.ts`, `tests/core/restart-recovery.test.ts` |
| Watchdog + health check agree (no self-flagging repair task) | unit | `tests/core/watchdog.test.ts`, `tests/plugins/health/restart-recovery-check.test.ts` |
| Settle-time hand-off parks in todo; continuation re-dispatches only without a live run | unit (settle-shape matrix extended) | `tests/core/dispatch-turns.test.ts`, `tests/core/continuation.test.ts` |
| Order = max+1 on create and move; integrity check stays green across a scripted churn | unit | `tests/core/tasks-store.test.ts` |
| Escalation policy: safe auto-applied, destructive → approval task in review, navigate → review + attention, rest delegated; blocked cover never re-escalates; auto-close | unit with fake doctor report | `tests/core/doctor-escalation.test.ts`, `tests/core/doctor-delegate.test.ts` |
| Approvals core: record lifecycle, owner kinds, resolve idempotence, rehydration, settings one-shot upgrade | unit | `tests/core/approvals/*.test.ts` |
| Workflow gates unchanged in behaviour through the lifted primitive; Discord card → record → gate | existing suites + runtime conformance (approvals never silent on any runtime) | `tests/plugins/workflows/*`, `tests/integration/runtime-conformance/` |
| Board "Needs approval" signal, approval panel Apply/Dismiss, attention toast/OS | RTL (`actRender`, `rtl-settle`) + Storybook stories for any new kit export | `tests/plugins/tasks/*`, `tests/plugins/health/*`, `storybook/` |
| `isTaskPrompt`; adoption refusal + report lines; adopted-job health check + Remove repair; orphan check honours predicate; cutover removes native cron on switch back | unit + dev-mock runtime | `tests/plugins/schedule/*`, `tests/core/runtime-switch.test.ts` |
| Dispatch prompt bytes (CONTACTS line gone) | fixture + budget test | `tests/fixtures/dispatch-prompts/` |
| PATH injection includes the binary dir | unit | `tests/core/secret-env.test.ts` |

Coverage expectation: every decision D1–D9 has at least one test that fails if the behaviour regresses; the existing `ui:conformance` and `check:cycles` gates stay green.

## Boundaries
- **Always:** branch in the main checkout so 3737 serves it; run `bun run typecheck && bun run lint && bun run check:cycles && bun run test` before every push; `bun run ui:conformance --quick` for UI commits; update the matching `.claude/knowledge/*.md` in the same PR; conventional commits with scope; bump touched core plugin manifest versions; keep the adapter boundary (no provider identifiers upstream of adapters).
- **Ask first:** any on-box action on margo (even clicking a repair on its behalf); changing ledger schema; adding a dependency; touching the release workflow; anything that would alter workflow gate semantics beyond the owner-shape change.
- **Never:** hot-patch margo; commit `generated-version.ts`; add a parallel notification/approval path; keep the `notify` mode or heartbeat gating behind a flag "just in case"; add back a provider marker list; merge before Mark's live test of the PR tip.

## Success Criteria
1. On a dev rig with the mock runtime: a delegated repair task in progress with a live run is never listed by `health:system:stale-tasks`; the check and the watchdog return the same candidate set for a seeded board.
2. Triage hand-off: a task assigned to another agent during a turn is in todo within one settle and dispatched to that agent on the next cycle; no watchdog recovery line appears.
3. Parent/child: a parent whose child completes while the parent has no live run is re-dispatched within one dispatch tick.
4. Task order: 500 scripted creates/moves/deletes across all columns leave `tasks.order-integrity` healthy without running the rebuild.
5. Escalation on a seeded report with one safe, one destructive, one navigate and one command-resolution incident produces: one audit line for the auto-applied safe repair, two tasks in review (approval card, page link), one task in todo for the agent, and zero agent messages.
6. Resolving a destructive approval from the Health card, the task panel, or a Discord button (mock channel) applies the repair once, completes the task, and verifies the request; dismissing completes the task as dismissed and acks the incident.
7. A repair task whose incidents stop reproducing is completed by the next doctor cycle with the verification log line, from any open column.
8. `bakin runtime use pi --dry-run` against an OpenClaw snapshot containing the margo job set prints nine `adopt` and two `refuse (not a task prompt)` lines; the real switch creates nine jobs and zero marker jobs.
9. On a sidecar containing the Dreaming marker job, Health shows the adopted-job incident with Remove job; approving it removes the job and audits it.
10. Switching back to OpenClaw fires each adopted schedule once (cutover removed the native cron; pinned by test).
11. Dispatch prompts contain no CONTACTS.md reference; the server's child shells resolve `bakin` on margo-shaped PATHs.
12. Workflow gate tests, runtime conformance, `ui:conformance`, `check:cycles`, lint, typecheck and the full suite pass on each PR tip; margo's blocked column drains to zero system-created tasks after the three PRs are live and the two manual archives are done.

## Open Questions
None blocking. Deferred, out of scope: an in-app Approvals list page beyond the board (the board is the inbox); auto-archiving blocked scheduled tasks when their job is removed.
