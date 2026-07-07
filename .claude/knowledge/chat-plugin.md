# Chat Plugin

The `chat` core plugin (#12) is Bakin's in-app conversational surface: streamed multi-chat with any agent from the dashboard. It exists so the app has a first-class way to talk to agents that does not depend on any runtime channel layer (Discord/Slack) — a prerequisite for runtimes like Pi that ship none (see `.claude/specs/adapter-pi/SPEC.md`, decision D3/D4).

## Design invariants

- **Runtime-agnostic.** The only runtime surface consumed is `ctx.runtime.agents.get` (roster validation) and `ctx.runtime.messaging.stream` with the adapter-neutral threadId **`chat:<chatId>`**. Any adapter that implements `messaging.stream` gets chat for free.
- **Transcripts are Bakin-owned UI data.** `~/.bakin/chat/index.json` (zod-validated summaries) + `~/.bakin/chat/<chatId>.jsonl` (append-only rows: `user | assistant | tool | error`). The provider-side session (reached via threadId) remains the runtime's source of truth; the plugin persists the chunks it streamed, never re-reads provider files. Paths via `getBakinPaths().chat`.
- **One in-flight turn per chat.** `POST /chats/:chatId/messages` returns **202** immediately (409 if busy); the turn runs server-side and streams to every open browser.
- **Streaming rides the existing SSE bus** — no per-request streaming. Server: `ctx.events.emit('chat.chunk' | 'chat.done' | 'chat.error', …)` → global `/api/events`. Client: `usePluginEvent` (the shell's single EventSource fan-out).
- **Durability rules:** completed tool calls persist as one row (`"name: summary"`); assistant text persists once, aggregated, at turn end; a mid-stream failure keeps partial text and appends an honest `error` row. `call`-phase tool chips are SSE-ephemeral by design.
- **Agents keep their tools.** The turn is a normal runtime turn — `bakin_*` exec tools (create tasks, save assets, …) work mid-chat exactly as in dispatch.

## File map

```
plugins/chat/
  index.ts                    definePlugin shell (routes from lib/routes.ts)
  lib/store.ts                index.json + JSONL store; atomic serialized index writes
  lib/routes.ts               chat CRUD + POST /chats/:chatId/messages (202/404/409)
  lib/stream-bridge.ts        in-flight registry; stream → persist + emit; waitForTurn() for tests
  components/use-chat-data.ts useChats / useChatStream (live text + tool chips over durable rows)
  components/chat-page.tsx    two-pane layout; URL state ?chat= & ?agent=
  components/chat-list.tsx    rail: AgentSelect new-chat, filter, delete confirm
  components/chat-view.tsx    transcript + live overlay; MarkdownContent for assistant rows
  components/composer.tsx     Enter-to-send textarea
tests/plugins/chat/           store.test.ts (CRUD), stream.test.ts (bridge: happy/error/busy)
```

## Gotchas

- The first user message titles an untitled chat (60-char cap) — done in `appendTranscriptRow`, not the route.
- `chatId` is validated as a UUID before touching the filesystem (path-traversal guard in `transcriptPath`).
- Deleting a chat mid-turn is legal: the bridge logs the failed append and keeps streaming to SSE; nothing durable is written after deletion.
- `useChatStream` guards every SSE event and fetch against the *active* chat id (`activeChatRef`) so switching chats mid-stream can't cross-pollinate transcripts.
- Tests: `waitForTurn(chatId)` is the deterministic settle point — never sleep. Mock `runtime.messaging.stream` with scripted async generators (see `tests/plugins/chat/stream.test.ts`).
