# Conversation Kit

THE shared conversation UI for every surface that talks to an agent. The
private implementation lives in `packages/ui/src/conversation/` and is
published through `@makinbakin/sdk/conversation` (+ two server helpers via
`@makinbakin/sdk/utils`). Existing `/components` imports are migration-only.
The kit replaced `IntegratedBrainstorm` and the three duplicated chunk-folding
implementations (2026-07 overhaul; spec
`.claude/specs/chat-conversation-kit.md`).

**The rule:** new chat-like surfaces COMPOSE these components; never hand-roll
message/tool rendering or chunk folding. `TurnOutputView` is the supported
compact single-turn composition for task and workflow embeds.

## Two consumption modes

1. **Session-manager** (chat plugin): user creates/navigates many conversations. The rail/launcher/session chrome lives in the chat plugin — promote it to the SDK only when a second session-manager surface appears.
2. **Embedded single-session** (`ConversationPanel`): ONE thread inside a host page — brainstorms, plan reviews (the bits messaging/projects plugins). No session navigation. API contract extracted from the real consumers: `messages`/`liveChunks`/`streaming`, `onSend`, `onAgentChange` (agent-switcher slot), `transformText → {text, extras}` (proposal stripping), `readOnly`/`readOnlyNotice`, `fitParent`/`showHeader`, internal `ToolCallDrawer`. Collapsible mode was deliberately dropped — no real consumer used it.

## The turn model (fold.ts)

`foldConversation(messages: ConversationMessage[], {liveChunks, liveAgentId}?) → ConversationTurn[]` — pure, exhaustively tested (`tests/sdk/conversation-fold.test.ts`).

- `ConversationMessage` — the storable row union (`user ± attachments | assistant | tool | error | aborted`, agent rows carry `turnId` + optional `agentId`). Chat's transcript v2 IS this shape; embedded surfaces map their storage onto it.
- Item ORDER inside a turn is preserved (text/activity interleave in arrival order); consecutive tool chunks group into ONE activity item; call/result pairing by `callId` works ACROSS group boundaries; callId-less results close the most recent running same-tool call; orphan results settle standalone.
- Turn status: `streaming | complete | error | aborted` + `statusLabel` (latest runtime status while streaming). The stream itself never signals abort (clean `done` per the runtime contract) — `aborted` comes from persisted rows.

## Components

| Export | Role |
|---|---|
| `Conversation` | Scroll container: stick-to-bottom, jump pill, day separators, hover timestamps |
| `AgentTurn` | Avatar ALWAYS present (incl. thinking), name header, items in order, error footer + `onRetry`, aborted notice, copy |
| `UserMessage` | Right-aligned contrast-safe bubble, attachment thumbnails, copy |
| `ActivityGroup` | Collapsed header (`humanizeActivity`: 'Searched the web · 3 calls · 12s', spinner live, failed marker) → inline rows → `onOpenCall` |
| `ToolCallDrawer` | BakinDrawer: status/duration/callId + pretty-printed copyable input/output/metadata (+ honest truncated marker) |
| `Composer` | Auto-grow + drag-resize (handle raises min height), Enter/Shift+Enter/Esc, IME guard, typing NEVER blocked while busy (send waits + stop button), autofocus, per-thread drafts + ↑/↓ history (localStorage via `storageKey`), attachment affordance (paperclip/paste/drop, capability-gated with honest disabled tooltip), char counter, `leadingSlot` |
| `ConversationPanel` | The embedded mode (above) |
| `ThinkingIndicator` / `ConversationEmptyState` | Standalone avatar+shimmer; designed empty state with suggestion chips |
| `useConversationStream` | Per-request SSE state machine (embedded surfaces): send/abort, liveChunks, errors stay visible as a trailing error item |
| `readConversationSseStream` | SSE frame reader — `chunk` (RuntimeChatChunk JSON) / `done` / `error`, everything else → `onCustom` (the messaging `proposal` bridge) |

Server helpers (`@makinbakin/sdk/utils`): `conversationThreadId(scope, entityId, agentId)` and `createTurnRecorder({turnId, agentId?})` — chunks → persistable rows (`ingest`/`drain`/`finish`; drain enables crash-safe incremental persistence; previews clipped at 2000/500 chars with `metadata.truncated`). Chat's stream bridge and the bits plugins' routes share these — ONE implementation of "what survives a turn".

## Transports

- **Plugin-event bus** (chat): server re-emits chunks as plugin-events; client accumulates and passes `liveChunks` to `foldConversation`. No kit transport involved.
- **Per-request SSE** (embedded): plugin route streams `event: chunk` frames; client uses `useConversationStream`. Custom events (e.g. `proposal`) dispatch through `onCustom`.

## Related

- `MarkdownContent` (used by text items): rehype-highlight (lowlight common subset) with language label + copy button, lazy images + lightbox portal, `<video>` for video URLs, safe external links.
- Media downscale for attachments: `@bakin/core/media/downscale` (2 MB inline-cap shim shared with assets enrichment); loader `@bakin/core/media/sharp-loader`.
- Consumers: chat plugin (`.claude/knowledge/chat-plugin.md`), bits messaging/projects (external repo), task step viewer + workflow step drawer (via `TurnOutputView` wrapper).
- Testing: kit component suites under `tests/components/` (`conversation-kit`, `activity-group-drawer`, `composer`, `conversation-panel`), fold/stream units under `tests/sdk/`.
