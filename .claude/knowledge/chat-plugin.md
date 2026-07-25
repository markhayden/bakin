# Chat Plugin

The `chat` core plugin is Bakin's day-to-day conversational hub: streamed multi-chat with any agent, built ON the SDK conversation kit (see `.claude/knowledge/conversation-kit.md` — chat is the kit's reference consumer in session-manager mode). It exists so the app has a first-class way to talk to agents that does not depend on any runtime channel layer — a prerequisite for runtimes like Pi that ship none.

Spec/plan for the 2026-07 overhaul: `.claude/specs/chat-conversation-kit.md`, `tasks/plan-chat-conversation-kit.md`.

## Design invariants

- **URL surface (routing overhaul PR2, spec D1/D2 — path = page identity).** `/chat` (list/launcher, `?agent=` = rail filter), `/chat/$chatId` (conversation — host route `packages/host/src/routes/chat.$chatId.tsx` threads the param into the `page:/chat/[chatId]` slot), `/chat/new?agent=<agentId>` (draft composer — there `?agent=` is the DRAFT agent and the rail renders unfiltered). Conversations `push` history (back/forward walks them); draft first-send `replace`s the dead `/chat/new` URL. Every deep-link builder (reply toast, OS notification, ⌘K hit renderer) emits `/chat/<id>`; `attention.ts` `visibleChatIdFromLocation` parses the pathname. The retired `?chat=`/`?draft=` shapes are dead — no redirects by decision.

- **Runtime-agnostic.** Consumed runtime surfaces: `agents.get` (roster validation), `messaging.stream` with the adapter-neutral threadId **`chat:<chatId>`** (+ `MessageArgs.signal` for abort and `attachments` for images), `messaging.send` (`ephemeral: true`, threadId `chat:<chatId>:title`) for auto-titling, and `capabilities({agentId}).input.imageInput` to gate the attach affordance (client cache is stale-while-revalidate, #731: instant seed + background re-probe per mount with in-flight dedup; probe failure keeps last-known, never-probed stays conservative-false).
- **Transcripts are Bakin-owned UI data — schema v2.** `~/.bakin/chat/index.json` (zod summaries: title/titleSource/pinned/messageCount/unreadCount/lastSeenAt/lastMessageAt+Preview) + `<chatId>.jsonl` (append-only rows: `user (± attachments) | assistant | tool | error | aborted`, agent rows carry `turnId`). Tool rows are STRUCTURED (callId/toolName/status/summary/inputPreview/outputPreview/durationMs/metadata, previews clipped with `metadata.truncated`) so replay folds exactly like live streaming. Legacy v1 rows (`"name: summary"` strings) parse leniently — no migration files. User attachments live under `chat/attachments/<chatId>/` (chat-owned; NEVER auto-imported as assets — assets-D7).
- **One in-flight turn per chat, with a durable pending queue (#729 — spec `.claude/specs/chat-queue-and-followups.md`).** A send while a turn streams NEVER 409s (that contract was deliberately retired): it enqueues — `202 { queued: true, queueId, queueLength }` after the same attachment path validation — and the queue drains as **ONE combined turn** when the active turn settles (done, error, AND abort all drain; **Stop-then-drain IS the steering flow**: queue the correction, hit Stop, the correction fires). Each queued message persists as its own user row at drain time; runtime content is the joined messages, attachments merged, one turnId/meter. Queue snapshots live at `chat/queue/<chatId>.json`; **boot restores + auto-drains them AFTER `sweepInterruptedTurns`** (error rows land before drained rows — a boot can legitimately start an LLM turn); the drain persists-empty AFTER appending rows, so a crash mid-drain re-drains at boot (at-least-once: visible duplicate over silent loss). `GET /chats/:id` carries `queued[]`; `DELETE /chats/:id/queued/:queueId` removes one (the client restores its text into an EMPTY composer — spec D8); delete-chat aborts + clears the queue in the same sync block + sweeps the file. Enqueues announce as `chat.queued`. Every turn registers an `AbortController` — `POST /chats/:id/abort` cancels the runtime stream (clean `done` per the runtime contract) and persists an `aborted` row; queued messages survive the abort and drain.
- **Streaming rides the existing SSE bus.** Server: `chat.chunk` / `chat.done` / `chat.error` / `chat.titled` plugin-events (all carry `agentId`; `done` adds a reply `preview` + `aborted` flag). Client folds durable rows + live chunks through the kit's `foldConversation` — chat owns NO rendering logic, only page chrome.
- **Persistence via the kit's `createTurnRecorder`** (drain-per-chunk so a crash keeps the partial turn; interleaving preserved — text before a tool result flushes as its own row).
- **Attention system.** `ChatBadgeProvider` in the global `nav-badge-providers` slot: nav badge (unread total, working dot while streaming), `(N)` tab-title prefix, click-to-jump toast + generated WebAudio chime + OS notification (via `src/lib/browser-notify`, self-suppressing when focused) when a reply lands while the user is elsewhere. Pure rules in `components/attention.ts`: viewing the chat = no fanfare + mark seen; aborted = silence. Toggles in the plugin `settingsSchema` (toasts/sound, default on). Unread is server-side (`unreadCount`/`lastSeenAt`, cleared by `POST /chats/:id/seen` or a user send).
- **Every chat turn is metered.** Interactive turns bill under work class `'chat'` (the matrix's single metered-only class — model choice stays with the operator, never routed): `meterAgentTurn` with runId `chat:<chatId>:turn:<uuid>`, usage taken from the stream's `done` chunk (`ChatChunk done.usage` — conformance-pinned parity with `send()`). Aborted turns bill their partial usage — the tokens were consumed. Never throws into the turn path.
- **Titles**: first user message titles instantly (`titleSource: 'fallback'`); after the FIRST completed exchange one budget-gated ephemeral LLM call upgrades it (`lib/auto-title.ts` — gate = `dispatchPaused` + `budgetGate`, the dispatch primitives; blocked = silent skip). The call is ROUTABLE via the `'auto-title'` system work class (`resolveSystemRoute` — recommended-tier cheap) and metered under runId `chat:<chatId>:title` (the durable prefix the ledger's v8 backfill recognizes). Precedence user > llm > fallback; renames are never overwritten.
- **Search (S11):** file-backed `chats` content type (`lib/search.ts`) — one doc per chat (title, agent facet, recency-biased user+assistant body, 6k cap; tool noise never indexes). ⌘K hits deep-link `/chat/<id>`.
- **Agents keep their tools.** The turn is a normal runtime turn — `bakin_*` exec tools work mid-chat exactly as in dispatch.

## File map

```
plugins/chat/
  index.ts                       definePlugin shell + settingsSchema + registerChatSearch
  lib/store.ts                   index.json + JSONL v2 store; markSeen/setTitle/setPinned; attachmentsDir;
                                 queue snapshots (readQueue/writeQueue/listQueuedChatIds, chat/queue/<id>.json)
  lib/routes.ts                  CRUD, messages (202; busy → 202 queued, #729), PATCH rename/pin, seen, abort,
                                 DELETE queued/:queueId, attachments upload/serve (multipart, image/*, 25 MB),
                                 GET /capabilities
  lib/stream-bridge.ts           chat's consumer config over the shared conversation turn engine
                                 (src/core/conversation-turns.ts, extracted FROM this module in #703);
                                 chat-side policy: CHAT_TURN_FRAMING, per-turn metering (work class
                                 'chat'), post-release auto-title, ambiguity-null
                                 resolveActiveTurnForAgent, queue wiring (persist→writeQueue,
                                 chat.queued event, restoreQueues boot drain); waitForTurn() for tests
  lib/auto-title.ts              budget-gated, 'auto-title'-routed + metered first-exchange titling
  lib/search.ts                  file-backed 'chats' search content type
  components/use-chat-data.ts    useChats + useChatStream (thin wrapper over the kit's
                                 useConversationThread since #703 — chat keeps seen tracking,
                                 retry-with-attachments, URL mapping, no streaming pre-light),
                                 requests, useAgentImageInput
  components/chat-page.tsx       header (search + Start a chat) + rail + view/draft/launcher; shortcuts
                                 (⌘⇧O new, ⌥↑/⌥↓ switch, ⇧Esc focus); paths /chat, /chat/$chatId, /chat/new?agent=
  components/chat-rail.tsx       Pinned/Today/Yesterday/This week/Older groups, unread pills, working
                                 spinner, FacetFilter, collapsible (persisted), hover pin/delete
  components/chat-view.tsx       kit Conversation + Composer (queueMode) + QueuedMessageList +
                                 ToolCallDrawer; inline title edit; retry; staged attachments
                                 (capability-gated); queue-remove restore-to-empty-composer (D8);
                                 DraftChatView (create on first send; LOCAL file staging — upload
                                 happens inside createAndSend after creation, #730)
  components/launcher.tsx        empty-pane launcher: agent cards + recents + skeletons
  components/agent-picker.tsx    'Start a chat' popover (Command list of agents)
  components/chat-badge-provider.tsx  chat wiring over the kit's useConversationAttention (renders null)
  components/attention.ts        facade over the kit's shared attention rules (chatId-shaped signatures)
tests/plugins/chat/              store/stream/queue/attachments/auto-title/search/attention/chat-page
                                 suites + chat-stream-client (the #703 client characterization gate);
                                 this directory + tests/integration/pi/chat-on-pi.test.ts are the
                                 FROZEN behavior gate for any engine/kit refactor — edit means
                                 regression (the ONE sanctioned edit so far: #729 retired the busy-409
                                 pin in stream.test.ts; queue.test.ts owns the queue contract)
```

## Gotchas

- `chatId` is validated as a UUID before touching the filesystem (traversal guard); attachment serving allows only immediate children of the chat's attachment dir, and the send route rejects attachment paths outside it.
- Deleting a chat mid-turn is legal: the bridge logs the failed append and keeps streaming to SSE; the attachments dir is swept with the chat.
- `useChatStream` guards every SSE event and fetch against the *active* chat id (`activeChatRef`).
- Draft mode: `?draft=<agentId>` renders a chat-less view; `POST /chats` happens on FIRST send (no `Untitled chat · 0 msg` rows). Attachment staging starts after the chat exists.
- Attachment-only sends get a visible `See the attached image.` placeholder — the transcript shows exactly what the runtime was asked.
- Queue gotchas (#729): "Try again" during a streaming turn now QUEUES the retried message (it used to error) — after an error settle the drain fires immediately, so a Try-again click during the drained turn queues a visible, removable duplicate. The rail's `lastMessagePreview` doesn't reflect queued items until drain persists them as user rows. Boot auto-drain ends with the normal attention fanout — that's how the operator learns queued instructions were processed after a restart. Queued attachments keep `path` alongside the display `url` (the optimisticRow/DTO spreads) so remove-restore can re-stage them. A corrupt queue snapshot quarantines as `.corrupt` (never re-erroring every boot). Queue-remove restore requires an empty composer — no text AND no staged attachments (never surprise-merges). Dev demo: send `[[slow]]` on `bun run dev:mock` — word-by-word ~15s streaming built for showcasing queue/Stop/drain (see `.claude/knowledge/dev-loop.md`).
- Tests: `waitForTurn(chatId)` is the deterministic settle point — never sleep; with queued items the drain reserves a NEW slot synchronously at release, so settle loops call `waitForTurn` until `isTurnInFlight` is false. Mock `runtime.messaging.stream` with scripted async generators. The auto-title tests mock `src/core/dispatch-turns` (gate decisions), and any test completing a first exchange should expect a titling `send` unless gated.
