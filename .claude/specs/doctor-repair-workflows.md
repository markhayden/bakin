# Spec: Doctor Repair Workflows

## Status

Draft planning spec for GitHub issues:

- #268: deterministic `bakin doctor --fix`
- #269: agent-delegated `bakin doctor --delegate`

Companion plan: `.claude/specs/doctor-repair-workflows-plan.md`.

## Assumptions

1. These two issues should be designed together because they share diagnostic
   selection, confirmation, reporting, audit, and JSON output, even if they land
   in separate commits.
2. Normal `bakin doctor`, doctor cron, the health dashboard, and
   `bakin_exec_health_doctor` remain report-only.
3. `doctor --fix` is the only deterministic local repair path.
4. `doctor --delegate` is the only tracked agent-assisted repair path.
5. Existing embedded `settings.doctor.autoFixSkill` behavior should be removed,
   not preserved behind compatibility shims.
6. The first implementation can require server-backed health checks for
   `--fix` and `--delegate`; offline doctor remains diagnostic-only unless a
   later design adds offline repair handlers.
7. Delegated repair creates a linked Bakin task by default. The task starts on
   the board in `todo`, is assigned to the runtime main agent, and the
   implementation immediately kicks dispatch so the normal dispatcher moves it
   to `inProgress` when the agent is contacted.

## Objective

Build two explicit repair workflows for doctor results:

- A deterministic repair workflow that plans safe local mutations, asks for
  confirmation, applies check-owned repair handlers, reruns affected checks,
  and reports exactly what changed.
- A delegated repair workflow that sends a structured repair brief to the
  runtime main/orchestrator agent only after explicit user action, records a
  durable request, exposes request status/history, and verifies resolution by
  rerunning doctor.

Success means `bakin doctor` can be trusted as a pure diagnostic command, while
the two repair paths are intentional, auditable, and scriptable.

## Non-Goals

- No hidden repair behavior from cron, dashboard refreshes, default CLI runs, or
  MCP diagnostic tools.
- No ambiguous or destructive repair handlers in `--fix`.
- No agent-assisted repair under `--fix`.
- No deterministic repair claims from `--notify-agent`; it remains a one-off
  notification/report path.
- No broad runtime capability redesign before there is a runtime that can report
  repair lifecycle state natively.

## Command Surface

Diagnostic commands:

```bash
bakin doctor
bakin doctor --full
bakin doctor --json
bakin doctor --notify-agent
```

Deterministic repair:

```bash
bakin doctor --fix
bakin doctor --fix --yes
bakin doctor --fix --json --yes
```

Delegated repair:

```bash
bakin doctor --delegate
bakin doctor --delegate --yes
bakin doctor --delegate --json --yes
```

Repair inspection:

```bash
bakin doctor repair list
bakin doctor repair show <request-id>
bakin doctor repair verify <request-id>
```

Confirmation rules:

- Interactive TTY without `--yes`: render a plan and ask before mutating.
- Non-TTY without `--yes`: render/report the plan and exit without mutating.
- `--json` without `--yes`: return a JSON plan plus
  `CONFIRMATION_REQUIRED`, without mutating.
- `--yes`: apply the plan if every item is safe and deterministic.

## Project Structure

Expected new or heavily edited files:

```text
packages/core/src/plugin-types.ts          repair contract types
packages/sdk/src/types/index.ts            SDK repair type exports
src/core/doctor.ts                         report-only diagnostics and cache
src/core/doctor-repair.ts                  deterministic repair planning/apply
src/core/doctor-repair-store.ts            delegated request file store
src/core/doctor-delegate.ts                delegated brief/send/status logic
src/core/health-check-registry.ts          detailed run metadata for repair
plugins/health/index.ts                    repair/delegate HTTP routes
src/core/cli/ui/doctor.tsx                 plan/results rendering additions
cli/bakin.ts                               flags and repair subcommands

plugins/*/lib/health-checks.ts             split run() from repair handlers
src/core/agent-rules/managed-blocks.ts     expose managed-block repair handler
packages/core/src/settings.ts              remove doctor.autoFixSkill
docs/src/content/docs/using/health.md      command/docs update
.claude/knowledge/doctor-and-health-checks.md architecture update
```

Repair request state should live under Bakin-owned storage:

```text
~/.bakin/doctor/repair-requests/YYYY-MM/repair-<id>.json
```

This follows the task-store pattern: durable, inspectable, one mutable JSON
document per request, written atomically.

## Contracts

`HealthCheckResult` stays diagnostic-only:

```ts
export interface HealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}
```

`fixed` remains valid only for repair verification or legacy rows during the
transition. Normal diagnostic `run()` functions must not return `fixed`.

Add explicit repair contracts:

```ts
export type HealthRepairSafety = 'safe' | 'manual' | 'destructive'

export interface HealthRepairChange {
  kind: 'file' | 'setting' | 'service' | 'runtime' | 'task' | 'other'
  target: string
  action: 'create' | 'update' | 'delete' | 'install' | 'invoke'
  description: string
}

export interface HealthRepairPlanItem {
  id: string
  checkId: string
  title: string
  reason: string
  safety: HealthRepairSafety
  requiresConfirmation: boolean
  changes: HealthRepairChange[]
}

export interface HealthRepairApplyResult {
  id: string
  checkId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
  changes: HealthRepairChange[]
}

export interface HealthRepairHandler {
  plan(rows: HealthCheckResult[]): Promise<HealthRepairPlanItem[]>
  apply(items: HealthRepairPlanItem[]): Promise<HealthRepairApplyResult[]>
}
```

Extend health-check registration:

```ts
export interface PluginHealthCheckInput {
  id: string
  name: string
  run: () => Promise<HealthCheckResult[]>
  repair?: HealthRepairHandler
}
```

`autoFix` becomes unnecessary metadata and should be removed from in-repo
registrations. UI/API consumers can derive repairability from `repair != null`.

## Deterministic Repair Flow

1. Run detailed diagnostics through the health registry, preserving the
   registered check definition that produced each result row.
2. Select warn/error rows from checks with a repair handler.
3. Ask each handler for a plan. Reject any item with `safety !== 'safe'` from
   automatic application.
4. Render the plan with exact changes grouped by check.
5. Apply only after interactive confirmation or `--yes`.
6. Catch each handler failure independently and continue applying unrelated
   safe items.
7. Rerun affected checks after apply.
8. Emit a structured result containing plan, apply results, verification rows,
   changed files/settings/services, and failed remediation messages.
9. Append audit events:
   - `doctor.fix.planned`
   - `doctor.fix.applied`
   - `doctor.fix.failed`
   - `doctor.fix.verified`

## Delegated Repair Flow

1. Run diagnostics.
2. Build a deterministic repair plan in memory.
3. Select unresolved warn/error rows that have no safe deterministic repair
   plan, plus any deterministic repair failures if delegation follows a failed
   `--fix` run.
4. Build a repair request record with status `planned`.
5. Require explicit confirmation or `--yes`.
6. Verify runtime reachability and resolve the main agent through the runtime
   adapter.
7. Create a linked task after confirmation:
   - title: `Doctor repair: <summary>`
   - column: `todo`
   - assignee: main agent id
   - createdBy: `system`
   - source: `{ pluginId: 'health', entityType: 'doctor-repair', entityId: requestId, purpose: 'delegated-repair' }`
   - description: structured repair brief plus verification instructions
8. Kick the existing single-task dispatch path so the agent picks up the board
   task. Dispatch moves the task to `inProgress` before contacting the agent.
9. Send a structured brief via the dispatch/task message path with thread id
   `doctor-repair:<request-id>:<agent-id>`.
10. Mark the request `sent` when message delivery succeeds. Do not claim
   `accepted` or `completed` unless a runtime/task signal supports it.
11. Let `doctor repair show` derive live status from the request file, linked
    task state, and latest verification.
12. Let `doctor repair verify <id>` rerun doctor and store whether the original
    issue signatures remain.

Runtime status semantics:

- Successful `runtime.messaging.send()` means `sent`, not repaired.
- A linked task in `done` can mark the request `completed`.
- A verification rerun with no matching unresolved rows can mark it `verified`.
- Future runtime adapters may return `MessageResult.metadata.repairStatus`; the
  store should persist it, but the initial OpenClaw path should not depend on it.

## Repair Request Shape

```ts
export interface DoctorRepairRequest {
  id: string
  kind: 'delegate'
  status: 'planned' | 'sent' | 'accepted' | 'running' | 'completed' | 'failed' | 'verified'
  createdAt: string
  updatedAt: string
  agentId: string
  threadId: string
  messageId?: string
  taskId?: string
  diagnosticsHash: string
  issues: HealthCheckResult[]
  skippedDeterministic: HealthRepairPlanItem[]
  brief: string
  events: Array<{
    ts: string
    type: string
    message: string
    data?: Record<string, unknown>
  }>
  lastVerification?: {
    ts: string
    unresolved: HealthCheckResult[]
    status: 'unverified' | 'still-failing' | 'verified'
  }
}
```

## Testing Strategy

Core tests:

- `tests/core/doctor.test.ts`
  - default diagnostics do not notify or mutate
  - `notifyAgent` remains explicit
  - cache/audit behavior remains intact
- `tests/core/doctor-plugin-checks.test.ts`
  - detailed run preserves per-definition results and throw isolation
- New `tests/core/doctor-repair.test.ts`
  - plan/apply/verify workflow
  - non-safe plan items are skipped
  - handler failures are isolated
  - JSON/non-TTY confirmation guard behavior at service level
- New `tests/core/doctor-delegate.test.ts`
  - request store atomic read/write/list
  - brief construction
  - runtime unreachable failure
  - task link and message send behavior
  - verification updates status

Plugin tests:

- Update every health-check test that currently toggles
  `settings.doctor.autoFixSkill`.
- Add focused repair handler tests beside each plugin-owned check:
  - team
  - tasks
  - assets
  - schedule
  - workflows
  - health system checks
  - managed blocks

CLI/API tests:

- `tests/cli/doctor-ui.test.tsx` for plan/result rendering.
- Add CLI parser/runner tests for `--fix`, `--delegate`, `--yes`, `--json`,
  and `doctor repair list/show/verify`.
- Extend `tests/plugins/health/routes.test.ts` for repair/delegate routes.

Verification commands:

```bash
bun test --isolate tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts
bun test --isolate tests/core/doctor-repair.test.ts tests/core/doctor-delegate.test.ts
bun test --isolate tests/plugins/health tests/plugins/tasks tests/plugins/team tests/plugins/assets tests/plugins/schedule tests/plugins/workflows
bun test --isolate tests/cli/doctor-ui.test.tsx
bun run typecheck
bun run docs:generate
```

## Boundaries

Always:

- Keep diagnostic `run()` report-only.
- Keep repair handlers owned by the check/plugin that owns the affected state.
- Require explicit confirmation before mutation.
- Emit structured JSON for automation.
- Audit repair and delegation attempts.
- Rerun affected checks after deterministic repair.

Ask first:

- Whether to expose repair controls in the Health UI in the first PR.
- Whether any existing `autoFixable` behavior should be considered unsafe and
  demoted to manual-only.

Never:

- Send agent messages from default doctor.
- Apply destructive repairs from `--fix`.
- Claim delegated repair completed just because a message was sent.
- Read or write provider-owned runtime files directly from doctor repair code.
- Add compatibility shims for `doctor.autoFixSkill`.

## Success Criteria

- `bakin doctor` is report-only in CLI, cron, dashboard, REST, and MCP.
- `bakin doctor --fix` is the only deterministic repair path.
- `bakin doctor --fix` presents a plan before mutation.
- Non-TTY and JSON repair runs require `--yes`.
- Safe repair attempts report changed files/settings/services.
- Failed repair attempts include actionable remediation.
- Affected checks rerun after repair.
- `bakin doctor --delegate` records a request and sends only after explicit
  confirmation.
- Delegated request history/status is inspectable from CLI and JSON.
- Runtime messaging failures are clear and non-spammy.
- Fresh/offline installs do not attempt delegated repair unless runtime is
  reachable.

## Resolved Decision

`bakin doctor --delegate` creates a linked Bakin task automatically after
confirmation. The task starts in `todo`, is assigned to the runtime main agent,
and dispatch is kicked immediately. The user sees a normal board task, the agent
receives the work through the normal dispatch path, and task completion becomes
the delegated repair completion signal.
