# Chat Queue & Follow-ups — Spec

**Issues:** #729 (chat server queue) + #732 (kit queue-awareness) — one feature, two layers — plus #730 (draft first-message attachments) and #731 (capability cache staleness).

**Priority:** reduce tech debt. Single-user box; NO backwards-compatibility shims. Intentional wire-contract changes are made outright and documented.

## Objective

Let the operator submit follow-up messages while a chat turn is streaming. Messages queue server-side (durable), preserve one-turn-at-a-time semantics, and drain as ONE combined turn when the active turn settles. Fix the composer's dishonest "send waits" copy. Additionally: attach images to the first draft message, and stop the image-capability probe from going stale.

## Decisions (interview log, 2026-07-25)

| # | Decision | Choice |
|---|---|---|
| D1 | Drain granularity | **Combine all queued messages into ONE turn** — each persists as its own user row; runtime content is the joined messages; attachments merged. One reply addresses everything; no N sequential billed turns. |
| D2 | Restart durability | **Persist + auto-drain at boot.** Queue persists per-chat (sidecar file, never transcript rows). At boot, after the interrupted-turn sweep, chats with queued items start a drain turn. No limbo state, no stranded-queue UI. |
| D3 | Stop semantics | **Stop aborts the active turn; the queue then drains.** This IS the steering flow (queue correction → Stop → correction fires). Fully-silent stop = remove queued items first, then Stop. |
| D4 | Composer affordance | **Single morphing button** while streaming: Stop when the composer is empty, queue-send when text/attachments present. **Esc remains the always-available abort** (already wired); helper copy states it. **The steering sequence is: Enter (queues, composer clears) → button instantly morphs back to Stop → click Stop → drain fires the correction.** The instant morph-back is load-bearing UX, pinned by a composer test. |
| D5 | Draft attachments (#730) | **Client orchestration.** Draft stages files locally (object URLs, no upload until send); first send = create chat → upload staged files → send with refs. No new server endpoint. Late-step failure leaves the created chat open with error + retry. |
| D6 | Capability cache (#731) | **Stale-while-revalidate.** Cache seeds instantly; every chat-view mount re-probes in the background and updates. Revalidation failure keeps last-known; first-ever probe failure stays conservative-false. |
| D7 | Delivery | **One branch/PR, per-issue commit ladder** (each commit builds green, independently revertable). Live test on 3737 before merge (standing rule). |
| D8 | Queue management | Per-item remove **×** on queued rows + `DELETE /chats/:chatId/queued/:queueId`. No in-place editing; instead, **× restores the removed message's text (and attachment refs) into the composer when the composer is empty** (Claude Code interrupt precedent); with composer text present, × discards. No queue cap (single user; documented). |
| D9 | Scope of queueing | Engine + kit grow the capability; **only chat opts in**. Brands/bits brainstorms keep strict busy semantics; `ctx.conversations` change is additive (new union member + opt-in option) — bits plugins unaffected until they opt in. |

## Design

### 1. Engine — `src/core/conversation-turns.ts` (#729)

- `StartTurnResult` gains `'queued'`. `StartTurnOptions` gains `queueIfBusy?: boolean`.
- `start()` with `queueIfBusy` and an occupied slot **synchronously** enqueues (after the `resolveThread` await, the busy-check + enqueue happen in one sync block — no TOCTOU) and returns `'queued'`.
- `QueuedMessage`: `{ id: string (uuid), ts: string, content: string, attachments?: TurnAttachment[] }`.
- New config member:
  ```ts
  queue?: {
    /** Full-snapshot persistence after every queue mutation. */
    persist?: (key: string, items: QueuedMessage[]) => void | Promise<void>
    /** Optional bus event emitted on enqueue (e.g. 'chat.queued'); payload + queueId + queueLength. */
    event?: string
  }
  ```
- New service methods:
  - `listQueued(key): QueuedMessage[]`
  - `removeQueued(key, id): boolean` (persists)
  - `restore(ctx, key, items): void` — seed the queue (boot path) and drain if idle
  - `clearQueue(key): void` — delete-chat path
- **Drain:** chained after slot release (`.finally`). If the queue is non-empty and the slot is free: dequeue ALL items, persist the now-empty queue, append each as its own durable `user` row (at drain time — transcript stays append-only and ordered after the settled turn's rows), then run ONE runtime turn whose content is the messages joined with `\n\n` and whose attachments are the merged set. One turnId, one metering call, normal framing. Drain-time `resolveThread` failure (chat deleted) drops the queue silently — delete already clears it.
- **Abort:** unchanged — aborts the active turn only; the settle path drains (D3).
- `resolveActiveTurnForAgent` / `listInFlight` unchanged: queued items are never in-flight.
- `inflight` drain ordering vs events: `done` is emitted inside `runTurn`, the slot releases in `.finally`, drain chains after — so clients always see `done` before the drained turn's `started`.

### 2. Conversation kit (client) — `src/components/conversation/` (#732)

- **`useConversationThread`** gains:
  - option `queue?: { enabled: boolean; startedEvent?: string; queuedEvent?: string }` (chat passes `chat.started`/`chat.queued`).
  - When enabled: `send()` while streaming does NOT refuse — it posts; a `{ queued: true }` response adds the message to new state `queued: QueuedRow[]` (id, ts, content, attachment previews) instead of touching `messages`/`liveChunks`.
  - `removeQueued(id)` callback plumbed to the consumer's DELETE.
  - Queue state reconciles from `load()` (server `queued` list on GET), and refetches on the `queued`/`started` events (covers other tabs + the drain race where a done-triggered GET still shows queued items).
  - Default (no `queue`) keeps today's refusal with the existing error copy.
- **`Composer`**:
  - New prop `queueMode?: boolean`. While `busy`:
    - `queueMode && (hasText || readyAttachments)` → morphed send button (queue styling, `data-composer-queue`, label "Queue (Enter)"); Enter queues.
    - otherwise → Stop button (unchanged).
  - Honest helper copy: queue surfaces with text — "Replying — Enter queues your message; Esc stops the reply."; queue surfaces empty — "Replying — type to queue a follow-up; Esc stops the reply."; non-queue surfaces — "Replying — wait for the reply to finish, or stop it."
  - `canSend` drops `!busy` when `queueMode`.
  - **Busy without `onAbort`** (draft mode's create/upload/send window): render a disabled spinner button, never a dead Stop; helper copy "Sending…". Fixes an existing flaw where draft mode shows a Stop button that does nothing.
- **New kit component `QueuedMessageList`**: user-style bubbles with a subtle "Queued" badge and remove ×, rendered by consumers between `Conversation` and `Composer` (NOT via `foldConversation` — queued items must render below the live turn, and fold's turn model stays untouched). Remove restores text + attachment refs into the composer when it's empty (D8) — the kit exposes the removed message to the consumer's `onRemoveQueued(item)` so the surface owns the restore.
- **`ConversationPanel`**: plumbs an opt-in queue prop; default off (embedded surfaces keep strict semantics — #732 acceptance).

### 3. Chat plugin server (#729)

- **Store** (`plugins/chat/lib/store.ts`): queue snapshots at `~/.bakin/chat/queue/<chatId>.json` (zod-validated). `deleteChat` sweeps it. New `readQueue`/`writeQueue` helpers ride the existing serialized-write queue.
- **Stream bridge**: passes `queue: { persist, event: 'chat.queued' }` to the engine; exports `listQueuedMessages`, `removeQueuedMessage`, `restoreQueues` (boot), `clearQueue`.
- **Boot** (plugin `activate`): after `sweepInterruptedTurns()`, load all persisted queues and `restore()` each — non-empty queues auto-drain (D2).
- **Routes** (`plugins/chat/lib/routes.ts`):
  - `POST /chats/:chatId/messages`: attachment validation unchanged and BEFORE enqueue; calls `startChatTurn(..., { queueIfBusy: true })`. `'queued'` → `202 { accepted: true, queued: true, queueId, queueLength }`. The 409 branch is GONE for chat (docstring updated).
  - `GET /chats/:chatId`: adds `queued: QueuedMessageDto[]` (id, ts, content, attachments).
  - `DELETE /chats/:chatId/queued/:queueId`: 200 `{ removed: true }` / 404.
  - `DELETE /chats/:chatId` (chat delete): abort active + `clearQueue` + files (existing sweep covers the dir).
- **Events**: `chat.queued { chatId, queueId, queueLength }` on enqueue. `chat.started` fires per drained turn (existing). No attention changes — queued items never light the working dot.

### 4. Chat plugin client (#729/#732)

- `useChatStream`: passes `queue` config to the kit hook; exposes `queued` + `removeQueued`; maps queued attachments to served URLs.
- `ChatView`: renders `QueuedMessageList` between Conversation and Composer; passes `queueMode` to Composer; `sendError` shows only for real failures (a queued 202 is success).
- Attachment staging: staged items clear only after the send/enqueue POST succeeds; restored on failure.

### 5. Draft first-message attachments (#730)

- `DraftChatView`: local staging (File + object-URL preview, status `ready` immediately — no upload chips in draft); attach affordance gated by the existing `GET /capabilities?agent=` probe (works chat-less).
- `createAndSend` (chat-page) becomes create → upload each staged file (`POST /chats/:id/attachments`) → send with refs. Any late-step failure: navigate into the created chat and surface the error there with retry (uploaded files persist — attachment policy unchanged, never auto-assets).

### 6. Capability cache (#731)

- `useAgentImageInput`: keep the module Map as instant seed; ALWAYS fire a background re-probe on mount (per agentId); update Map + state when the answer changes. Probe failure: keep cached value if present, else conservative-false. In-flight probe dedup per agentId (no probe storms from rail + view mounting together).

## Edge cases (pinned by tests)

- Multiple queued messages: FIFO order in rows and joined content.
- Queued attachments: path-validated at POST time (before enqueue); files live in the chat's attachment dir → stable until sent; delete-chat clears queue file + attachment dir.
- Abort with queued items: active turn gets `aborted` row; drain fires; combined turn runs.
- Error settle with queued items: drain fires the same way (error rows don't strand the queue).
- Restart: interrupted active turn → honest error row (existing sweep); persisted queue restores and auto-drains.
- Drain finds chat deleted → queue dropped, no throw.
- `chat.resolveActiveTurn` binds only the active (drained) turn — combined turn has one turnId; billed-call idempotency scoped to it.
- Send on an idle chat is byte-for-byte today's path (`queueIfBusy` with a free slot = normal accept).
- Draining user rows reset `unreadCount`/stamp `lastSeenAt` via the existing `appendTranscriptRow` semantics — acceptable (documented) since the operator authored them.
- **Retry semantics change (documented):** "Try again" during a streaming turn now queues the retried message instead of erroring with "A reply is already in progress". After an error settles with items queued, the drain fires immediately — a Try-again click during that drained turn queues a duplicate; acceptable (user-triggered, visible in the queue strip, removable).

## Accepted UX notes (known behavior, not bugs)

- The rail's `lastMessagePreview`/list state doesn't reflect queued items until drain persists them as user rows.
- Boot auto-drain ends with the normal attention fanout (toast/chime/OS notification) — intended: it's how the operator learns their queued instructions were processed after a restart.
- #731 staleness stays bounded to the currently-mounted view: changing a model while sitting in an open chat revalidates on the next mount/switch, not live.

## Testing strategy

- `tests/core/conversation-turns.test.ts`: queueIfBusy accepts during inflight; FIFO combined drain after done/error/abort; per-row persistence order; restore-and-drain; removeQueued; clearQueue; persist called on every mutation; deleted-thread drain drop.
- `tests/components/use-conversation-thread.test.tsx`: default still refuses streaming sends; queue-enabled send posts and records queued row without touching live chunks; reconciliation on started/queued events.
- `tests/components/composer.test.tsx`: morphing button states incl. instant morph-back after queueing (the steering sequence); Esc abort with text present; busy-without-onAbort spinner (no dead Stop); honest copy in all modes.
- `tests/components/conversation-kit.test.tsx` (or new): `QueuedMessageList` render + remove; remove restores text to an empty composer, discards when composer has text.
- `tests/plugins/chat/chat-stream-client.test.tsx`: POST during in-flight → 202 queued; UI reconciles after drain.
- `tests/plugins/chat/` server suites: routes (202/queued/DELETE queued/GET queued), store queue persistence, boot restore-drain, delete-chat clearing.
- `tests/plugins/chat/chat-page.test.tsx`: draft staging + createAndSend orchestration (#730); capability revalidation (#731).
- The chat suites are a FROZEN behavior gate — edits here are the deliberate, documented wire-contract change (409 removal), called out in the PR.

## Commit strategy (rollback ladder — each commit builds green + tests pass)

1. `feat(conversations): engine pending queue with combined drain` — engine + engine tests. Revert = whole feature off, zero consumer impact.
2. `feat(sdk): queue-aware conversation kit (composer, thread hook, queued list)` — kit + kit tests; no consumer opts in yet.
3. `feat(chat): queued follow-up messages (server + client wiring)` — store/bridge/routes/boot + chat UI + chat tests. Revert = chat back to 409, engine/kit capability stays dormant.
4. `feat(chat): first-message attachments in draft mode` — #730.
5. `fix(chat): stale-while-revalidate image-input capability probe` — #731.
6. `docs(knowledge): chat queue + conversation kit queue docs` — knowledge updates.

## Docs impact

- `.claude/knowledge/chat-plugin.md`: queue invariant (one-in-flight + durable FIFO queue, combined drain, boot drain, D3 stop semantics), new routes/events, file map (queue dir), gotchas.
- `.claude/knowledge/conversation-kit.md`: engine queue config + `'queued'` result, kit queue options, `QueuedMessageList`, composer `queueMode`.
- `README.md`: not impacted (no chat-level detail there) — verified during build.
- Issue #729/#730/#731/#732 closed by the PR.

## Boundaries

- **Always:** typing never blocked; honest UI copy; queue never violates one-turn-at-a-time; queued items never auto-become assets; attachment path validation before enqueue.
- **Never:** parallel turn execution; queue rows in the transcript before drain; per-request streaming; editing published wire semantics silently (all changes land in knowledge docs + PR description).
- **Out of scope:** enabling queueing for brands/bits surfaces; queue caps; queued-message editing; cross-chat queue views.
