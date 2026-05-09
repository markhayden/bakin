# Spec — IntegratedBrainstorm

A unified, protocol-agnostic agent-chat component in `@bakin/sdk/components`, replacing the two existing brainstorm surfaces in the projects and messaging plugins.

## Problem

Bakin has two separate brainstorm chat implementations today, neither of which share code:

- `plugins/projects/components/project-detail.tsx` (bottom panel, lines 646+) — synchronous JSON reply, collapsible, markdown-rendered, textarea with broken native `resize-y` grip.
- `plugins/messaging/components/session-chat.tsx` — full-pane split layout, SSE token stream with inline `json` proposal blocks, plain-text rendering, `<AgentAvatar>` + agent-colored border, manual input-pane drag handle.

Plus `plugins/messaging/components/brainstorm-panel.tsx` is dead code (not imported anywhere).

The divergence created drift (protocol, rendering, layout) and a recurring resize bug in projects. The goal is **one component** every agent-chat surface uses.

## Objective

Ship a production-grade `<IntegratedBrainstorm>` component in `@bakin/sdk/components` that both plugins consume. Migrate the projects `/ask` endpoint from JSON to SSE. Delete the dead `brainstorm-panel.tsx`. No shims, no back-compat wrappers — the sole user is the author on one machine.

## Target users

- **Plugin authors** (today: the bakin author + any future SDK consumer). Get a drop-in chat component that handles conversation UI, streaming, keyboard, resize, collapse — they just provide an `onSend` transport and optional customization.
- **End users** (today: one person). See consistent chat UX across the app.

## Scope

### In scope

1. `<IntegratedBrainstorm>` component in `packages/sdk/src/components/integrated-brainstorm/`.
2. Projects migration: `project-detail.tsx` bottom panel uses the component. Backend `/ask` route becomes SSE.
3. Messaging migration: `session-chat.tsx` refactored to use the component; existing SSE route is unchanged, its parser is adapted into the new `onSend` shape.
4. Delete `plugins/messaging/components/brainstorm-panel.tsx`.
5. Unit tests for the component covering render states, keyboard, resize, collapse, readOnly, auto-scroll, abort.
6. End-to-end smoke verification in both plugins (streaming reply lands, collapse survives reload, abort actually stops a stream).

### Out of scope

- Non-bottom positions (`position="top" | "side"`) — prop is reserved but only `"bottom"` is supported.
- Up-arrow message recall, slash-commands, file attachments (handled outside the component in the plugin's own chrome).
- Proposal / suggestion / action card UI — those render in plugin-owned panels (projects right rail, messaging review panel) and consume side-channel events via `onCustom`.
- Multi-agent chat (one agent per session, picker switches agents between messages).
- Auto-resize on type for textarea **beyond** a capped max height (a single cap is in scope; unlimited growth is not).
- Moving the component to its own npm package outside `@bakin/sdk`.

## Component API

### Props

```ts
interface IntegratedBrainstormProps {
  // ── Conversation state ───────────────────────────────────────
  /** Controlled message list. Component does not own this. */
  messages: BrainstormMessage[]
  /** Called whenever the component wants to append or mutate messages. */
  onMessagesChange: (next: BrainstormMessage[]) => void

  // ── Transport (required) ─────────────────────────────────────
  /**
   * Send a prompt. Caller owns the SSE transport; component owns UI state.
   * `onToken` — stream partial assistant text as it arrives.
   * `onCustom` — forward non-text domain events (e.g. proposals) to plugin.
   * Return resolves with the final accumulated assistant content.
   * Must honor `signal` for user-initiated abort (Esc key).
   */
  onSend: (
    prompt: string,
    history: BrainstormMessage[],
    ctx: {
      signal: AbortSignal
      onToken: (text: string) => void
      onCustom?: (name: string, data: unknown) => void
    },
  ) => Promise<{ content: string }>

  // ── Agent ────────────────────────────────────────────────────
  /** Agent currently bound to the chat. Required — drives avatar, name, color. */
  agentId: string
  /** If provided, component renders an AgentSelect picker in the input row. */
  onAgentChange?: (agentId: string) => void

  // ── Chrome & copy ────────────────────────────────────────────
  /** Title shown in collapsed header. Default: "Brainstorm". */
  label?: string
  /** Icon shown in collapsed header. Default: lucide Sparkles. */
  icon?: LucideIcon
  /** Placeholder for the textarea. Default: `Ask ${agentName}…`. */
  placeholder?: string
  /** Rich empty-state. Default: avatar + `Brainstorm with ${agentName}`. */
  emptyState?: ReactNode

  // ── Layout ───────────────────────────────────────────────────
  /** Only "bottom" supported today. Reserved for future expansion. */
  position?: 'bottom'
  /** Whether the collapse chevron is shown. Default: true. */
  collapsible?: boolean
  /** Default open state when collapsible. Default: true. */
  defaultOpen?: boolean
  /** Default open panel height. Default: 480. */
  defaultHeight?: number
  /** Min panel height the user can drag down to. Default: 260. */
  minHeight?: number
  /** Max panel height the user can drag to. Default: 720. */
  maxHeight?: number
  /** Max textarea height in px before internal scroll kicks in. Default: 200. */
  maxInputHeight?: number
  /** If set, persist panel height in localStorage. Default: undefined. */
  storageKey?: string

  // ── State ────────────────────────────────────────────────────
  /** Disables the input row. Chat remains visible and scrollable. */
  readOnly?: boolean
  /** Banner or badge rendered in place of the input when readOnly. */
  readOnlyNotice?: ReactNode

  // ── Message hooks ────────────────────────────────────────────
  /**
   * Transform assistant text before rendering (e.g. strip ```json blocks,
   * extract metadata). Returns { text } rendered in the bubble, plus any
   * extras rendered in the same bubble's footer.
   */
  transformAssistantMessage?: (raw: string) => { text: string; extras?: ReactNode }
}
```

### Message type

```ts
interface BrainstormMessage {
  id: string
  role: 'user' | 'assistant' | 'activity'
  content: string
  /** Agent attribution for assistant messages (defaults to current agentId). */
  agentId?: string
  /** Activity kind for non-chat runtime events such as tool calls. */
  kind?: 'runtime_status' | 'tool_call' | 'error' | string
  /** Normalized runtime activity payload or plugin-specific event data. */
  data?: unknown
  timestamp?: string
}
```

## UX specification

### Visual shape

- **Outer panel**: border-top, opens at `defaultHeight` (480px by default), vertical drag handle at top edge (uses existing `useVerticalResize`). User-adjustable from `minHeight` to `maxHeight`.
- **Collapsed**: shows only the centered header — `<icon> <label> (N replies) ▼`. Clicking anywhere on the header toggles open.
- **Open**: two stacked regions.
  - **History** (flex-grow, `overflow-y-auto`, always scrolls to bottom on new message/token).
  - **Input row** (shrink-0): `<AgentSelect>` (if `onAgentChange` present) + `<textarea>` + send button.

### Message rendering

- **User**: right-aligned bubble, accent-tinted background.
- **Assistant**: left-aligned with `<AgentAvatar size="sm">` + left border tinted with agent color from `useAgentColor`. Body rendered via `<MarkdownContent>`. Consecutive assistant messages grouped with negative top margin (`-mt-2`); avatar shown only on the first of a run.
- **Activity**: runtime/tool events render as assistant-style rows with the same avatar + tinted left border. Tool call/result pairs with the same `callId` collapse into one row; the compact row shows tool name, status, duration, and a human-readable `summary` when the runtime provides one. Raw commands and payloads stay in expandable `Input` / `Output` / `Metadata` sections.
- **Streaming**: partial text renders in the same bubble shape; the message's `id` is provisional (`streaming-<ts>`) and gets replaced with the server-final id when `onSend` resolves.
- **Empty state**: default is `<AgentAvatar size="xl">` above `Brainstorm with ${agentName}` + a one-line hint. `emptyState` prop overrides.

### Thinking indicator

Shown when `onSend` is in flight and no tokens have arrived yet. Format: `<AgentAvatar size="sm"> {agentName} is {verb}…` with a spinner. `{verb}` is pulled from a curated, culinary-themed list — picked randomly per request, stable for the duration of that request, freshly rolled on the next:

```
sizzling, crackling, brewing, steeping, curing, thawing, smoking,
flipping, rendering, marinating, scrambling, poaching, preheating,
microwaving, baking, wafting, simmering, searing, whisking, roasting,
crisping, churning, seasoning, scorching, folding, charring, toasting
```

Once the first token arrives, the thinking indicator is replaced by the streaming message bubble.

### Panel sizing

Open bottom-sheet mode starts at `defaultHeight` (480px by default) so the empty state and recent history are visible immediately. Sending a message does not change the panel height. After a manual drag, the user's height wins and can persist through `storageKey`.

### Textarea

- Fills input-row width. Initial rows: 2.
- **Auto-grows on type** up to `maxInputHeight` (default 200px) via `scrollHeight` measurement on every change. Beyond the cap: internal scrollbar, no further outward growth.
- **No native `resize-y` grip.** No input-pane drag handle. The outer panel handle is the only user-driven resize mechanism, and it only affects how much *chat history* is visible — textarea height is content-driven.

### Keyboard

| Key | Action |
|---|---|
| Enter | Send (unless Shift held) |
| Shift+Enter | Newline |
| Cmd/Ctrl+Enter | Send (muscle-memory alias) |
| Esc | Abort in-flight request via `AbortController.abort()` |

All keyboard handlers are disabled when `readOnly` or while already sending (except Esc, which is only active while sending).

### Focus

Textarea auto-focuses on:
- Panel expand (collapsed → open).
- After an `onSend` resolves or aborts, if the component still has no focused descendant.

Not on mount — lets the page decide what takes initial focus.

### Scroll

Always scrolls history to bottom on:
- New message appended (user or assistant).
- Each streamed token during an in-flight send.

### Abort behavior

Esc calls `AbortController.abort()`. The caller's `onSend` is expected to detect the signal and cleanly tear down its SSE reader. The component finalizes whatever partial text arrived as the assistant's message and drops the "thinking" indicator. Next message can be sent immediately.

### readOnly

Input row (textarea + send + agent picker) is replaced by `readOnlyNotice` if provided, otherwise a muted "Chat is read-only" label. History remains fully interactive (scroll, copy).

## Architecture

### Placement

```
packages/sdk/src/components/integrated-brainstorm/
  index.tsx                — public component; re-exported from components/index.ts
  message-list.tsx         — history rendering + grouping
  input-row.tsx            — textarea + send + agent picker + keyboard
  collapsed-header.tsx     — icon/label/count chrome
  empty-state.tsx          — default empty-state renderer
  thinking-indicator.tsx   — verb picker + spinner
  use-auto-grow.ts         — textarea scrollHeight → height effect
  use-brainstorm-state.ts  — send/abort/streaming state machine
  activity.ts              — runtime chunk → brainstorm activity helpers
  sse.ts                   — reusable SSE reader for brainstorm transports
  types.ts                 — BrainstormMessage, prop types
```

Re-export from `packages/sdk/src/components/index.ts`:

```ts
export { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
export type { BrainstormMessage, IntegratedBrainstormProps } from '@/components/integrated-brainstorm/types'
```

Component name registered in vendor bundle externalization: no change needed — it's inside `@bakin/sdk/components` which is already externalized.

Pure helpers are also exported from `@bakin/sdk/utils` for server-side plugin route code:

```ts
export {
  runtimeChunkToBrainstormActivity,
  readBrainstormSseResponse,
  toBrainstormTimeline,
} from '@bakin/sdk/utils'
```

### State machine

Internal state tracked in `use-brainstorm-state.ts`:

```
idle ─▶ sending ─▶ streaming ─▶ idle
  │         │           │
  │         └─ onSend throws ─▶ idle (error appended as assistant bubble)
  │                     │
  │                     └─ Esc/abort ─▶ idle (partial preserved if any)
  │
  └─ readOnly ─▶ input suppressed; other states unaffected
```

### Outer panel resize

Reuses existing `src/hooks/use-vertical-resize.ts` (exported through `@bakin/sdk/hooks`). `defaultHeight` controls the initial open height; `minHeight` is only the lower drag bound.

### Streaming shape

`onSend` is a single async function. The component passes it a `{ signal, onToken, onCustom }` bag. Caller's responsibility:

1. Open the SSE stream (fetch + `body.getReader()` — messaging already does this; projects gets a new handler).
2. Parse `event: token` / `event: done` / `event: error` / custom events.
3. Forward text chunks via `onToken(text)`.
4. Forward domain events (e.g. `proposal`, `proposals`) via `onCustom(name, data)`.
5. Honor `signal.aborted` — close the reader, abandon the fetch.
6. Resolve with `{ content }` on `done`, reject with an `Error` on server error or transport failure.

`readBrainstormSseResponse(response, ctx, options)` is the reusable SDK parser for common brainstorm SSE streams. Plugin clients should use it instead of duplicating the token/activity/done/error loop. The component itself still never opens fetch or EventSource — callers own transport and pass an `onSend`.

## Migration plan

### 1. Projects backend: `POST /projects/:id/ask` → SSE

- Change the route at `plugins/projects/index.ts:353` from returning JSON to streaming SSE.
- Mirror the shape of messaging's `POST /sessions/:id/messages` handler using the active runtime messaging boundary. Do not add or depend on a core provider client.
- Emit events: `event: token\ndata: {"text":"…"}`, then `event: done\ndata: {"content":"…full…","messageId":"…"}`. No proposals in projects today.
- Side effects (persistence, indexing) happen server-side at `done` emission, not during streaming.

### 2. Projects client: `project-detail.tsx`

Gut lines 124–160 (brainstorm state + resize + textarea ref). Replace the whole `{/* ── Brainstorm ── */}` block (lines 646–735) with:

```tsx
<IntegratedBrainstorm
  messages={brainstormMessages}
  onMessagesChange={setBrainstormMessages}
  agentId={brainstormAgent}
  onAgentChange={setBrainstormAgent}
  onSend={projectAskOnSend}  // local async fn that opens SSE to /ask and forwards tokens
/>
```

Where `projectAskOnSend` is a small helper (~30 lines) in the plugin that owns the fetch + SSE reader loop.

### 3. Messaging client: `session-chat.tsx`

Refactor (don't rewrite — the SSE parser is production-proven):

- Extract the SSE-reading loop from the current component into a local `sessionOnSend(prompt, history, { signal, onToken, onCustom })` adapter. Inside it, `onCustom('proposal', data.proposal)` replaces `onProposalsReceived([data.proposal])`.
- Lift `handleProposalsReceived` up to `planning-layout.tsx` (or wire via a callback prop), so `SessionChat` becomes a thin wrapper around `<IntegratedBrainstorm>`.
- Wire `readOnly={isCompleted}` + `readOnlyNotice={<Badge>Session completed — read-only</Badge>}`.
- Supply `transformAssistantMessage` to reuse the existing `stripAndSplit` logic for inline-JSON-block stripping.

### 4. Removals (no back-compat)

- Delete `plugins/messaging/components/brainstorm-panel.tsx` (grep confirms zero imports).
- Delete the projects-specific `brainstormPanelHeightRef` / `didAutoGrowBrainstormRef` / textarea-ResizeObserver code — now lives in the component.
- Do NOT delete `use-vertical-resize.ts` — component depends on it.

### 5. Personality verb list

Maintained as a single `const VERBS = [...]` in `thinking-indicator.tsx`. User can add verbs by PR'ing that file; no external config.

## Code style

Bakin conventions (see `CLAUDE.md`):

- TypeScript strict — no `any` crossing module boundaries. Props/state fully typed.
- Functional components + hooks. No class components.
- Files `kebab-case.tsx`. Types/components `PascalCase`. Consts `UPPER_SNAKE_CASE`.
- Import order: builtins → externals → `@bakin/sdk` → `@/*` → relative.
- Tailwind classes inline; no CSS modules.
- No comments unless the "why" is non-obvious. Component is stateful and has quirks — expect 2–3 comments total in hot spots (abort-during-streaming race, auto-grow measurement order).

## Testing strategy

Target: **comprehensive coverage**. The component is the shared brainstorm surface across the app — regressions affect every plugin that adopts it. Every prop, every keyboard interaction, every state transition, every accessibility contract gets tested.

Per `CLAUDE.md` testing rules: content-dir mocking is mandatory for anything touching filesystem. **This component is pure UI and must not touch the filesystem**, so the mandatory rule is to *keep it that way* — any test that somehow imports a filesystem-touching helper fails the audit.

### Location & runner

- Tests live under `tests/components/integrated-brainstorm/`.
- Runner: `bun test --isolate` (jsdom via `happy-dom` or Bun's built-in DOM shim — choose whichever other SDK component tests use; if none exist, go with Bun's built-in).
- Helpers: one shared `fake-on-send.ts` that returns a controllable mock — exposes `onSend`, `emitToken`, `emitCustom`, `resolve`, `reject` — so tests drive the streaming state machine deterministically without real timers or fetch.

### Coverage contract

Every exported prop must have at least one test that exercises it at a non-default value. Every branch in `use-brainstorm-state.ts` must be hit. The suite must fail (not silently pass) if:
- A prop is added to the API without a corresponding test.
- An `onSend` state transition stops firing.
- A keyboard handler stops calling its action.
- ARIA roles/attributes regress.

### Test cases

**1. Rendering — empty & populated**
- 1.1 Empty, default empty-state: avatar + `Brainstorm with {agentName}` copy rendered.
- 1.2 Empty, custom `emptyState` prop: override rendered, default suppressed.
- 1.3 Messages populated: empty state is hidden.
- 1.4 User bubble: right-aligned, accent-tinted, content rendered as plain text (NOT markdown-rendered).
- 1.5 Assistant bubble: `<AgentAvatar>` rendered, body rendered through `<MarkdownContent>`.
- 1.6 Assistant bubble: left border inline-style uses `useAgentColor(agentId)` color with alpha.
- 1.7 Consecutive assistant bubbles: first has avatar, second has placeholder spacer + `-mt-2` className; user message between them breaks the group.
- 1.8 Assistant attribution: message with its own `agentId` uses that agent's avatar + color, not the current session agent's.

**2. Collapse chrome**
- 2.1 `defaultOpen={true}`: history + input visible.
- 2.2 `defaultOpen={false}`: only header visible; body not in DOM.
- 2.3 Header click toggles open/closed; `aria-expanded` flips.
- 2.4 `collapsible={false}`: no chevron rendered, header clicks no-op, stays open.
- 2.5 Collapsed reply-count badge: matches `messages.filter(m => m.role === 'assistant').length`.
- 2.6 Custom `icon` and `label` props rendered in place of defaults.
- 2.7 Default icon = lucide `Sparkles`, default label = `Brainstorm`.

**3. Default sizing & resize**
- 3.1 Open bottom-sheet mode starts at `defaultHeight` (480px by default).
- 3.2 First `onSend` does not change panel height.
- 3.3 Manual drag updates height inside `[minHeight, maxHeight]`.
- 3.4 Drag below `minHeight` clamps to `minHeight`.
- 3.5 Drag above `maxHeight` clamps to `maxHeight`.
- 3.6 Touch drag (touchstart/touchmove/touchend) works equivalently to mouse.
- 3.7 `storageKey` set → height persists across unmount+remount; verify round-trip through `localStorage`.
- 3.8 `storageKey` unset → no `localStorage` calls made.
- 3.9 Drag handle has `role="separator"` + `aria-orientation="horizontal"` + `aria-label`.

**4. Send / streaming state machine**
- 4.1 Enter sends: `onSend(prompt, history, ctx)` called with trimmed input + current messages.
- 4.2 User message appended immediately on send (optimistic update).
- 4.3 Input cleared immediately after send fires.
- 4.4 Thinking indicator visible between send and first token.
- 4.5 `onToken('hel')` then `onToken('lo')` → streaming bubble shows `hello`.
- 4.6 `onSend` resolve with `{ content: 'hello' }` replaces streaming bubble with final message carrying the returned content.
- 4.7 Final message gets an assistant `id` (not `streaming-*`).
- 4.8 Concurrent send guard: pressing Enter while sending is in flight is ignored (`onSend` call count stays at 1).
- 4.9 `onSend` rejects: error message appended as assistant bubble with error styling; state returns to idle; input remains cleared.
- 4.10 Send with empty / whitespace-only input: no `onSend` call, no message appended.
- 4.11 Send button disabled when: input empty, while sending, when `readOnly=true`.
- 4.12 Send button enabled: input non-empty + idle + not `readOnly`.

**5. Keyboard**
- 5.1 Enter sends.
- 5.2 Shift+Enter inserts newline, does NOT send.
- 5.3 Cmd+Enter (metaKey) sends.
- 5.4 Ctrl+Enter (ctrlKey) sends.
- 5.5 IME composition (compositionstart → Enter → compositionend): Enter does NOT send during composition. (Regression guard for JP/KR/CN users and anyone using emoji picker.)
- 5.6 Esc while sending: `AbortController.abort()` called on the signal passed to `onSend`.
- 5.7 Esc while idle: no-op (no error, no call).
- 5.8 Esc after tokens received: partial text preserved as final assistant message when onSend rejects with AbortError.
- 5.9 Esc before any tokens: onSend rejects with AbortError; no assistant bubble appended.
- 5.10 Keyboard events suppressed when `readOnly`.

**6. Textarea auto-grow**
- 6.1 Initial: 2 rows (~60px).
- 6.2 Typing one line stays at 2 rows.
- 6.3 Typing N lines grows via scrollHeight measurement, up to `maxInputHeight`.
- 6.4 Beyond cap: stays at cap, `overflow-y: auto` kicks in.
- 6.5 Clearing input shrinks back toward initial 2 rows.
- 6.6 Paste with newlines triggers re-measurement.
- 6.7 No native `resize-y` grip on the textarea DOM element (asserted via computed style or CSS class absence).

**7. Agent picker**
- 7.1 `onAgentChange` present → `<AgentSelect>` rendered in input row.
- 7.2 `onAgentChange` absent → no picker rendered.
- 7.3 Picker change calls `onAgentChange(newId)`; does NOT abort in-flight send.
- 7.4 Avatar + color on empty state updates when `agentId` prop changes.

**8. `readOnly`**
- 8.1 Input row replaced by default "Chat is read-only" text when no `readOnlyNotice`.
- 8.2 Input row replaced by `readOnlyNotice` when provided.
- 8.3 History still renders messages.
- 8.4 History scroll still works.
- 8.5 Collapse chrome still clickable.
- 8.6 Toggling `readOnly=true` while a send is in flight: current send completes; no new sends possible.

**9. Scroll**
- 9.1 Message appended → history scrolls to bottom.
- 9.2 Token arrives during stream → history scrolls to bottom.
- 9.3 Empty history does not attempt scroll.
- 9.4 Scroll to bottom uses `behavior: 'smooth'`.

**10. `transformAssistantMessage`**
- 10.1 Absent: raw assistant content rendered directly through markdown.
- 10.2 Present: returned `text` rendered (raw content is NOT rendered).
- 10.3 Present with `extras`: extras rendered inside the same bubble, below the text.
- 10.4 Applied to streaming text (called on every token update, not only final) — so inline `json` blocks are stripped even while streaming.
- 10.5 Applied to final `content` in the resolved message.

**11. `onCustom` plumbing**
- 11.1 Caller's `ctx.onCustom('proposal', {id: 'x'})` inside `onSend` forwards intact — data object reaches caller's callback unchanged.
- 11.2 Multiple `onCustom` calls in one send all fire in order.
- 11.3 Component never intercepts `onCustom` events (opaque pass-through).

**12. Focus**
- 12.1 Collapsed → open transition: textarea receives focus.
- 12.2 Initial mount with `defaultOpen=true`: textarea NOT auto-focused (page owns initial focus).
- 12.3 After `onSend` resolves: textarea refocused if no other element has focus.
- 12.4 After `onSend` rejects / aborts: textarea refocused.

**13. Thinking verb**
- 13.1 Verb selected at send-start from the curated list.
- 13.2 Same verb persists for the duration of one in-flight send (doesn't re-roll mid-request).
- 13.3 Next send rolls a new verb (statistically — may coincidentally repeat; assert via Math.random mock).
- 13.4 All 27 verbs from the list are reachable (seed Math.random to cover each index once).

**14. Accessibility**
- 14.1 Collapse header: `role="button"` + `aria-expanded` + `aria-controls` pointing to the body element.
- 14.2 Drag handle: `role="separator"` + `aria-orientation="horizontal"` + `aria-label="Resize brainstorm panel"`.
- 14.3 Textarea: `aria-label` present (matches placeholder when hidden).
- 14.4 Send button: `aria-label="Send"` (button has only an icon).
- 14.5 Thinking indicator: `aria-live="polite"` region so screen readers announce it.
- 14.6 Error bubbles: `role="alert"` for immediate announcement.

**15. Edge cases**
- 15.1 `agentId` changes mid-conversation (user picked a new agent): existing messages keep their own `agentId`; new messages attribute to the new agent.
- 15.2 `messages` prop mutated externally (parent inserts a message): component re-renders correctly, scroll still bottoms.
- 15.3 `onSend` resolves with empty content: no assistant bubble appended, thinking indicator cleared.
- 15.4 Very long assistant message (>10k chars): renders without layout jank (manual visual, automated length-only assertion).
- 15.5 Rapid send/abort cycles: state machine doesn't get stuck in `sending` after Esc.

### Integration verification — automated where possible

- **Messaging SessionChat adapter test** — a plugin-level test at `plugins/messaging/tests/` that wires `<IntegratedBrainstorm>` to a mocked SSE backend, sends a message, asserts proposals forwarded via `onCustom` reach the review panel. Uses the test-helpers `activatePlugin` + mocked route per CLAUDE.md rules.
- **Projects ask-handler test** — a plugin-level test at `plugins/projects/tests/` for the new SSE route: POST a prompt, consume the stream, assert `token` events arrive followed by a `done` event with accumulated content. Uses a mocked runtime messaging stream/send boundary.

### Manual smoke checklist (part of the PR description)

Against `bun run dev`:

- [ ] Projects: new project → open it → Brainstorm opens around 480px tall → ask question → tokens stream → reply arrives → panel height remains user-controlled.
- [ ] Projects: drag outer handle up → more history visible; drag down → clamps at min.
- [ ] Projects: mid-stream press Esc → stream stops, partial reply preserved, can send again immediately.
- [ ] Projects: collapse chevron → panel collapses to header; chevron flips; click again → expands, textarea focused.
- [ ] Messaging: open existing session → send message → tokens stream → proposals appear in review panel.
- [ ] Messaging: complete a session → input replaced with read-only badge; history still scrolls.
- [ ] Messaging: Cmd+Enter sends (not just Enter).
- [ ] Messaging: IME composition (e.g. macOS emoji picker Ctrl+Cmd+Space, or JP input if available) → Enter doesn't send mid-composition.

### Deferred (not in v1, flagged for follow-up)

- Playwright E2E via the `browser-testing-with-devtools` skill — would exercise the full streaming path in a real browser. Adds a ~1hr setup cost; defer until the component has shipped and stabilized.
- Visual regression tests (screenshot diffs) — out of scope; we don't have that tooling yet.
- Performance: render 1000 messages, assert no frame drops — defer, the surface is low-volume today.

## Boundaries

### Always

- Use `<MarkdownContent>` for assistant text (the transformed text, after `transformAssistantMessage` if provided).
- Use `<AgentAvatar>` and `useAgentColor` for assistant attribution.
- Use existing `useVerticalResize` for the outer panel.
- Fire abort on Esc; caller must honor the signal.
- Scroll history to bottom on any message append or token.
- Leave all domain-specific rendering (proposal cards, checklist updates, status chips) to the caller — in the caller's own panels, not in the component's message list.

### Ask first

- Adding any new prop to the public API after initial ship.
- Adding `position="top"` or `position="side"` variants.
- Introducing any persistence beyond the single `storageKey` for panel height.
- Bumping `@bakin/sdk` major version as a result of this work.

### Never

- Render proposal / suggestion / action cards inside the component. Domain UI lives in the plugin.
- Touch filesystem APIs, `fetch`, or `EventSource` from inside the component — the caller owns transport.
- Import from `@/*` (server-side) or plugin code — the component lives in the SDK and must only depend on React, lucide-react, and other `@bakin/sdk/*` surfaces.
- Introduce a second resize mechanism on the textarea (native `resize-y`, separate drag handle, etc.). The outer panel handle is the only manual resize control; textarea is content-driven only.
- Ship a back-compat wrapper for `brainstorm-panel.tsx`. Delete it.
- Skip the SSE migration for projects. Both call sites must use the streaming `onSend` shape — no JSON-reply fallback.

## Acceptance criteria

A PR merges only when all of these are true:

- [ ] `packages/sdk/src/components/integrated-brainstorm/` exists with the files listed under **Architecture → Placement**.
- [ ] `<IntegratedBrainstorm>` and `BrainstormMessage` are exported from `@bakin/sdk/components`.
- [ ] `plugins/projects/components/project-detail.tsx` contains no more brainstorm UI code — just the component invocation and a local `onSend` adapter.
- [ ] `plugins/projects/index.ts` `/ask` route streams SSE.
- [ ] `plugins/messaging/components/session-chat.tsx` renders `<IntegratedBrainstorm>` and forwards proposals via `onCustom`.
- [ ] `plugins/messaging/components/brainstorm-panel.tsx` is deleted.
- [ ] Unit tests for all cases under **Testing → Unit tests** pass under `bun test --isolate`.
- [ ] Manual smoke pass: both plugins' brainstorm works end-to-end including abort via Esc.
- [ ] No type errors in `bun run build`.
- [ ] No orphan imports of `brainstorm-panel.tsx` or the old projects inline brainstorm helpers.

## Commands

```
bun install                                          # install deps
bun run build                                        # type-check + compile the world
bun test --isolate                                   # full test suite
bun test --isolate tests/components/integrated-brainstorm   # component tests only
bun run dev                                          # watch-mode for manual verification
```

## Known unknowns

1. **Runtime streaming** — projects `/ask` must use the runtime messaging stream boundary and fall back to runtime messaging send when streaming is unavailable.
2. **Messaging's `planning-layout.tsx`** — lifting `onProposalsReceived` up a level may need minor refactor of how `session` state is passed. Should be ~10 line change.
3. **Agent color hook** — `useAgentColor` needs to be re-exported from `@bakin/sdk/hooks` if not already. Verify during build.
4. **`getMainAgentId`** — currently called on the server in projects `/ask` to default the agent. In the streaming version, this behavior must be preserved.

---

**Status**: DRAFT — awaiting author confirmation before implementation planning (`/agent-skills:plan`).
