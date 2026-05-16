# Spec: Messaging Live Tool Activity

## Objective

Restore real-time tool/progress visibility in the Messaging brainstorm chat.
When a runtime agent calls tools during a brainstorm turn, the UI must show
activity rows as the calls/results happen, before the final assistant reply.

The exact regression is in the OpenClaw runtime adapter transcript lookup.
Bakin passes a stable runtime thread id such as `messaging:8f3ee82f:scout`.
The adapter converts that to a deterministic OpenClaw UUID, but current
OpenClaw records the live transcript in `sessions.json` under
`agent:<agentId>:explicit:<uuid>`. Bakin only checks the raw thread id, the
UUID, and `agent:<agentId>:<uuid>`, so the live transcript watcher never
attaches for these runs.

## Tech Stack

- TypeScript
- Bun test runner
- OpenClaw runtime adapter in `packages/adapter-openclaw`
- Messaging UI route and SSE bridge in linked official plugin source
- Integrated brainstorm UI in `src/components/integrated-brainstorm`

## Commands

- Target adapter regression: `bun test tests/adapter-openclaw/runtime-stream.test.ts --timeout 20000`
- Target messaging bridge: `bun test plugins/messaging/tests/streaming.test.ts --timeout 20000` from `../bakin-bits-official`
- Target UI activity handling: `bun test tests/components/integrated-brainstorm/send-streaming.test.tsx tests/components/integrated-brainstorm/activity-helpers.test.ts`
- Broader relevant check: `bun test tests/adapter-openclaw/runtime-stream.test.ts tests/components/integrated-brainstorm/send-streaming.test.tsx tests/components/integrated-brainstorm/activity-helpers.test.ts`

## Project Structure

- `packages/adapter-openclaw/src/runtime.ts` owns runtime streaming and transcript activity parsing.
- `tests/adapter-openclaw/runtime-stream.test.ts` owns the adapter-level streaming contract.
- `src/components/integrated-brainstorm/*` owns chat activity rendering and SSE parsing.
- `.claude/knowledge/messaging-plugin.md` and `.claude/knowledge/adapter-architecture.md` document the durable/session boundary.
- Official messaging plugin source is linked from `/Users/roscoe/go/src/github.com/markhayden/bakin-bits-official/plugins/messaging`.

## Code Style

Keep the fix direct and adapter-local:

```ts
return store[sessionKey]
  ?? store[cliSessionId]
  ?? store[`agent:${agentId}:explicit:${cliSessionId}`]
  ?? store[`agent:${agentId}:${cliSessionId}`]
```

Prefer a small resolver extension over new abstractions. The transcript parser,
activity mapper, and UI renderer already exist and should stay unchanged unless
tests prove another break.

## Testing Strategy

- Add a failing adapter regression test that writes `sessions.json` with the
  current OpenClaw `agent:<agentId>:explicit:<uuid>` key and asserts a tool
  activity chunk is emitted before the final Gateway response.
- Keep existing messaging plugin tests as bridge coverage: runtime `tool`
  chunks must become `event: activity` and persisted `activity` messages.
- Keep existing integrated brainstorm tests as UI coverage: `activity` SSE
  events must render during send and remain after the final reply.
- If the browser surface is touched, verify manually in the running UI after
  target tests pass.

## Boundaries

- Always: preserve the stable Bakin `threadId` contract; keep tool activity out
  of searchable `message_body`; run target tests.
- Ask first: editing the linked `bakin-bits-official` plugin source, changing
  runtime session id semantics, or changing visible activity UI layout.
- Never: restore legacy core messaging paths, bypass the runtime adapter, read
  provider state from the messaging plugin, or add compatibility shims outside
  the adapter boundary.

## Success Criteria

- A runtime transcript stored under `agent:<agentId>:explicit:<uuid>` is found
  by the adapter using the Bakin stable thread id.
- Tool call/result transcript rows stream as `ChatChunk { type: "tool" }`
  before the final assistant text arrives.
- Messaging SSE continues to forward those chunks as `event: activity`.
- The integrated brainstorm UI continues to render activity rows during send.
- Existing activity, proposal, and final-answer behavior remains unchanged.

## Implementation Plan

### Task 1: Adapter Regression Test

Acceptance:
- `runtime.messaging.stream()` emits a tool activity chunk when OpenClaw stores
  the transcript under `agent:<agentId>:explicit:<uuid>`.
- The first emitted chunk arrives before the Gateway final response.

Verify:
- `bun test tests/adapter-openclaw/runtime-stream.test.ts --timeout 20000`

Files:
- `tests/adapter-openclaw/runtime-stream.test.ts`

### Task 2: Resolver Fix

Acceptance:
- `resolveOpenClawSessionFile()` resolves the explicit session store key.
- Existing raw/UUID/store-key lookup behavior stays passing.

Verify:
- `bun test tests/adapter-openclaw/runtime-stream.test.ts --timeout 20000`

Files:
- `packages/adapter-openclaw/src/runtime.ts`

### Task 3: Bridge/UI Regression Sweep

Acceptance:
- Messaging bridge still emits activity SSE and persists activity messages.
- Integrated brainstorm still renders custom activity events.

Verify:
- `bun test plugins/messaging/tests/streaming.test.ts --timeout 20000` in `../bakin-bits-official`
- `bun test tests/components/integrated-brainstorm/send-streaming.test.tsx tests/components/integrated-brainstorm/activity-helpers.test.ts`

Files:
- No expected changes unless tests reveal a second issue.

## Commit Strategy

1. Commit adapter regression test and resolver fix together.
   - Rollback point: reverts only OpenClaw transcript lookup.
   - Verification: adapter stream test passes.
2. Commit docs/spec updates if follow-up documentation changes are needed.
   - Rollback point: documentation only.
   - Verification: no code test required beyond prior checkpoint.

## Open Question

Do we keep the fix strictly adapter-local, or also add a same-turn browser
smoke test for the Messaging page? Recommendation: adapter-local for this
change because the root cause is resolved before the plugin/UI boundary and the
existing UI tests already cover `activity` rendering.
