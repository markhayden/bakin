# Implementation Plan: Doctor Repair Workflows

Companion spec: `.claude/specs/doctor-repair-workflows.md`.

## Overview

Implement #268 and #269 as one repair architecture with two explicit entry
points: deterministic local repair via `bakin doctor --fix`, and tracked
agent-assisted repair via `bakin doctor --delegate`. The first half removes the
current hidden `settings.doctor.autoFixSkill` mutation path. The second half
adds durable delegated request tracking and status inspection.

## Architecture Decisions

- Diagnostic checks stay pure: `run()` reports only.
- Repair is an explicit optional contract on health-check definitions.
- Repairability is derived from the presence of `repair`, not from the existing
  metadata-only `autoFix` flag.
- Deterministic repair applies only `safe` plan items.
- Delegation is not a deterministic repair claim; message delivery means
  `sent`, task completion means `completed`, and doctor verification means
  `verified`.
- Delegated repair request state is Bakin-owned JSON under
  `~/.bakin/doctor/repair-requests/`.
- Delegated repair creates a linked task in `todo` assigned to `main`, then
  kicks immediate dispatch so the normal dispatcher moves it to `inProgress`
  when the agent is contacted.

## Dependency Graph

```text
Repair contracts and detailed check execution
  -> split existing embedded auto-fixes into repair handlers
    -> deterministic repair service
      -> health routes
        -> CLI --fix and JSON/TTY guards
          -> docs and generated references

Delegated request store
  -> repair brief builder
    -> runtime send + linked task
      -> CLI --delegate
        -> repair list/show/verify
          -> docs and knowledge update
```

## Phase 0: Baseline And Regression Characterization

### Task 1: Capture Current Mutating Paths

**Description:** Inventory every current `settings.doctor.autoFixSkill` reader
and add focused failing tests that prove normal diagnostics must not mutate.

**Acceptance criteria:**

- Every current auto-fix reader is listed in the implementation notes.
- At least one core regression test fails on the current branch if normal doctor
  mutates.
- Tests identify the expected future surface: repair is explicit, diagnostics
  are report-only.

**Verification:**

```bash
rg -n "autoFixSkill|getSettings\\(\\)\\.doctor" src plugins packages
bun test --isolate tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts
```

**Dependencies:** None

**Files likely touched:**

- `tests/core/doctor.test.ts`
- `tests/core/doctor-plugin-checks.test.ts`

**Estimated scope:** Small

## Phase 1: Repair Contract Foundation

### Task 2: Add Explicit Repair Types And Detailed Check Execution

**Description:** Add repair plan/apply types to core and SDK, then expose a
detailed health-check execution helper that preserves which registered
definition produced each result row.

**Acceptance criteria:**

- `PluginHealthCheckInput` accepts optional `repair`.
- `runPluginHealthChecks()` keeps its public flattened result behavior.
- A new internal helper returns `{ def, results }[]` for repair planning.
- Throw/rejection isolation still works per check.

**Verification:**

```bash
bun test --isolate tests/core/doctor-plugin-checks.test.ts
bun run typecheck
```

**Dependencies:** Task 1

**Files likely touched:**

- `packages/core/src/plugin-types.ts`
- `packages/sdk/src/types/index.ts`
- `src/core/health-check-registry.ts`
- `src/core/doctor.ts`
- `tests/core/doctor-plugin-checks.test.ts`

**Estimated scope:** Medium

### Task 3: Delete `doctor.autoFixSkill` As A Behavior Flag

**Description:** Remove the settings-backed auto-fix switch and update
diagnostic checks so `run()` never applies repairs.

**Acceptance criteria:**

- No check reads `settings.doctor.autoFixSkill`.
- Normal doctor runs cannot return `fixed` from migrated checks.
- Settings defaults and generated settings docs no longer advertise
  `doctor.autoFixSkill`.

**Verification:**

```bash
rg -n "autoFixSkill" src plugins packages docs .claude
bun test --isolate tests/core/doctor.test.ts
bun run typecheck
```

**Dependencies:** Task 2

**Files likely touched:**

- `packages/core/src/settings.ts`
- `docs/src/content/docs/reference/generated/settings.md`
- `docs/src/content/docs/using/health.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- all plugin health-check files that currently read `autoFixSkill`

**Estimated scope:** Medium

## Phase 2: Check-Owned Deterministic Repair

### Task 4: Convert Existing Safe Auto-Fixes Into Repair Handlers

**Description:** Move each existing safe embedded auto-fix branch into a
check-owned `repair.plan/apply` handler. Keep ambiguous/destructive work as
manual remediation only.

**Acceptance criteria:**

- Existing safe repairs are still available through `repair`.
- Repair plans report exact change targets before mutation.
- Unsafe or ambiguous cases return no safe plan item.
- Plugin registration no longer uses metadata-only `autoFix`.

**Verification:**

```bash
bun test --isolate tests/plugins/health tests/plugins/tasks tests/plugins/team tests/plugins/assets tests/plugins/schedule tests/plugins/workflows
bun run typecheck
```

**Dependencies:** Task 3

**Files likely touched:**

- `plugins/health/lib/system-checks/mcporter.ts`
- `plugins/health/lib/system-checks/sync-skill.ts`
- `src/core/agent-rules/managed-blocks.ts`
- `plugins/tasks/lib/health-checks.ts`
- `plugins/team/lib/health-checks.ts`
- `plugins/assets/lib/health-checks.ts`
- `plugins/schedule/lib/health-checks.ts`
- `plugins/workflows/lib/health-checks.ts`
- plugin `index.ts` registrations

**Estimated scope:** Large, split by plugin owner if needed

### Task 5: Add Deterministic Repair Service

**Description:** Implement the core service that plans, applies, audits, and
verifies deterministic repair attempts.

**Acceptance criteria:**

- Planning runs diagnostics and returns safe/manual/destructive categories.
- Applying requires an explicit accepted/yes input at the service boundary.
- Handler failures are isolated.
- Affected checks rerun after apply.
- Results include changed targets and failed remediation.

**Verification:**

```bash
bun test --isolate tests/core/doctor-repair.test.ts
bun run typecheck
```

**Dependencies:** Task 4

**Files likely touched:**

- `src/core/doctor-repair.ts`
- `src/core/audit.ts` call sites only
- `tests/core/doctor-repair.test.ts`

**Estimated scope:** Medium

### Checkpoint: Deterministic Core

- Diagnostic doctor is report-only.
- All existing safe embedded auto-fixes have explicit repair handlers.
- `doctor-repair` core tests pass.
- Typecheck passes.

## Phase 3: API And CLI For `doctor --fix`

### Task 6: Add Health Plugin Repair Routes

**Description:** Add server-backed plan/apply routes under the health plugin.
These routes are called by the CLI; do not add an MCP repair exec tool in the
first pass.

**Acceptance criteria:**

- A plan route returns diagnostics plus repair plan without mutation.
- An apply route requires accepted confirmation and applies safe items only.
- API schemas cover JSON output for plan, apply results, and verification.
- Route failures are concise and actionable.

**Verification:**

```bash
bun test --isolate tests/plugins/health/routes.test.ts
bun run typecheck
```

**Dependencies:** Task 5

**Files likely touched:**

- `plugins/health/index.ts`
- `tests/plugins/health/routes.test.ts`

**Estimated scope:** Medium

### Task 7: Add CLI `bakin doctor --fix`

**Description:** Wire CLI flags, TTY confirmation, non-TTY/JSON `--yes` guards,
plain output, Ink output, and JSON envelopes for deterministic repair.

**Acceptance criteria:**

- `bakin doctor --fix` shows a plan before mutation in TTY.
- `bakin doctor --fix --yes` applies without prompting.
- `bakin doctor --fix --json` never mutates without `--yes`.
- Non-TTY without `--yes` never mutates.
- Exit codes distinguish success, warnings, repair failures, and confirmation
  required.

**Verification:**

```bash
bun test --isolate tests/cli/doctor-ui.test.tsx tests/cli
bun run typecheck
```

**Dependencies:** Task 6

**Files likely touched:**

- `cli/bakin.ts`
- `src/core/cli/ui/doctor.tsx`
- `tests/cli/doctor-ui.test.tsx`
- CLI parser/runner tests

**Estimated scope:** Medium

### Checkpoint: Issue #268

- `bakin doctor` report-only.
- `bakin doctor --fix` is the only deterministic repair command.
- JSON and non-TTY mutation guards pass.
- Focused plugin repair tests pass.
- Docs/knowledge are updated enough for #268.

## Phase 4: Delegated Repair State And Briefs

### Task 8: Add Doctor Repair Request Store

**Description:** Implement an atomic file-backed store for delegated repair
requests.

**Acceptance criteria:**

- Requests are written as one JSON file per id under month shards.
- Store supports create, update, get, list, append event.
- Malformed files are surfaced as read errors with file paths.
- Tests use temp BAKIN_HOME and never touch real `~/.bakin`.

**Verification:**

```bash
bun test --isolate tests/core/doctor-delegate.test.ts
bun run typecheck
```

**Dependencies:** Task 5

**Files likely touched:**

- `src/core/doctor-repair-store.ts`
- `tests/core/doctor-delegate.test.ts`
- `packages/core/src/content-dir.ts` if adding `doctor` to `BakinPaths`

**Estimated scope:** Medium

### Task 9: Build Delegated Repair Briefs

**Description:** Build a structured, deterministic brief from unresolved doctor
rows and skipped deterministic repair items.

**Acceptance criteria:**

- Brief includes request id, timestamp, selected issues, skipped deterministic
  repairs, verification instructions, and constraints.
- Brief does not include raw secrets or provider-owned file paths unless already
  present in doctor output.
- Empty delegation candidates return a clear no-op result.

**Verification:**

```bash
bun test --isolate tests/core/doctor-delegate.test.ts
```

**Dependencies:** Task 8

**Files likely touched:**

- `src/core/doctor-delegate.ts`
- `tests/core/doctor-delegate.test.ts`

**Estimated scope:** Small

### Task 10: Send Delegated Repair Requests

**Description:** Check runtime reachability, resolve the main agent, create the
linked board task, kick immediate dispatch, and record request status/events.

**Acceptance criteria:**

- Runtime unreachable means no message is sent and the request records failure.
- Successful `runtime.messaging.send()` marks request `sent`, not `completed`.
- The linked task is created in `todo`, assigned to the main agent, and includes
  the repair brief in its description.
- Immediate dispatch is triggered so the user sees the normal board transition
  from `todo` to `inProgress` when the agent picks it up.
- Linked task uses `source.pluginId = "health"` and
  `source.entityType = "doctor-repair"`.
- Status can be derived from request + linked task.

**Verification:**

```bash
bun test --isolate tests/core/doctor-delegate.test.ts tests/core/task-store.test.ts
bun run typecheck
```

**Dependencies:** Task 9

**Files likely touched:**

- `src/core/doctor-delegate.ts`
- `src/core/task-service.ts` call sites only
- `tests/core/doctor-delegate.test.ts`

**Estimated scope:** Medium

## Phase 5: API And CLI For `doctor --delegate`

### Task 11: Add Delegate And Repair History Routes

**Description:** Add health plugin routes for delegation, listing requests,
showing one request, and verifying one request.

**Acceptance criteria:**

- Delegate route requires explicit accepted confirmation to send.
- List/show routes expose durable request status.
- Verify route reruns doctor and updates request verification.
- Runtime failures return clear JSON errors.

**Verification:**

```bash
bun test --isolate tests/plugins/health/routes.test.ts tests/core/doctor-delegate.test.ts
bun run typecheck
```

**Dependencies:** Task 10

**Files likely touched:**

- `plugins/health/index.ts`
- `tests/plugins/health/routes.test.ts`

**Estimated scope:** Medium

### Task 12: Add CLI `--delegate` And `doctor repair` Subcommands

**Description:** Wire the delegated repair command and request inspection
commands into the CLI.

**Acceptance criteria:**

- `bakin doctor --delegate` renders selected issues and asks before sending.
- `--delegate --json` requires `--yes` before sending.
- `bakin doctor repair list` shows recent requests.
- `bakin doctor repair show <id>` shows request, task, and verification status.
- `bakin doctor repair verify <id>` reruns doctor and persists verification.

**Verification:**

```bash
bun test --isolate tests/cli tests/cli/doctor-ui.test.tsx
bun run typecheck
```

**Dependencies:** Task 11

**Files likely touched:**

- `cli/bakin.ts`
- `src/core/cli/ui/doctor.tsx`
- CLI parser/runner tests

**Estimated scope:** Medium

### Checkpoint: Issue #269

- Normal doctor and notify-agent remain report-only.
- `--delegate` is explicit and tracked.
- Runtime failures are clear and non-spammy.
- Fresh/offline installs do not delegate unless runtime is reachable.
- Repair request list/show/verify works in text and JSON.

## Phase 6: Documentation And Cleanup

### Task 13: Update Docs, Knowledge, And Generated References

**Description:** Update user docs, agent knowledge, generated settings/API/CLI
references, and remove stale auto-fix language.

**Acceptance criteria:**

- Health docs document `--fix`, `--delegate`, `--yes`, JSON behavior, and
  repair history commands.
- `.claude/knowledge/doctor-and-health-checks.md` describes the report-only
  diagnostic contract and repair/delegation architecture.
- Generated settings docs no longer list `doctor.autoFixSkill`.
- Generated API/CLI docs include new routes/commands.

**Verification:**

```bash
bun run docs:generate
bun run docs:validate
bun test --isolate tests/cli tests/plugins/health/routes.test.ts
```

**Dependencies:** Tasks 7 and 12

**Files likely touched:**

- `docs/src/content/docs/using/health.md`
- `docs/src/content/docs/reference/generated/*`
- `.claude/knowledge/doctor-and-health-checks.md`
- `.claude/knowledge/storage-model.md`
- `README.md` only if command list needs updating

**Estimated scope:** Medium

## Commit Strategy

1. `test: characterize report-only doctor repair boundaries`
   - Adds failing/protective tests and inventory notes.
   - Verification: focused core doctor tests.
   - Rollback: safe, tests only.

2. `feat: add health repair contracts`
   - Adds repair types and detailed check execution.
   - Verification: doctor plugin-check tests, typecheck.
   - Rollback: safe if no plugin conversions have landed.

3. `refactor: make health checks report-only`
   - Deletes `doctor.autoFixSkill` behavior and converts embedded auto-fix
     branches into explicit repair handlers.
   - Verification: focused plugin health tests, typecheck.
   - Rollback: revert with commit 2 if contract changes need rework.

4. `feat: implement doctor --fix workflow`
   - Adds repair service, health routes, CLI flag, confirmation guards.
   - Verification: doctor-repair, health routes, CLI tests.
   - Rollback: deterministic repair surface only; diagnostic purity remains.

5. `feat: add doctor repair request store`
   - Adds durable delegated request storage and brief construction.
   - Verification: doctor-delegate store/brief tests.
   - Rollback: no command surface yet.

6. `feat: implement doctor --delegate workflow`
   - Adds runtime send, linked task behavior, routes, CLI.
   - Verification: doctor-delegate, health routes, CLI tests.
   - Rollback: delegated workflow only.

7. `docs: document doctor repair workflows`
   - Updates docs, generated references, and knowledge files.
   - Verification: docs generate/validate.
   - Rollback: docs only.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hidden auto-fix behavior remains in one check | High | `rg autoFixSkill` is a required verification gate. |
| Repair handler mutates during planning | High | Plan handlers get unit tests with fixture state snapshots before/after. |
| CLI JSON accidentally prompts or mutates | High | Dedicated `--json` without `--yes` tests. |
| Delegation claims completion too early | Medium | Status model separates `sent`, `completed`, and `verified`. |
| Runtime unavailable on fresh installs | Medium | Runtime ping/main-agent resolution before send; no retries/spam. |
| Repair plan grows too large | Medium | Convert handlers by plugin owner and land deterministic workflow before delegation. |
| Task creation duplicates dispatch | Medium | Create the linked task once, assign it to `main`, and call the existing immediate single-task dispatch path instead of also sending an unrelated direct repair message. |

## Resolved Decision

Delegated repair creates a linked Bakin task by default. The task starts in
`todo`, is assigned to `main`, and immediate dispatch is kicked so the agent
picks up the visible board task through the normal dispatcher. Task completion
then provides the delegated repair completion signal; doctor verification still
provides the proof that the original issues are resolved.
