# Chat Plugin

The `chat` core plugin is Bakin's day-to-day conversational hub: streamed multi-chat with any agent, built ON the SDK conversation kit (see `.claude/knowledge/conversation-kit.md` — chat is the kit's reference consumer in session-manager mode). It exists so the app has a first-class way to talk to agents that does not depend on any runtime channel layer — a prerequisite for runtimes like Pi that ship none.

Spec/plan for the 2026-07 overhaul: `.claude/specs/chat-conversation-kit.md`, `tasks/plan-chat-conversation-kit.md`.

## Design invariants

- **URL surface (routing overhaul PR2, spec D1/D2 — path = page identity).** `/chat` (list/launcher, `?agent=` = rail filter), `/chat/$chatId` (conversation — host route `packages/host/src/routes/chat.$chatId.tsx` threads the param into the `page:/chat/[chatId]` slot), `/chat/new?agent=<agentId>` (draft composer — there `?agent=` is the DRAFT agent and the rail renders unfiltered). Conversations `push` history (back/forward walks them); draft first-send `replace`s the dead `/chat/new` URL. Every deep-link builder (reply toast, OS notification, ⌘K hit renderer) emits `/chat/<id>`; `attention.ts` `visibleChatIdFromLocation` parses the pathname. The retired `?chat=`/`?draft=` shapes are dead — no redirects by decision.

- **Runtime-agnostic.** Consumed runtime surfaces: `agents.get` (roster validation), `messaging.stream` with the adapter-neutral threadId **`chat:<chatId>`** (+ `MessageArgs.signal` for abort and `attachments` for images), `messaging.send` (`ephemeral: true`, threadId `chat:<chatId>:title`) for auto-titling, and `capabilities({agentId}).input.imageInput` to gate the attach affordance.
- **Transcripts are Bakin-owned UI data — schema v2.** `~/.bakin/chat/index.json` (zod summaries: title/titleSource/pinned/messageCount/unreadCount/lastSeenAt/lastMessageAt+Preview) + `<chatId>.jsonl` (append-only rows: `user (± attachments) | assistant | tool | error | aborted`, agent rows carry `turnId`). Tool rows are STRUCTURED (callId/toolName/status/summary/inputPreview/outputPreview/durationMs/metadata, previews clipped with `metadata.truncated`) so replay folds exactly like live streaming. Legacy v1 rows (`"name: summary"` strings) parse leniently — no migration files. User attachments live under `chat/attachments/<chatId>/` (chat-owned; NEVER auto-imported as assets — assets-D7).
- **One in-flight turn per chat** (202/409); every turn registers an `AbortController` — `POST /chats/:id/abort` cancels the runtime stream (clean `done` per the runtime contract) and persists an `aborted` row.
- **Streaming rides the existing SSE bus.** Server: `chat.chunk` / `chat.done` / `chat.error` / `chat.titled` plugin-events (all carry `agentId`; `done` adds a reply `preview` + `aborted` flag). Client folds durable rows + live chunks through the kit's `foldConversation` — chat owns NO rendering logic, only page chrome.
- **Persistence via the kit's `createTurnRecorder`** (drain-per-chunk so a crash keeps the partial turn; interleaving preserved — text before a tool result flushes as its own row).
- **Attention system.** `ChatBadgeProvider` in the global `nav-badge-providers` slot: nav badge (unread total, working dot while streaming), `(N)` tab-title prefix, click-to-jump toast + generated WebAudio chime + OS notification (via `src/lib/browser-notify`, self-suppressing when focused) when a reply lands while the user is elsewhere. Pure rules in `components/attention.ts`: viewing the chat = no fanfare + mark seen; aborted = silence. Toggles in the plugin `settingsSchema` (toasts/sound, default on). Unread is server-side (`unreadCount`/`lastSeenAt`, cleared by `POST /chats/:id/seen` or a user send).
- **Titles**: first user message titles instantly (`titleSource: 'fallback'`); after the FIRST completed exchange one budget-gated ephemeral LLM call upgrades it (`lib/auto-title.ts` — gate = `dispatchPaused` + `budgetGate`, the dispatch primitives; blocked = silent skip). Precedence user > llm > fallback; renames are never overwritten.
- **Search (S11):** file-backed `chats` content type (`lib/search.ts`) — one doc per chat (title, agent facet, recency-biased user+assistant body, 6k cap; tool noise never indexes). ⌘K hits deep-link `/chat/<id>`.
- **Agents keep their tools.** The turn is a normal runtime turn — `bakin_*` exec tools work mid-chat exactly as in dispatch.

## File map

```
plugins/chat/
  index.ts                       definePlugin shell + settingsSchema + registerChatSearch
  lib/store.ts                   index.json + JSONL v2 store; markSeen/setTitle/setPinned; attachmentsDir
  lib/routes.ts                  CRUD, messages (202/404/409), PATCH rename/pin, seen, abort,
                                 attachments upload/serve (multipart, image/*, 25 MB), GET /capabilities
  lib/stream-bridge.ts           in-flight registry + AbortControllers; kit turn-recorder persistence;
                                 attachment downscale (@bakin/core/media/downscale); waitForTurn() for tests
  lib/auto-title.ts              budget-gated first-exchange titling
  lib/search.ts                  file-backed 'chats' search content type
  components/use-chat-data.ts    useChats/useChatStream (kit rows + live chunks), requests, useAgentImageInput
  components/chat-page.tsx       header (search + Start a chat) + rail + view/draft/launcher; shortcuts
                                 (⌘⇧O new, ⌥↑/⌥↓ switch, ⇧Esc focus); paths /chat, /chat/$chatId, /chat/new?agent=
  components/chat-rail.tsx       Pinned/Today/Yesterday/This week/Older groups, unread pills, working
                                 spinner, FacetFilter, collapsible (persisted), hover pin/delete
  components/chat-view.tsx       kit Conversation + Composer + ToolCallDrawer; inline title edit; retry;
                                 staged attachments (capability-gated); DraftChatView (create on first send)
  components/launcher.tsx        empty-pane launcher: agent cards + recents + skeletons
  components/agent-picker.tsx    'Start a chat' popover (Command list of agents)
  components/chat-badge-provider.tsx  global attention brain (renders null)
  components/attention.ts        pure suppression/badge/title-prefix rules
  components/notification-sound.ts    generated two-tone chime (no asset)
tests/plugins/chat/              store/stream/attachments/auto-title/search/attention/chat-page suites
```

## Gotchas

- `chatId` is validated as a UUID before touching the filesystem (traversal guard); attachment serving allows only immediate children of the chat's attachment dir, and the send route rejects attachment paths outside it.
- Deleting a chat mid-turn is legal: the bridge logs the failed append and keeps streaming to SSE; the attachments dir is swept with the chat.
- `useChatStream` guards every SSE event and fetch against the *active* chat id (`activeChatRef`).
- Draft mode: `?draft=<agentId>` renders a chat-less view; `POST /chats` happens on FIRST send (no `Untitled chat · 0 msg` rows). Attachment staging starts after the chat exists.
- Attachment-only sends get a visible `See the attached image.` placeholder — the transcript shows exactly what the runtime was asked.
- Tests: `waitForTurn(chatId)` is the deterministic settle point — never sleep. Mock `runtime.messaging.stream` with scripted async generators. The auto-title tests mock `src/core/dispatch-turns` (gate decisions), and any test completing a first exchange should expect a titling `send` unless gated.
