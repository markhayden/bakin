# Conversation Kit

THE shared conversation UI **and turn engine** for every surface that talks to an agent. UI lives in `src/components/conversation/`, exported via `@makinbakin/sdk/components` (+ two server helpers via `@makinbakin/sdk/utils`); the server-side turn engine lives in `src/core/conversation-turns.ts` (see below). Replaced `IntegratedBrainstorm` and the three duplicated chunk-folding implementations (2026-07 overhaul; spec `.claude/specs/chat-conversation-kit.md`), then absorbed chat's turn machinery as the ONE engine for all conversational surfaces (#703; spec `tasks/spec-703-conversation-durability.md`).

## The turn engine (#703)

`createConversationTurnService(config)` in `src/core/conversation-turns.ts` — the generalization of chat's stream bridge, consumed by chat, brands, and the bits projects/messaging brainstorms. Server-owned background turns, detached from HTTP requests: send routes return **202** (busy → **409**), chunks stream as consumer-named plugin-events over the shared SSE bus, rows persist incrementally through `createTurnRecorder` (a crash or navigation keeps the partial turn). Delivered as `ctx.conversations` on the plugin context (SDK-typed contract with declarative `metering` — workClass pinned to 'chat', runIds force-namespaced `brainstorm:<pluginId>:`, event names must live in the plugin's namespace for user-source plugins); core plugins may import the module directly. Never an SDK code export — the engine needs crypto/media/logger.

Consumer config: `events` {chunk,done,error} names + `payload(key)` base, `resolveThread(key)` (null → `not_found`), `appendRow(key,row)` (failures logged, never thrown), `threadId(key, agentId)` (per-turn schemes legal), `framing?`, `ephemeral?`, hooks `onChunk` (server-side tap — messaging proposal parsing), `meter` (success+abort, never error), `onSettled` (runs AFTER the slot releases; `waitFor()` covers it). `start(ctx, key, content, opts?)` takes per-turn `agentId` override (agent pickers), `runtimeContent` (embedded prompt assembly — the transcript keeps clean user text), `attachments` (downscale shim in-engine). Load-bearing semantics (synchronous slot reservation/TOCTOU, drain-per-chunk persistence, typed error kinds, abort → clean done + `aborted` row, attachment placeholder) are pinned by `tests/core/conversation-turns.test.ts` AND chat's frozen suite — see the preserved-verbatim list in `tasks/plan-703-conversation-durability.md`.

Client side: `useConversationThread` (below) is the matching hook; `useConversationAttention` + the pure attention rules give every consumer chat-parity badges/notifications.

**The rule:** new chat-like surfaces COMPOSE these components; never hand-roll message/tool rendering or chunk folding. `TurnOutputView` remains only as a thin legacy wrapper for single-turn embeds (task step viewer, workflow step drawer).

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
| `useConversationThread` | THE client hook for engine consumers (#703): synchronous optimistic user echo, bus-event streaming with text-delta coalescing, active-thread guards, settle-by-refetch, optional server-seeded `streaming` rehydration (chat deliberately opts out — no pre-light), chat's failed-send semantics (state rollback, optimistic row stays, `sendError`) |
| `useConversationAttention` | Provider building block for `nav-badge-providers` slots: inflight set from chunk/done/error events, `badgeFor` nav badge, optional `(N)` title prefix, toast/chime/OS fanout via the pure rules |
| `attentionForDone` / `badgeFor` / `withUnreadPrefix` / `visibleIdFromLocation` / `playReplyChime` | Pure attention rules + the reply chime (generalized from chat's S6 matrix; chat's `attention.ts` is a facade over these) |

Server helpers (`@makinbakin/sdk/utils`): `conversationThreadId(scope, entityId, agentId)` and `createTurnRecorder({turnId, agentId?})` — chunks → persistable rows (`ingest`/`drain`/`finish`; drain enables crash-safe incremental persistence; previews clipped at 2000/500 chars with `metadata.truncated`). Chat's stream bridge and the bits plugins' routes share these — ONE implementation of "what survives a turn".

## Transports

- **Plugin-event bus — the ONLY transport:** the turn engine emits consumer-named chunk/done/error plugin-events → global SSE bus → `useConversationThread`. Turns survive navigation because nothing is bound to the component or request; remounts refetch the durable transcript (incl. partial rows) and resume from the next chunk. Custom server-side events (messaging proposals) are emitted from the engine's `onChunk` hook. The per-request SSE path (`useConversationStream`/`readConversationSseStream`) was DELETED in #703 PR 3 — never reintroduce component-bound conversation streaming.

## Related

- `MarkdownContent` (used by text items): rehype-highlight (lowlight common subset) with language label + copy button, lazy images + lightbox portal, `<video>` for video URLs, safe external links.
- Media downscale for attachments: `@bakin/core/media/downscale` (2 MB inline-cap shim shared with assets enrichment); loader `@bakin/core/media/sharp-loader`.
- Consumers: chat plugin (`.claude/knowledge/chat-plugin.md`), bits messaging/projects (external repo), task step viewer + workflow step drawer (via `TurnOutputView` wrapper).
- Testing: kit component suites under `tests/components/` (`conversation-kit`, `activity-group-drawer`, `composer`, `conversation-panel`), fold/stream units under `tests/sdk/`.
