# Spec: Schedule Plugin Audit

## Objective

Audit the Schedule plugin end to end because a daily scheduled task on another machine did not create or dispatch the expected Bakin task.

Success means we can answer, with evidence:

- how a scheduled job is created from UI, CLI, or MCP exec tool input
- where the runtime cron record lives
- where Bakin-owned schedule metadata lives
- what actually causes a fired cron run to become a Bakin task
- which conditions skip or suppress task creation
- whether the observed failure is an OpenClaw adapter bug, a Schedule plugin bug, a documentation mismatch, or an unsupported multi-machine topology

## Current Observations

- The Schedule plugin creates Bakin-owned jobs through `plugins/schedule/index.ts`.
- Runtime timing is delegated to `ctx.runtime.cron`.
- Bakin metadata is stored in `~/.bakin/schedule/sidecar.json`.
- OpenClaw cron records are managed by the Gateway-backed `openclaw cron` CLI. Raw snapshot capture/restore still reads `OPENCLAW_HOME/cron/jobs.json` to preserve provider-specific fields during adoption.
- Prior to the 2026-05-31 follow-up fix, the OpenClaw adapter created Bakin schedules as main-session `systemEvent` cron jobs with payload text like `bakin:schedule:<name-or-id>`.
- The affected machine showed one enabled OpenClaw cron job and one successful cron fire, but two Bakin execution paths: the Schedule reconciler created the canonical scheduled task, while the cron-launched main session separately called `bakin_exec_tasks_create`.
- Installed OpenClaw 2026.5.4 reports `openclaw cron` as "Manage cron jobs (via Gateway)" and exposes `cron add|edit|rm|run|runs|show|status`.
- The Bakin OpenClaw adapter previously shelled out for `cron run`, but create/update/delete/list/get read or wrote `cron/jobs.json` directly. That was fixed so live cron operations go through the OpenClaw CLI/Gateway path.
- The maintainer README says OpenClaw webhook delivery is not canonical for task creation; the Schedule plugin reconciler polls successful runtime cron runs and creates Bakin tasks.
- User-facing docs previously said the runtime POSTs `/api/plugins/schedule/bridge`; docs now describe the reconciler path used by OpenClaw and keep the bridge as a runtime-specific callback option.
- Focused Schedule/OpenClaw cron tests pass with the repo-required `--isolate` flag.

## Expected Flow Under Current Code

1. User creates a Bakin-owned schedule through the UI, CLI, REST route, or `bakin_exec_schedule_create`.
2. Schedule parses the natural language or raw cron string into a five-field cron expression.
3. Schedule calls `ctx.runtime.cron.create(...)`.
4. The OpenClaw adapter registers the cron job through `openclaw cron add`.
5. Schedule writes a sidecar entry keyed by the runtime-returned `jobId`.
6. OpenClaw fires the cron and records a successful run.
7. While Bakin is running, the Schedule plugin reconciler polls runtime runs every 60 seconds.
8. For unprocessed successful runs on Bakin-owned jobs, Schedule creates a task via `createTaskWithEffects`.
9. Schedule records `lastTaskId` and `processedRunIds` in the sidecar.
10. The normal Bakin dispatcher picks up the new todo task and sends it to the assigned agent.

## Primary Risk Areas

- A claw/agent could create a runtime-native OpenClaw cron directly instead of using Bakin's schedule creation tool. That job still appears in the Schedule list, but it is runtime-only and will not create Bakin tasks unless explicitly adopted. The affected release-summary job was visually identified as a Bakin schedule, so this is now a secondary risk rather than the leading hypothesis.
- Bakin is not running when the OpenClaw cron fires.
- The cron fires on one machine, but Bakin is running on another machine with a different `OPENCLAW_HOME` or `BAKIN_HOME`.
- Runtime run history is missing, failed, malformed, or not marked `succeeded`.
- The sidecar entry is missing, stale, keyed differently than the runtime job id, or marks the job as runtime-only.
- The job is paused, skipped, auto-paused, or overlap-blocked by an active previous task.
- Documentation implies bridge/webhook behavior that current OpenClaw schedules do not use.
- Tests cover run-now bridge behavior better than daemon-fired reconciliation behavior.
- The Schedule UI does not clearly expose whether the runtime fired, whether Bakin reconciled the run, or why task creation was skipped.
- If a runtime adapter writes cron create/update/delete operations directly to a provider store instead of the provider's live cron API, Bakin-created jobs can appear in Schedule but never record run history.
- On the local machine, `openclaw cron status --json --timeout 3000` failed because the Gateway connection closed. That is not the affected machine, but it confirms cron status/list are Gateway-backed surfaces rather than plain file reads in current OpenClaw.

## Audit Conclusion

The reported symptom, a visually Bakin-owned schedule with no run history, is most consistent with the old OpenClaw adapter writing a cron record to `OPENCLAW_HOME/cron/jobs.json` without registering it through the Gateway-backed scheduler. Schedule could list the job because Bakin read the same file, but OpenClaw never fired it, so the reconciler never saw a successful runtime run and never created the board task.

The fix is to make OpenClaw cron list/get/create/update/delete and run-history reads use the same `openclaw cron` CLI surface the scheduler owns. Schedule continues to own sidecar metadata and task creation. Raw snapshot capture/restore remains file-based only for native-job adoption rollback.

## Follow-Up Triage: Duplicate Scheduled Runs

The later affected-machine triage ruled out duplicate cron registration for issue #393. The persisted evidence showed:

- one enabled OpenClaw cron job
- one OpenClaw run at `2026-05-31T15:00:00Z`
- one Schedule-reconciled task created at `2026-05-31T15:00:59Z`
- one separate main-session-created Bakin task at `2026-05-31T15:02:15Z`
- both tasks posted to Discord

Root cause: Bakin-owned cron jobs were delivered to OpenClaw as main-session system events. OpenClaw recorded the timer run, which Schedule correctly reconciled into a task, but it also woke the main Bakin session with normal orchestrator context. The main session interpreted the schedule event as work and created its own task.

The Bakin-side fix is to keep OpenClaw as the timer but stop waking `main` for Bakin-owned schedules. Since OpenClaw requires a payload, the OpenClaw adapter now registers Bakin cron jobs as isolated, no-delivery, light-context agent turns with the reserved `bakin:*` marker. Schedule remains the only canonical creator of tasks for successful runtime runs.

## Commands

- Focused verification: `bun test --isolate tests/plugins/schedule tests/adapter-openclaw/runtime-cron.test.ts tests/plugins/tasks/scheduled.test.ts tests/dev/mock-runtime-contract.test.ts`
- Full repo test command: `bun test --isolate`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Runtime cron inspection on the affected machine: inspect `OPENCLAW_HOME/cron/jobs.json` and `OPENCLAW_HOME/cron/runs/{jobId}.jsonl`
- Bakin sidecar inspection on the affected machine: inspect `BAKIN_HOME/schedule/sidecar.json`

## Project Structure

- `plugins/schedule/index.ts` - routes, exec tools, bridge, reconciler, task creation
- `plugins/schedule/lib/sidecar.ts` - Bakin-owned schedule metadata and skip/pause/failure state
- `plugins/schedule/lib/jobs-reader.ts` - runtime cron plus sidecar merge logic
- `plugins/schedule/lib/runs-reader.ts` - runtime run history mapping
- `plugins/schedule/lib/health-checks.ts` - runtime/sidecar sync diagnostics
- `packages/adapter-openclaw/src/runtime.ts` - OpenClaw cron adapter implementation
- `tests/plugins/schedule/*` - Schedule plugin coverage
- `tests/adapter-openclaw/runtime-cron.test.ts` - OpenClaw cron adapter coverage
- `.claude/knowledge/dispatch.md` - plugin cron command convention
- `.claude/knowledge/tasks-plugin.md` - task dispatch and scheduled task context
- `plugins/schedule/README.md` and `docs/src/content/docs/using/schedule.md` - schedule docs that need reconciliation

## Testing Strategy

- Preserve existing focused Schedule/OpenClaw cron suite.
- Add adapter regression coverage proving Bakin schedules do not call `openclaw cron add --session main --system-event`; they use isolated no-delivery timer payloads.
- Add adapter regression coverage proving native cron tool allowlists use `--tools` / `--clear-tools`.
- Add a contract test proving provider-generated cron ids are accepted by Schedule sidecar metadata.
- Update docs where the bridge/reconciler contract is inconsistent.

## Boundaries

- Always: keep runtime-provider details behind the runtime adapter.
- Always: keep Schedule-owned metadata in the sidecar and task creation in Bakin task service.
- Always: use `bun test --isolate` for multi-file Bun tests because tests mock modules heavily.
- Ask first: changing the canonical cron-to-task mechanism from reconciler to webhook bridge.
- Ask first: changing multi-machine behavior or assuming shared `BAKIN_HOME` / `OPENCLAW_HOME`.
- Never: silently adopt runtime-native cron jobs into Bakin task creation without explicit user action.

## Success Criteria

- A written audit explains the actual cron-to-task lifecycle and the expected files involved.
- The audit identifies the likely failure mode for the affected daily job.
- The audit includes a minimal reproduction or inspection checklist for the affected machine.
- Any proposed fix has a narrow implementation plan, rollback checkpoints, and tests.
- Docs are updated if the current bridge/reconciler story is inconsistent.

## Product Contract Clarification

For the release-summary case, the desired behavior is:

1. A Bakin-owned schedule exists for every day at 9am.
2. At each successful 9am runtime fire, Bakin creates one real task on the board.
3. The task is assigned to the configured agent unless triage is required.
4. The task prompt contains enough context to gather and post release notes.
5. Later, the same schedule may attach a workflow for research, drafting, review, and posting, but the minimum viable behavior is schedule-to-task creation at 9am.

## Open Questions

1. Resolved: the adapter should call the OpenClaw cron CLI/Gateway for live cron CRUD. Direct file writes are only appropriate for raw snapshot restore.
