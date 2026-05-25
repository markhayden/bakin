# Spec: Agent Runtime Timeout Reconciliation

## Objective
Prevent Bakin-dispatched tasks from staying silently `inProgress` after the backing OpenClaw/Codex turn has already ended with a terminal runtime failure. A task that never reached an agent should return to `todo` under the existing dispatch retry/cooldown policy. A task that reached an agent and then failed before `tasks_complete` or `tasks_block` should move to `blocked` with a sanitized system log.

## Commands
- Focused test: `bun test --isolate tests/core/dispatch.test.ts`
- Typecheck: `bun run typecheck`
- Broader check: `bun test --isolate tests/core/dispatch.test.ts tests/core/watchdog.test.ts tests/core/restart-recovery.test.ts`

## Project Structure
- `src/core/dispatch.ts` owns task dispatch, runtime send handling, and dispatch-state reconciliation.
- `src/core/watchdog.ts` remains the slower stale-task backstop.
- `src/core/restart-recovery.ts` remains the one-shot boot repair path.
- `.claude/knowledge/dispatch.md` documents operational dispatch behavior.
- `tests/core/dispatch.test.ts` covers dispatch retry, failure handling, and marker reconciliation.

## Code Style
Dispatch code should keep provider-specific details behind the runtime adapter and classify only sanitized error shapes:

```ts
if (runtimeFailureWasTerminal) {
  await blockStoredTask(task.id, 'Agent runtime timed out before reporting completion.')
  await addTaskLog(task.id, 'system', 'Agent run ended before task completion: codex app-server idle timeout waiting for turn completion.')
}
```

## Testing Strategy
- Unit-level dispatch tests reproduce late runtime rejection after task completion, terminal idle timeout while still active, and stale `dispatched[]` cleanup.
- Existing cooldown tests continue to prove transport/delivery failures retry through `failedDispatches`.
- Typecheck must pass because dispatch uses shared task/runtime types.

## Boundaries
- Always: Re-read task state after `runtime.messaging.send` rejects before mutating task state.
- Always: Use sanitized summaries in task logs/audit for runtime failure diagnostics.
- Always: Preserve completed/blocked/review task state when a late runtime error arrives.
- Ask first: Introduce a new task column such as `failed` or require a new runtime execution API contract.
- Never: Dump full prompts, local paths, tokens, or trajectory payloads into task logs.

## Success Criteria
- A task cannot remain indefinitely `inProgress` after a known Codex app-server turn idle timeout.
- Runtime failure after a task already completed does not add a misleading task log or failure retry record.
- Dispatch markers are retained only for active `inProgress` tasks.
- Existing dispatch retry/cooldown behavior still works for delivery failures that did not reach an agent.

## Open Questions
- OpenClaw currently does not provide a populated Bakin `task.execution.flowId` for these dispatches. If a stable runtime execution API becomes available, Bakin should consume it from a watchdog-style reconciler instead of relying only on `runtime.messaging.send` rejection.
