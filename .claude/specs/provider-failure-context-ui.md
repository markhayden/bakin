# Spec: Provider Failure Context UI

## Objective

Make runtime dispatch failures explainable when a task cannot start because the
assigned model provider is unavailable, cooling down, or missing an auth lane.
The user should be able to tell the difference between "the task logic failed"
and "the runtime could not even start the agent turn."

This first slice is task-local: task logs, task details, task cards where useful,
and live activity entries. It does not add a global provider health banner.

## Assumptions

- Runtime dispatch errors continue to enter Bakin through
  `runtime.messaging.send()` rejection in `src/core/dispatch.ts`.
- Bakin should preserve sanitized runtime details, not full provider traces,
  prompts, local paths, tokens, or raw trajectory payloads.
- The most important visible cases are OpenClaw/Codex provider cooldown and auth
  lane unavailability errors, such as `No available auth profile for
  openai-codex` and `Provider openai-codex is in cooldown`.
- Structured details should be carried through existing task log and audit
  plumbing where possible.

## Tech Stack

- TypeScript
- Bun test runner
- React task UI in `plugins/tasks/components`
- Shared host activity feed in `src/components/tasks/activity-feed.tsx`
- Bakin task store in `packages/core/src/tasks/store.ts`

## Commands

- Focused dispatch test: `bun test --isolate tests/core/dispatch.test.ts`
- Focused audit message test: `bun test --isolate tests/lib/map-audit-message.test.ts`
- Focused task UI tests: `bun test --isolate tests/plugins/tasks/task-detail-dialog.test.tsx tests/plugins/tasks/task-card.test.tsx`
- Typecheck: `bun run typecheck`
- Broader relevant check: `bun test --isolate tests/core/dispatch.test.ts tests/lib/map-audit-message.test.ts tests/plugins/tasks/task-detail-dialog.test.tsx tests/plugins/tasks/task-card.test.tsx tests/components/use-sse-doctor.test.tsx`

## Project Structure

- `src/core/dispatch.ts` owns runtime send rejection handling, dispatch
  retry/cooldown state, task log writes, and dispatch audit events.
- `src/core/task-store.ts` adapts the file-backed task store into board-shaped
  task objects.
- `packages/core/src/tasks/store.ts` already supports `TaskLogEntry.data`.
- `plugins/tasks/types.ts` and `packages/sdk/src/types/index.ts` expose task log
  shapes to plugin UI and SDK consumers.
- `plugins/tasks/components/task-detail-dialog.tsx` renders task notes/logs.
- `plugins/tasks/components/task-card.tsx` renders compact task context.
- `src/lib/map-audit-message.ts`, `src/hooks/use-sse.ts`, and
  `packages/host/src/api/activity.ts` map audit JSONL/SSE events into the live
  activity feed.
- `.claude/knowledge/dispatch.md` documents dispatch failure handling.

## Code Style

Use a small structured classifier and keep raw provider text bounded:

```ts
const detail = classifyDispatchFailure(err)
await addTaskLog(task.id, 'system', detail.summary, {
  reasonCode: detail.reasonCode,
  provider: detail.provider,
  model: detail.model,
  retryable: detail.retryable,
  rawError: detail.rawError,
})
appendAudit(contentDir, 'task.dispatch_failed', targetAgent, detail)
```

Visible UI text should lead with the user-facing cause:

```tsx
<DispatchFailureNotice detail={entry.data.dispatchFailure}>
  Dispatch failed: model provider unavailable
</DispatchFailureNotice>
```

## Testing Strategy

- Add dispatch tests that reproduce provider cooldown and auth-profile
  unavailability and assert structured failure details in audit and task log
  data.
- Add audit message tests for readable `task.dispatch_failed` messages.
- Add task UI tests for rendering the readable reason and technical detail
  disclosure from structured log data.
- Keep existing transient/structural cooldown tests passing.
- Use typecheck to catch task log shape changes across core, SDK, and plugins.

## Boundaries

**Always:**
- Keep provider-specific transport behind runtime adapters; classify only the
  sanitized error text Bakin already receives.
- Bound and sanitize any raw error shown in technical details.
- Mark retryability clearly for provider cooldown and auth/profile availability
  failures.
- Preserve existing retry/cooldown behavior.
- Update `.claude/knowledge/dispatch.md` when the failure detail contract lands.

**Ask first:**
- Add a global provider health banner or provider-wide health aggregation.
- Add a new task column such as `failed`.
- Change OpenClaw auth/profile configuration behavior.
- Retry immediately from the UI instead of relying on dispatch cooldown.

**Never:**
- Persist full prompts, local filesystem paths, tokens, or provider trajectory
  dumps in task logs, audit entries, or activity events.
- Reach around the runtime adapter into provider-private state from UI/plugin
  code.
- Add backwards-compatibility shims for obsolete task log shapes beyond reading
  missing `data` as "plain log entry."

## Success Criteria

- A provider cooldown dispatch rejection appears as a readable failure, not as
  only `runtime dispatch failed before task completion`.
- An auth lane/profile unavailability rejection appears as a readable
  configuration/availability failure.
- Task logs and audit events preserve enough structured context for UI rendering:
  `reasonCode`, `provider`, optional `model`, `retryable`, and bounded
  `rawError`.
- The task detail drawer exposes technical details without making raw logs the
  primary UI text.
- Existing dispatch retry/cooldown behavior and existing task lifecycle behavior
  remain unchanged.

## Implementation Plan

### Task 1: Dispatch Failure Detail Contract

Description: Add a typed `DispatchFailureDetail` classifier in
`src/core/dispatch.ts` and test provider cooldown/auth-lane cases.

Acceptance:
- Provider cooldown error maps to `reasonCode: "provider_cooldown"`.
- No-auth-profile error maps to `reasonCode: "auth_profile_unavailable"`.
- Unknown dispatch failures still map to a generic structural detail.

Verify:
- `bun test --isolate tests/core/dispatch.test.ts`

Files:
- `src/core/dispatch.ts`
- `tests/core/dispatch.test.ts`

### Task 2: Persist Structured Details Through Task Logs And Audit

Description: Preserve structured failure details in task log `data` and
`task.dispatch_failed` audit data.

Acceptance:
- System task log entries for dispatch rejection include structured data.
- Audit entries include the same sanitized structured fields.
- Plain task logs still render normally.

Verify:
- `bun test --isolate tests/core/dispatch.test.ts`
- `bun run typecheck`

Files:
- `src/core/dispatch.ts`
- `src/core/task-store.ts`
- `plugins/tasks/types.ts`
- `packages/sdk/src/types/index.ts`

### Task 3: Render Task-Local Failure Context

Description: Show task-local dispatch failure context in task detail notes and a
small card indicator when the latest relevant log entry is a dispatch failure.

Acceptance:
- Task detail drawer shows the readable reason, retryability, provider/model,
  and expandable technical details.
- Task card can signal the latest dispatch failure without crowding normal task
  content.
- Missing `data` falls back to the existing plain text note display.

Verify:
- `bun test --isolate tests/plugins/tasks/task-detail-dialog.test.tsx tests/plugins/tasks/task-card.test.tsx`

Files:
- `plugins/tasks/components/task-detail-dialog.tsx`
- `plugins/tasks/components/task-card.tsx`
- `tests/plugins/tasks/task-detail-dialog.test.tsx`
- `tests/plugins/tasks/task-card.test.tsx`

### Task 4: Live Activity Message Mapping

Description: Map `task.dispatch_failed` audit events to readable activity feed
messages and carry structured details through SSE/API events if needed for
debug/technical display.

Acceptance:
- Live activity says `Dispatch failed: model provider unavailable` for provider
  cooldown/auth unavailability rather than the raw event name.
- X-Ray/debug mode can still show the event name and technical data.

Verify:
- `bun test --isolate tests/lib/map-audit-message.test.ts`
- Any touched activity/SSE tests.

Files:
- `src/lib/map-audit-message.ts`
- `src/types/index.ts`
- `src/hooks/use-sse.ts`
- `packages/host/src/api/activity.ts`
- `src/components/tasks/activity-feed.tsx`
- `tests/lib/map-audit-message.test.ts`

### Task 5: Documentation And Final Review

Description: Document the new structured failure context and run quality gates.

Acceptance:
- `.claude/knowledge/dispatch.md` describes reason codes and UI-facing detail.
- The final diff has no provider-boundary leaks or unbounded raw error output.

Verify:
- `bun run typecheck`
- Focused tests from Tasks 1, 3, and 4.

Files:
- `.claude/knowledge/dispatch.md`

## Commit Strategy

1. `test(core): capture provider dispatch failure details`
   - Rollback point: test-only reproduction.
   - Verification: new tests fail before implementation, then pass after Task 1.
2. `feat(core): add structured dispatch failure details`
   - Rollback point: backend data contract only.
   - Verification: dispatch tests and typecheck.
3. `feat(tasks): surface dispatch failure context`
   - Rollback point: UI-only task-local rendering.
   - Verification: task component tests.
4. `feat(activity): map dispatch failures into readable feed entries`
   - Rollback point: activity feed mapping only.
   - Verification: audit message tests and relevant SSE/API tests.
5. `docs(dispatch): document provider failure context`
   - Rollback point: documentation only.
   - Verification: previous gates remain green.

## Open Questions

1. Should auth-profile unavailable and provider-cooldown failures use the same
   user-facing label (`model provider unavailable`) or distinct labels?
