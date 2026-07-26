# Plan — Chat Queue & Follow-ups

**Spec:** `.claude/specs/chat-queue-and-followups.md` (approved 2026-07-25, user-lens reviewed)
**Issues:** #729 + #732 (queue feature, two layers), #730 (draft attachments), #731 (capability cache)
**Branch:** `feat/chat-queue-and-followups` in the MAIN checkout (test-live-before-merge rule). Verify HEAD before every commit.

## Dependency graph

```
T1 engine queue (src/core/conversation-turns.ts + SDK types)
 └─ T2 kit queue-awareness (composer, thread hook, QueuedMessageList, panel)
     └─ T3 chat wiring (store/bridge/routes/boot + chat client UI)
T4 draft attachments (#730)          — independent of T1–T3 (touches chat-view/page only)
T5 capability revalidation (#731)    — independent of everything
T6 knowledge docs                    — after T3–T5 settle
```

T1→T2→T3 are strictly ordered (each consumes the previous layer's API). T4/T5 can land any time after T3 to avoid merge friction in `chat-view.tsx` (T3 and T4 both touch it). Each task = one commit = one rollback checkpoint; every commit leaves `bun run lint` + `bun run typecheck` + `bun run test` green.

---

## T1 — `feat(conversations): engine pending queue with combined drain`

**Files:** `src/core/conversation-turns.ts`, `packages/sdk/src/types/conversation-turns.ts`, `tests/core/conversation-turns.test.ts`

1. Engine (`src/core/conversation-turns.ts`):
   - `QueuedMessage { id, ts, content, attachments? }`; `StartTurnResult` gains `'queued'`; `StartTurnOptions` gains `queueIfBusy?: boolean`.
   - Config gains `queue?: { persist?, event? }` (spec §1).
   - `start()`: after the `resolveThread`/agentId resolution, the busy-check + enqueue happen in ONE synchronous block (TOCTOU-safe). Without `queueIfBusy` (or without `config.queue`): today's `'busy'` path byte-for-byte.
   - Enqueue: push, fire-and-forget `persist` (await it — persistence is the durability promise; log-never-throw), emit `config.queue.event` with `{ ...payload(key), queueId, queueLength }`, return `'queued'`.
   - New methods: `listQueued`, `removeQueued` (persists), `clearQueue` (persists empty), `restore(ctx, key, items)` (seed + drain if idle).
   - Drain: chained after slot release in the settle path (done/error/abort all drain). Dequeue ALL, persist empty FIRST (crash between persist and row-append loses nothing user-visible at worst re-queues — pick: persist AFTER rows appended so a crash re-drains at boot instead of losing messages; document the at-least-once choice in a comment), append each message as its own durable `user` row, run ONE turn: content = messages joined `\n\n`, attachments merged, one turnId/meter/framing. Drain `resolveThread` null → drop queue + persist empty.
   - The drained turn reserves the slot synchronously before any await (same TOCTOU rule); a `start()` racing the drain gets `'queued'` again.
2. SDK types (`packages/sdk/src/types/conversation-turns.ts`): mirror additively — `'queued'` result member, `queueIfBusy`, `queue` config, `QueuedMessage`, new service methods. No behavior change for existing consumers (bits plugins unaffected until they opt in).
3. Tests (`tests/core/conversation-turns.test.ts`, mocked-runtime scripted generators, existing harness):
   - `queueIfBusy` during inflight → `'queued'` + event emitted + persist called; without opt-in → `'busy'` unchanged.
   - FIFO combined drain after **done**, after **error**, after **abort**: N user rows in order, ONE runtime call with joined content + merged attachments, one meter call.
   - `removeQueued` / `clearQueue` persist; `restore` with idle slot drains immediately; `restore` while busy waits for settle.
   - Drain with deleted thread drops the queue without throwing.
   - Race: `start(queueIfBusy)` called while drain is reserving → `'queued'`, no double turn.

**Acceptance:** all new + existing engine tests green; `waitFor()` still covers the drained turn's settle chain (test proves it).
**Verify:** `bun test tests/core/conversation-turns.test.ts --isolate`; full gate at commit.

---

## T2 — `feat(sdk): queue-aware conversation kit`

**Files:** `src/components/conversation/composer.tsx`, `use-conversation-thread.ts`, new `queued-message-list.tsx`, `conversation-panel.tsx`, `packages/sdk/src/components/index.ts`, tests (`tests/components/composer.test.tsx`, `use-conversation-thread.test.tsx`, `conversation-kit.test.tsx`, `conversation-panel.test.tsx`)

1. `Composer`:
   - `queueMode?: boolean`. While `busy`: morph per spec D4 (Stop when empty, queue-send `data-composer-queue` when text/ready-attachments; Enter queues). Instant morph-back after send (state-driven, no async gap).
   - `busy && !onAbort` → disabled spinner button (never a dead Stop); helper copy "Sending…".
   - Helper copy matrix (spec §2): queue+text / queue+empty / non-queue / no-abort.
   - `canSend` drops `!busy` when `queueMode`.
2. `useConversationThread`:
   - Option `queue?: { enabled, startedEvent?, queuedEvent? }`; new state `queued: QueuedRow[]`; `removeQueued(id)` delegating to consumer callback; queue list hydrates from `load()` (new optional `queued` on `ConversationThreadLoad`); refetch queue state on `queued`/`started` events (drain-race coverage).
   - `send()` while streaming with queue enabled: posts; `{ queued: true, queueId }` response → append QueuedRow (optimistic, reconciled by next load). Default path keeps the refusal + existing copy.
3. New `QueuedMessageList` component: user-style bubbles, "Queued" badge, remove × → `onRemoveQueued(item)` (consumer owns restore-to-composer). Export via SDK components index.
4. `ConversationPanel`: plumb opt-in queue props; default off.
5. Tests:
   - Composer: morph states, instant morph-back (steering sequence), Esc-with-text abort, spinner-no-abort, copy matrix. (`rtl-settle` rules apply.)
   - Thread hook: default streaming send still refuses; queue-enabled send posts without touching liveChunks and records queued row; reconcile on queued/started events.
   - QueuedMessageList: render + remove callback payload.
   - ConversationPanel: streaming + queue-enabled allows submit (#732 acceptance); default stays strict.

**Acceptance:** #732 acceptance criteria all pass; no consumer opted in yet — zero behavior change anywhere in the app.
**Verify:** `bun test tests/components/composer.test.tsx tests/components/use-conversation-thread.test.tsx tests/components/conversation-kit.test.tsx tests/components/conversation-panel.test.tsx --isolate`.

---

## T3 — `feat(chat): queued follow-up messages (server + client)`

**Files:** `plugins/chat/lib/store.ts`, `stream-bridge.ts`, `routes.ts`, `index.ts`, `types.ts`, `components/use-chat-data.ts`, `chat-view.tsx`; tests under `tests/plugins/chat/`

1. Store: `readQueue`/`writeQueue` at `chat/queue/<chatId>.json` (zod, serialized writes, atomic); `deleteChat` sweeps the queue file.
2. Bridge: engine config gains `queue: { persist: writeQueue, event: 'chat.queued' }`; export `listQueuedMessages`, `removeQueuedMessage`, `clearQueue`, `restoreQueues(ctx)` (reads queue dir, `restore()`s each chat — called from `activate` AFTER `sweepInterruptedTurns()` so error rows land before drained rows).
3. Routes:
   - `POST /chats/:chatId/messages`: attachment validation unchanged, then `startChatTurn(..., queueIfBusy)`; `'queued'` → `202 { accepted, queued: true, queueId, queueLength }`; 409 branch removed; docstring updated.
   - `GET /chats/:chatId`: `queued: QueuedMessageDto[]`.
   - `DELETE /chats/:chatId/queued/:queueId`: 200/404.
   - `DELETE /chats/:chatId`: + `clearQueue`.
4. Client: `useChatStream` passes queue config (events `chat.started`/`chat.queued`), maps queued attachments to URLs, exposes `queued`/`removeQueued`; `ChatView` renders `QueuedMessageList` above `Composer`, passes `queueMode`, implements restore-to-composer-if-empty on remove (needs a composer draft-set path — restore writes the localStorage draft + focuses; keep it inside ChatView via a small controlled hand-off), sendError only on real failures.
5. Tests (deliberate frozen-suite edits, called out in commit body):
   - `stream.test.ts`/routes: busy POST → 202 queued; GET carries queued; DELETE queued; delete-chat clears queue; boot restore drains (activate-path test); order preserved.
   - `chat-stream-client.test.tsx`: POST during in-flight → queued row renders; reconciles after drain (done → refetch shows user rows + empty queue).
   - `chat-page.test.tsx`: type + queue while streaming; queued attachment stays associated; remove restores text to empty composer.
   - Retry-during-streaming queues (semantics-change pin).

**Acceptance:** #729 acceptance + edge-case list from spec all covered; `tests/integration/pi/chat-on-pi.test.ts` still green (wire contract additive apart from the 409 removal).
**Verify:** `bun test tests/plugins/chat/ --isolate` + integration chat-on-pi; live smoke via /verify skill or dev server: queue 2 messages mid-turn, Stop, watch combined drain; restart server with queued items → boot drain.

---

## T4 — `feat(chat): first-message attachments in draft mode` (#730)

**Files:** `plugins/chat/components/chat-view.tsx` (DraftChatView), `chat-page.tsx` (createAndSend), `use-chat-data.ts`; `tests/plugins/chat/chat-page.test.tsx`

1. DraftChatView: local staging (File + object-URL, status `ready`), attach affordance gated by existing `GET /capabilities?agent=` probe (agentId-only, chat-less), paste/drop/paperclip parity with ChatView.
2. `createAndSend(agentId, content, files)`: create → upload each (`POST /chats/:id/attachments`) → send with refs. Late failure: still navigate into the created chat; error + retry surface there (spec D5). Draft staging clears only after the send POST succeeds.
3. Tests: attach-before-chat-exists → one user row with attachment + one turn (no forced text-only setup turn); upload-fails path keeps chat open with error; capability-gated affordance hidden for text-only agents.

**Acceptance:** #730 acceptance criteria pass.
**Verify:** `bun test tests/plugins/chat/chat-page.test.tsx --isolate`; live: `/chat/new?agent=<image-capable>` paste → send.

---

## T5 — `fix(chat): stale-while-revalidate image-input capability probe` (#731)

**Files:** `plugins/chat/components/use-chat-data.ts` (`useAgentImageInput`); `tests/plugins/chat/chat-page.test.tsx` or a focused hook test

1. Keep Map as instant seed; ALWAYS background re-probe on mount per agentId with in-flight dedup; update Map + state on change; probe failure keeps cached value (first-ever failure stays conservative-false).
2. Tests: cached-true + probe-now-false → affordance hides without reload; probe failure keeps last-known; dedup (rail+view double mount → one fetch).

**Acceptance:** #731 acceptance criteria pass.
**Verify:** targeted tests; live: flip an agent's model, switch chats, watch the paperclip.

---

## T6 — `docs(knowledge): chat queue + conversation kit queue docs`

**Files:** `.claude/knowledge/chat-plugin.md`, `.claude/knowledge/conversation-kit.md`; README.md checked (expected: no impact)

- chat-plugin.md: queue invariant (durable FIFO, combined drain, boot drain, D3 stop semantics, retry change), routes/events/file-map/gotchas updates; frozen-suite note (409 removal is the sanctioned edit).
- conversation-kit.md: engine queue config + `'queued'`, kit queue options, `QueuedMessageList`, composer `queueMode` + busy-states, ConversationPanel opt-in.
- Verify README/docs-site chat references (grep) — update only if actually impacted.

**Verify:** docs read true against the shipped code; `bun run lint` clean.

---

## Checkpoints & gates

- **After each task:** `bun run lint && bun run typecheck && bun run test` (lint is part of the gate — standing rule), then commit (conventional message per ladder; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- **After T3 (feature checkpoint):** live smoke on the dev server — queue/stop/drain/restart-drain flows — before starting T4.
- **After T6:** full suite + lint, push branch, PR referencing all four issues with the wire-contract changes (409 removal, retry semantics) called out; Mark tests live on 3737 before merge (standing rule; 3737 currently has no server running — start from this branch when ready).
- **Rollback:** revert the single offending commit; ladder order guarantees earlier commits stand alone (engine/kit capability is dormant without T3).

## Explicitly out of scope

Queueing for brands/bits surfaces; queue caps; queued-message editing; `foldConversation` changes; new atomic multipart endpoints; any backwards-compat shims.
