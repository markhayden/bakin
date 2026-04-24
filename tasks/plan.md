# Plan — IntegratedBrainstorm

Spec: [`.claude/specs/integrated-brainstorm.md`](../.claude/specs/integrated-brainstorm.md).

## Planning discoveries

While reading the codebase to finalize this plan, three things from the spec's "known unknowns" were resolved and one spec detail is adjusted:

1. **Streaming helper**: `src/core/openclaw-client.ts:sendMessage` is non-streaming. The only streaming path today is `plugins/messaging/lib/gateway.ts:streamChatCompletion`, which posts to `POST /v1/chat/completions` with `stream: true` against `http://localhost:18789`. Plugins never cross-import (CLAUDE.md), so we **lift that helper into `src/core/openclaw-client.ts` as a new exported `streamMessage(agentId, message, { signal? })` returning `Response`**, and have both messaging and projects consume it. Messaging migrates to the lifted helper as part of this work. Duplication is not acceptable — no tech debt.
2. **`useAgentColor`**: already exported from `@bakin/sdk/hooks` (`packages/sdk/src/hooks/index.ts:31`). No action.
3. **`getMainAgentId`**: continues to be called server-side in projects `/ask` to default the agent. Preserved in the SSE handler.
4. **Test location (spec adjustment)**: repo convention is `tests/components/*.test.tsx` with `// @vitest-environment jsdom`, `bun:test`, `@testing-library/react`. Component unit tests go to **`tests/components/integrated-brainstorm/`**, not `packages/sdk/src/components/integrated-brainstorm/__tests__/` as the spec stated. Plugin integration tests go to `tests/plugins/{projects,messaging}/`. The spec will be corrected in a follow-up commit.

## Dependency graph

```
A1 streamMessage helper ─┐
                         ├──▶ C1 projects SSE backend ──▶ C2 projects client ─┐
A2 component skeleton ───┘                                                     │
       │                                                                       │
       ▼                                                                       ▼
  B1 collapse+empty ──▶ B2 messages ──▶ B3 send+streaming ──▶ B4 keyboard ──▶ B5 textarea ──▶ B6 resize ──▶ B7 remainder
                                                                                                                │
                                                                            C3 messaging client ◀───────────────┤
                                                                                      │                         │
                                                                                      ▼                         ▼
                                                                                C4 delete dead code       D1 integration tests
                                                                                                                │
                                                                                                                ▼
                                                                                                         D2 manual smoke
                                                                                                                │
                                                                                                                ▼
                                                                                                         ✅ ship
```

Parallelizable: A1 ∥ A2. B1–B7 are sequential (each builds on prior UI state). C2 and C3 can go in parallel once B7 is green.

## Phases & slices

Each slice = one vertical cut: code + tests + type-check + runs green. No "build the whole component then bolt on tests at the end."

### Size key

- **XS** < 30 min · **S** 30–90 min · **M** 90 min–4 h · **L** 4–8 h

### Phase A — Foundations

#### A1. Lift `streamMessage` into `src/core/openclaw-client.ts` — **S**

Move streaming logic from `plugins/messaging/lib/gateway.ts` into core. Export `streamMessage(agentId: string, message: string, opts?: { signal?: AbortSignal; maxTokens?: number }): Promise<Response>` — returns the raw SSE response so the caller owns the reader loop. Keep the existing retry/error shape of `sendMessage` for transient failures on the initial fetch (not during the stream itself).

Update `plugins/messaging/index.ts` and `plugins/messaging/lib/gateway.ts` in the same commit to consume the lifted helper. Delete the now-redundant function definition in `gateway.ts` (but leave `getGatewayToken` + `chatCompletion` if still used — the lift is surgical).

**Acceptance**
- [ ] `src/core/openclaw-client.ts` exports `streamMessage` with JSDoc matching `sendMessage`'s style.
- [ ] `plugins/messaging/index.ts` imports `streamMessage` from `@/core/openclaw-client` instead of `./lib/gateway`.
- [ ] `plugins/messaging/lib/gateway.ts` either has `streamChatCompletion` removed or re-exports from core (prefer remove — fewer layers).
- [ ] Messaging session chat still streams end-to-end (spot-check in `bun run dev`).
- [ ] `bun run build` passes.
- [ ] Existing messaging tests still pass under `bun test --isolate`.

**Verification**
```
bun run build
bun test tests/plugins/messaging --isolate
# then: bun run dev, open a messaging session, send a message, confirm tokens stream
```

---

#### A2. Component skeleton — **S**

Create the directory and empty files listed under spec → Architecture → Placement. Export `IntegratedBrainstorm` and `BrainstormMessage` from `packages/sdk/src/components/index.ts`. Component renders a bordered empty div. No behavior yet, just wiring.

**Acceptance**
- [ ] `packages/sdk/src/components/integrated-brainstorm/{index.tsx,message-list.tsx,input-row.tsx,collapsed-header.tsx,empty-state.tsx,thinking-indicator.tsx,use-auto-grow.ts,use-brainstorm-state.ts,types.ts}` exist.
- [ ] `IntegratedBrainstorm` + `BrainstormMessage` + `IntegratedBrainstormProps` exported from `@bakin/sdk/components`.
- [ ] `<IntegratedBrainstorm messages={[]} onMessagesChange={() => {}} onSend={async () => ({ content: '' })} agentId="x" />` renders without error.
- [ ] `bun run build` passes (types compile).

**Verification**
```
bun run build
```

**Checkpoint A**: Foundations merged before starting B.

---

### Phase B — Component feature slices

Each slice is code + tests + green `bun test`. Tests use the convention from `tests/components/empty-state.test.tsx` (jsdom, bun:test, @testing-library/react, mock `@bakin/core/main-agent` and both content-dir paths even though the component doesn't touch fs — defensive).

A shared test helper `tests/components/integrated-brainstorm/fake-on-send.ts` is built in B3 and reused by every subsequent slice.

#### B1. Collapse chrome + empty state + types — **M**

Render the collapsed header (icon + label + reply-count) and the default + custom empty states. Collapsing toggles via header click. `collapsible={false}` hides the chevron. Custom `icon` / `label` props respected. Empty state uses `<AgentAvatar size="xl">`.

**Covers tests**: 1.1, 1.2, 1.3, 2.1–2.7, 14.1 (aria-expanded), 14.2 (drag handle role — placeholder handle now, wired in B6).

**Acceptance**
- [ ] Tests pass: `bun test tests/components/integrated-brainstorm/collapse.test.tsx --isolate`.
- [ ] Tests pass: `bun test tests/components/integrated-brainstorm/empty-state.test.tsx --isolate`.
- [ ] Header has `role="button"` + `aria-expanded`.
- [ ] `bun run build` passes.

---

#### B2. Message list rendering — **M**

User and assistant bubbles. Markdown-render assistant content via `<MarkdownContent>`. Avatar + agent-color left border on assistant. Consecutive assistant grouping with `-mt-2`. Message-level `agentId` override. User messages NOT markdown-rendered.

**Covers tests**: 1.4, 1.5, 1.6, 1.7, 1.8.

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/messages.test.tsx`.
- [ ] Renders 100 messages without console warnings (manual quick check).
- [ ] `bun run build` passes.

---

#### B3. Send state machine + streaming + thinking indicator — **L**

Core of the component. `use-brainstorm-state.ts` implements the state machine: `idle → sending → streaming → idle`, with transitions for resolve / reject / abort. Thinking indicator with randomized culinary verb (stable per request). Streaming bubble replaced by final message on resolve. Error path appends error bubble. Concurrent-send guard. Optimistic user-message append + input clear.

Also: ship the shared `fake-on-send.ts` test helper here.

**Covers tests**: 4.1–4.12, 13.1–13.4, 14.5 (aria-live on thinking), 14.6 (role=alert on error).

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/send-streaming.test.tsx`, `tests/components/integrated-brainstorm/thinking-indicator.test.tsx`.
- [ ] `fake-on-send.ts` helper exposes `{ onSend, emitToken, emitCustom, resolve, reject }`.
- [ ] All 27 verbs reachable with Math.random mock seeds (tested via property assertion, not 27 individual tests).
- [ ] `bun run build` passes.

---

#### B4. Keyboard + IME + abort — **M**

Enter sends, Shift+Enter newline, Cmd/Ctrl+Enter sends, Esc aborts. IME composition suppresses Enter-sends during active composition. Abort preserves partial tokens. readOnly suppresses all keyboard actions (input row suppressed in B7, but the handlers must already respect the flag).

**Covers tests**: 5.1–5.10.

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/keyboard.test.tsx`, `tests/components/integrated-brainstorm/abort.test.tsx`.
- [ ] `AbortController.abort()` actually called on Esc (verified via spy on controller).
- [ ] IME test covers compositionstart → Enter → compositionend sequence.
- [ ] `bun run build` passes.

---

#### B5. Textarea auto-grow — **S**

`use-auto-grow.ts` hook — listens to input change, sets height from `scrollHeight`, caps at `maxInputHeight`, sets `overflow-y: auto` past cap. Initial 2 rows. No `resize-y` CSS class.

**Covers tests**: 6.1–6.7.

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/auto-grow.test.tsx`.
- [ ] No native `resize-y` class on the textarea (DOM assertion).
- [ ] `bun run build` passes.

---

#### B6. Outer panel resize + auto-expand + storage — **M**

Wire `useVerticalResize` for the outer panel. Drag handle at top. Auto-expand on first send to `conversationStartHeight`, one-shot. `storageKey` persists height via the hook's existing localStorage support. Drag handle has the correct ARIA.

**Covers tests**: 3.1–3.9, 14.2.

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/resize.test.tsx`.
- [ ] `storageKey` undefined → no `localStorage` calls (asserted via spy).
- [ ] Touch drag path covered by test.
- [ ] `bun run build` passes.

---

#### B7. Everything else + readOnly + transformAssistant + onCustom + focus + a11y + edge cases — **L**

Agent picker via `<AgentSelect>` when `onAgentChange` is present. readOnly input-row replacement (+ default "Chat is read-only" when no notice). `transformAssistantMessage` applied to streaming text AND final content. `onCustom` pass-through verified. Focus rules on expand/after-send. Auto-scroll to bottom on message/token. Edge cases: agentId mid-conversation, empty resolved content, rapid send/abort cycles, 10k-char message.

**Covers tests**: 7.1, 7.3, 7.4, 8.1–8.6, 9.1–9.4, 10.1–10.5, 11.1–11.3, 12.1–12.4, 14.3, 14.4, 15.1–15.5.

**Acceptance**
- [ ] Tests pass: `tests/components/integrated-brainstorm/{read-only,transform,on-custom,focus,scroll,agent-picker,edge-cases,accessibility}.test.tsx`.
- [ ] `bun run build` passes.
- [ ] Every prop in `IntegratedBrainstormProps` has at least one test asserting a non-default behavior.
- [ ] Every branch in `use-brainstorm-state.ts` exercised (eyeball coverage, not tooling — bakin doesn't have coverage wired).

**Checkpoint B**: Component complete. Run `bun test tests/components/integrated-brainstorm --isolate` — all slices green. Run `bun run build` — no type errors. Run `bun run dev` and manually instantiate the component in a scratch page (or projects, once C2 lands). Stop and review before starting migrations.

---

### Phase C — Migrations

#### C1. Projects backend: `/ask` → SSE — **S**

Rewrite `plugins/projects/index.ts:352-404` from JSON reply to SSE. Reuse the `streamMessage` helper from A1. Event shape mirrors messaging: `token` / `done` / `error`. No `proposal` events (projects doesn't do structured outputs yet). Final `done` emits `{ content, messageId? }`. `getMainAgentId` still defaults the agent.

**Acceptance**
- [ ] `POST /api/plugins/projects/:id/ask` responds with `Content-Type: text/event-stream`.
- [ ] Event shape documented inline with a short comment pointing at the spec.
- [ ] Legacy JSON response path removed; no fallback.
- [ ] Automated test at `tests/plugins/projects/ask-sse.test.ts`: POST a prompt with mocked `streamMessage` returning a canned SSE body, consume stream, assert token + done events in order. Per CLAUDE.md rules: mock content-dir, logger, watcher, openclaw-client.
- [ ] `bun test tests/plugins/projects --isolate` passes.
- [ ] `bun run build` passes.

---

#### C2. Projects client: `project-detail.tsx` uses `<IntegratedBrainstorm>` — **M**

Delete brainstorm state (lines 124–160 area) and the bottom-panel JSX (lines 646–735). Add a local `projectAskOnSend` adapter (~30 lines) that opens SSE to the new `/ask` route, forwards tokens via `onToken`, and resolves with `{ content }` on `done`. Pass `<IntegratedBrainstorm messages={…} onMessagesChange={…} agentId={…} onAgentChange={…} onSend={projectAskOnSend} label="Brainstorm" icon={Sparkles} conversationStartHeight={400} />`.

**Acceptance**
- [ ] `project-detail.tsx` has no `useVerticalResize`, no `brainstormTextareaRef`, no `ResizeObserver`, no manual `brainstormMessages`/`agentLoading` state beyond what the adapter needs.
- [ ] `projectAskOnSend` honors the `AbortSignal` — closes the reader when aborted.
- [ ] Visual parity with current projects brainstorm (screenshot compare in dev).
- [ ] End-to-end works in `bun run dev`: send a message, see tokens stream, reply lands, panel auto-expanded to 400px.
- [ ] Esc mid-stream aborts cleanly.
- [ ] No new type errors in `bun run build`.

---

#### C3. Messaging client: `session-chat.tsx` uses `<IntegratedBrainstorm>` — **M**

Refactor to a thin adapter. Extract the SSE-reading loop into `sessionOnSend(prompt, history, { signal, onToken, onCustom })` — internal to messaging. Replace `onProposalsReceived` call with `onCustom('proposal', proposal)`. Lift `handleProposalsReceived` one level to `planning-layout.tsx` via a passed callback from the component adapter. Wire `readOnly={isCompleted}` + `readOnlyNotice={<Badge variant="outline">Session completed — read-only</Badge>}`. Pass `transformAssistantMessage={stripJsonBlocks}` where `stripJsonBlocks` is the existing `stripAndSplit` helper adapted to the `{ text, extras? }` return shape — return `text` as the content without JSON blocks, return `extras` as the "N items proposed" badge.

**Acceptance**
- [ ] `session-chat.tsx` is < 150 lines (currently ~430).
- [ ] `stripAndSplit` moved into a pure util under `plugins/messaging/lib/` or kept inline if trivial.
- [ ] Proposals still appear in the review panel when streaming completes.
- [ ] `isCompleted` sessions show the read-only badge.
- [ ] No regressions in `bun test tests/plugins/messaging --isolate`.
- [ ] `bun run build` passes.
- [ ] Smoke: open an existing session in `bun run dev`, send a message, tokens stream, proposals arrive, review panel updates.

---

#### C4. Delete dead brainstorm-panel.tsx — **XS**

Remove `plugins/messaging/components/brainstorm-panel.tsx`. Run `grep -r BrainstormPanel plugins/ src/ packages/` to confirm no importers.

**Acceptance**
- [ ] File deleted.
- [ ] Grep shows zero references to `BrainstormPanel` outside git history.
- [ ] `bun run build` passes.

**Checkpoint C**: Both plugins migrated. Run `bun test --isolate`. Run `bun run dev` and walk the full smoke checklist from the spec. Stop and review before ship.

---

### Phase D — Integration tests + smoke

#### D1. Plugin-level integration tests — **M**

Two tests that exercise the full stack with mocked transports:

1. `tests/plugins/projects/ask-sse-e2e.test.ts` — activates the projects plugin, POSTs to `/ask` with a mocked streaming `openclaw-client.streamMessage` returning a canned SSE body, consumes the response stream, asserts token events + final done.
2. `tests/plugins/messaging/session-chat-proposals.test.ts` — activates the messaging plugin, simulates an SSE response containing an inline `json` proposal block, asserts that `onProposalsReceived` (or the new upstream equivalent) fires with the parsed proposal.

Both tests follow CLAUDE.md rules: mock content-dir (both paths), logger, watcher, openclaw-client.

**Acceptance**
- [ ] `bun test tests/plugins/projects --isolate` passes.
- [ ] `bun test tests/plugins/messaging --isolate` passes.
- [ ] Neither test writes to `~/.bakin/` (asserted by tmp-dir check).

---

#### D2. Manual smoke checklist — **S**

Run through the 8-point checklist in the spec under "Manual smoke checklist." Record results as checkboxes in the PR description. Any failure returns the work to the relevant phase.

**Acceptance**
- [ ] All 8 boxes checked.
- [ ] Any failures logged as follow-up issues or fixed in-flight.

**Checkpoint D**: Ship.

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `streamMessage` regression breaks messaging SSE mid-migration | Medium | A1 migrates messaging + projects together in one commit with tests; rollback = revert the one commit. |
| `scrollHeight` measurement behaves differently across browsers / jsdom shim | Medium | Use a pure CSS-based auto-grow where possible (e.g., `field-sizing: content` where supported, fall back to scrollHeight). Test in real browser during C2/C3 smoke. |
| SSE handlers leak connections when user navigates away mid-stream | Low | `AbortController.abort()` on unmount — baked into the component's `use-brainstorm-state.ts`. |
| `planning-layout.tsx` refactor breaks proposal threading | Low | Covered by D1 integration test + C3 smoke. |
| Auto-expand fires twice after remount with persisted height | Low | Ref guard persists across renders but not remounts — on remount, if `storageKey` height > `minHeight`, skip auto-expand (height was persisted, user had it set). Document in B6. |

## Rollout

No feature flag. Single user, single machine. Ship behind whatever branch name you prefer (`ui/integrated-brainstorm` is an option given current branch naming). Merge to `main` after Checkpoint D passes.

## Follow-ups (not in this plan)

- Playwright E2E coverage.
- `position="top"` / `position="side"` variants.
- Shared visual regression harness.
- SSE retry / resume for flaky networks.
- Correct the test-location discrepancy in the spec (`tests/components/` vs `packages/sdk/src/...`).
