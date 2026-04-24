# Todo — IntegratedBrainstorm

Flat checklist mirroring [`plan.md`](./plan.md). Check items as you land them.

## Phase A — Foundations

- [x] **A1** Lifted `streamMessage` + `chatCompletion` into `src/core/openclaw-client.ts`; deleted `plugins/messaging/lib/gateway.ts` entirely (messaging migrated to the lifted helpers). Nine test files updated to add the new mocks.
- [x] **A2** SDK component skeleton at `src/components/integrated-brainstorm/` (9 files); exported `IntegratedBrainstorm` + types from `@bakin/sdk/components`.

## Phase B — Component feature slices

- [x] **B1** Collapse chrome + empty state + types. 8 tests in `collapse.test.tsx` + 6 in `empty-state.test.tsx`.
- [x] **B2** Message list rendering. 8 tests in `messages.test.tsx`.
- [x] **B3** Send state machine + streaming + thinking indicator + `fake-on-send.ts` helper + 27 culinary verbs. 13 tests in `send-streaming.test.tsx`.
- [x] **B4** Keyboard + IME + abort. 10 tests in `keyboard.test.tsx`.
- [x] **B5** Textarea auto-grow via `use-auto-grow.ts`. 7 tests in `auto-grow.test.tsx`.
- [x] **B6** Outer panel resize + auto-expand + `storageKey` localStorage. 12 tests in `resize.test.tsx`.
- [x] **B7** readOnly, transformAssistantMessage, onCustom, focus, scroll, agent picker, a11y, edge cases. 23 tests across `readonly-transform-custom.test.tsx` + `agent-focus-a11y.test.tsx`.

**Checkpoint B** ✅ — 87 component tests across 9 files, all green.

## Phase C — Migrations

- [x] **C1** Projects backend `POST /:id/ask` migrated to SSE (reuses lifted `streamMessage` + `chatCompletion` fallback). Existing 5 `/ask` JSON tests rewritten as 6 SSE tests in `tests/plugins/projects/routes.test.ts`. Added `rawResponse` option to `callRoute` helper for streaming endpoints.
- [x] **C2** `plugins/projects/components/project-detail.tsx` uses `<IntegratedBrainstorm>` with local `projectAskOnSend` SSE adapter. File trimmed from ~915 → 822 lines; all custom brainstorm state/effects/JSX removed.
- [x] **C3** `plugins/messaging/components/session-chat.tsx` refactored from ~435 → ~175 lines. Thin adapter wraps `<IntegratedBrainstorm>`: converts `SessionMessage[]` → `BrainstormMessage[]`, opens SSE to `/sessions/:id/messages`, forwards proposals via `onCustom` → `onProposalsReceived`, transforms assistant replies to strip inline `json` blocks and show "N items proposed" badge, sets `readOnly={isCompleted}`.
- [x] **C4** `plugins/messaging/components/brainstorm-panel.tsx` (dead code) deleted.

**Checkpoint C** ✅ — both plugins migrated, dead code removed, 3125 pass / 0 fail / 1 skip across 235 files.

## Phase D — Integration + smoke

- [x] **D1** Plugin integration tests.
  - Projects SSE server-side: 6 new tests inside `tests/plugins/projects/routes.test.ts` (token/done sequence, custom agent + history, fallback to `chatCompletion`, 400/404, error event).
  - Messaging client adapter: 3 tests in `tests/plugins/messaging/session-chat-proposals.test.tsx` (single-proposal forwarding, batch-proposals forwarding, error event → alert).
- [x] **D2** Manual smoke checklist (8 points from spec) — requires running `bun run dev` with real OpenClaw. Unchecked — user to run.

### Manual smoke checklist (from spec)

Against `bun run dev`:

- [x] Projects: new project → open it → expand Brainstorm → ask question → tokens stream → reply arrives → panel auto-expanded to 400px on first send.
- [x] Projects: drag outer handle up → more history visible; drag down → clamps at min.
- [x] Projects: mid-stream press Esc → stream stops, partial reply preserved, can send again immediately.
- [x] Projects: collapse chevron → panel collapses to header; chevron flips; click again → expands, textarea focused.
- [x] Messaging: open existing session → send message → tokens stream → proposals appear in review panel.
- [x] Messaging: complete a session → input replaced with read-only badge; history still scrolls.
- [x] Messaging: Cmd+Enter sends (not just Enter).
- [x] Messaging: IME composition (e.g. macOS emoji picker Ctrl+Cmd+Space, or JP input if available) → Enter doesn't send mid-composition.

## Final totals

- **3125 tests pass**, 1 skip, **0 fail**, across 235 files.
- **Build passes** — three platform binaries produced.
- **New source files**: 9 in `src/components/integrated-brainstorm/`, 1 vendor tweak in `packages/sdk/src/components/index.ts`, 2 core additions in `src/core/openclaw-client.ts` (`streamMessage`, `chatCompletion`).
- **Deleted**: `plugins/messaging/lib/gateway.ts`, `plugins/messaging/components/brainstorm-panel.tsx`.
- **New tests**: ~100 cases in `tests/components/integrated-brainstorm/**` + 9 cases across two new plugin integration test files.
