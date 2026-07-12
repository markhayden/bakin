# SPEC: Chat Plugin UX Overhaul & SDK Conversation Kit

**Status:** Draft — pending approval
**Date:** 2026-07-11
**Process:** /agent-skills:spec → /agent-skills:plan → /agent-skills:build → /agent-skills:test
**Repos:** `markhayden/bakin` (primary), `markhayden/bakin-bits-official` (messaging + projects migration)

---

## 1. Objective

Make chat the day-to-day hub for working with agents, and make its conversation UI the **gold-standard pattern reused by every conversational surface** in the Bakin ecosystem.

Two deliverables, inseparable:

1. **The SDK Conversation Kit** — a complete conversation component suite in `@makinbakin/sdk` that becomes THE way any plugin renders an agent conversation: message list, turn rendering, tool-call activity groups, thinking states, composer, detail drawer. One folding engine, one visual language, zero parallel implementations.
2. **The chat plugin overhaul** — the reference consumer: modern two-pane layout, launcher empty state, rich media both directions (render + image attachments), structured transcripts, and a full async attention system (unread badges, toasts, sound, OS notifications) so the user can multi-task while agents work.

**Target user:** Mark, single-user self-hosted install. No backwards compatibility, no shims, no migration paths. Tech-debt reduction is a priority: this effort **deletes** `IntegratedBrainstorm` (~1,473 lines) and the three duplicated chunk-folding implementations.

### Success criteria (user-visible)

- Opening `/chat` with no selection shows a launcher (agent quick-start cards + recent conversations), never a bare text line.
- Every conversational surface (chat, messaging brainstorm, projects brainstorm, tasks step output) renders turns identically.
- Tool calls read as human activity ("Searched the web · 3 calls · 12s"), expandable inline, with full input/output one click deeper in a drawer.
- Ask an agent something, navigate to `/tasks`, and: the Chat nav item shows a working indicator, then an unread badge; a toast (click-to-jump) + subtle sound fire on completion; an OS notification fires if the tab is unfocused.
- Paste or drop an image into the composer and the agent sees it (capability-gated per agent/model).
- Agent-returned markdown renders images (lightbox), video, and syntax-highlighted code.
- Up-arrow steps back through your sent messages like a shell.
- The composer is drag-resizable vertically and auto-grows; you can keep typing while the agent streams; unsent drafts survive switching chats.
- ⌘K global search finds conversations by content and deep-links into them.
- The browser tab title shows the unread count when you're elsewhere.
- No unreadable low-contrast states; everything uses theme tokens with proper contrast.

---

## 2. Decisions (locked during interview)

| # | Decision | Choice |
|---|---|---|
| D1 | Where shared chat UI lives | SDK conversation kit; all surfaces migrate **in this effort** |
| D2 | Attention channels | Nav badge + unread counts, in-app toast, sound, browser notification — **all four** |
| D3 | `IntegratedBrainstorm` | **Break the API.** Deprecate/delete it; update messaging + projects in `bakin-bits-official` (we control it, no external users) |
| D4 | Tool-call pattern | Collapsed activity groups per turn → inline expand to per-call rows → `BakinDrawer` for full input/output/metadata |
| D5 | Media scope | **Both directions now**: rich rendering out, image attachments in (contract + both adapters already native — see §3) |
| D6 | Layout | Polished two-pane: sidebar rail (search, FacetFilter agents, grouped recents, unread badges) + conversation pane; empty pane = launcher |
| D7 | Chat titles | LLM auto-title in background, first-user-message-derived title as instant fallback, inline rename. Titling is budget-gated and never bills when capped |

### Decisions made by spec (from codebase principles — veto if wrong)

| # | Decision | Rationale |
|---|---|---|
| S1 | **Transcript schema v2, no migration.** Structured JSONL rows persist full tool data (callId, toolName, status, input/output previews, durationMs, metadata) and user attachments. Old transcripts that fail the v2 zod parse render best-effort (legacy rows tolerated by a lenient union) but get no rich replay. | No-backcompat mandate; today's `"name: summary"` string kills replay/drawer for past turns |
| S2 | **Draft-mode chat creation.** Picking an agent opens a draft conversation; the chat is persisted on first send. Kills "Untitled chat · 0 msg" clutter. | Modern-chat convention, removes empty-chat garbage |
| S3 | **Chat attachments are chat-owned files** under `~/.bakin/chat/attachments/<chatId>/`, NOT auto-created assets. | Assets D7 principle: raw file drops never auto-become assets; import stays explicit |
| S4 | **Read state is server-side** (`lastSeenAt` per chat in the chat index), updated when the user views a chat. Unread = rows newer than `lastSeenAt`. | Survives reloads; Tailscale multi-device access; single source of truth |
| S5 | **Abort support in chat.** Stop button while streaming; `AbortController` → `MessageArgs.signal`. Aborted turns persist partial text + an aborted marker row. | Contract already supports `signal`; brainstorm had abort, chat losing it would be a regression |
| S6 | **Sound default ON**, subtle, toggle in chat plugin `settingsSchema`. Toast suppressed when the chat is visible; sound follows the same suppression; OS notification only when the tab is unfocused (existing `sendBrowserNotification` behavior). | User explicitly opted into sound; suppression rules prevent double-notifying |
| S7 | **Message actions: copy** (any message), **retry** (failed HTTP sends AND failed turns — an error row gets a "Try again" that re-sends the last user message). No regenerate of successful turns and no edit-sent-message — agent turns have side effects (tools), blind re-runs are dangerous. | Honest-behavior principle |
| S11 | **Chat transcripts join global search.** The chat plugin registers a search content type (file-backed over the JSONL transcripts, `schemaVersion` from day one) with a ⌘K hit renderer that deep-links to `/chat?chat=<id>`. | A hub you can't search isn't a hub; the search system + plugin guide make this assembly work |
| S12 | **Composer never blocks typing.** While a turn streams you can keep composing; only send is held until the turn settles (tooltip explains). Unsent drafts persist per chat (localStorage) and restore on return. Composer auto-focuses on chat open / agent pick. | Table stakes in every modern chat UI |
| S8 | **Attachments are images only** (`image/*`), capability-gated per agent via `runtime.capabilities({agentId}).input.imageInput`; UI hides/disables the affordance when unsupported; >2 MB images downscaled by reusing the assets enrichment downscale shim. | Both adapters are native image-only; non-image rejects loudly today (never silently drop pixels) |
| S9 | **Syntax highlighting** added to the markdown pipeline (rehype-based highlighter; exact library chosen in plan by bundle-size/vendor-build fit). Applies everywhere `MarkdownContent` renders. | The one real gap found in SDK infra |
| S10 | **One folding engine.** A single `foldConversation` (evolution of `foldTurnChunks`) in the SDK consumes `RuntimeChatChunk`s and produces the turn model. The three existing implementations (`foldTurnChunks`, brainstorm `activity.ts`, `use-chat-data` coalescing) collapse into it. `TurnOutputView` becomes a thin wrapper over kit internals so tasks' step-output-viewer keeps working. | Tech-debt mandate; this is the whole point |

---

## 3. Current state (research summary)

- `plugins/chat` (~984 lines): two-pane page, `TurnOutputView` renderer, JSONL transcript that **discards structured tool data** (only `"name: summary"` persists — `stream-bridge.ts:117-121`), plain composer (no history/resize/attachments/abort), no unread/attention state anywhere.
- `IntegratedBrainstorm` (SDK, ~1,473 lines): parallel hand-rolled renderer (own message-list, tool folding, thinking indicator, SSE parser), hardcoded zinc/purple palette, consumed by external messaging/projects plugins. ~400–500 lines conceptually duplicate `TurnOutputView`/`foldTurnChunks`. Text coalescing exists in **three** places.
- SDK infra that already exists (assemble, don't invent): `setNavBadge` + `nav-badge-providers` global slot + `useNavBadge`; `toast()` Zustand store + shell `Toaster`; `sendBrowserNotification` + header `NotificationToggle`; `useVerticalResize`/`useAutoGrow`; `FacetFilter`/`AgentFilter`; `BakinDrawer` (drag-resize, width persistence); `AgentAvatar` (status dot, letter fallback); `EmptyState` (`panel` variant); global shell SSE (`usePluginEvent` works on any page).
- Attachments: `MessageArgs.attachments: {path, mimeType}[]` **already in the contract** (`packages/core/src/adapters/runtime/concepts.ts:88-102`); OpenClaw native ≤2 MB inline (`packages/adapter-openclaw/src/attachments.ts`), Pi native via `session.prompt(content, {images})` (`packages/adapter-pi/src/messaging.ts:104-118`); capability flag `input.imageInput` per agent/model; reference send-with-attachment implementation in assets enrichment (`plugins/assets/lib/enrichment/runtime.ts:131-167`) including the >2 MB downscale shim. Gap is only the chat plugin path + test mocks (conformance mock ignores attachments; imitation-crab `agent` RPC ignores `params.attachments`).

---

## 4. The SDK Conversation Kit

New component family in `packages/sdk` (source `src/components/conversation/`), exported from `@makinbakin/sdk/components`. Design-token styling only — **no hardcoded palettes** (the brainstorm zinc/purple dies here).

### 4.1 Turn model & folding engine

```ts
// One engine. Consumes RuntimeChatChunk / persisted rows, produces:
type ConversationTurn =
  | { kind: 'user'; ts; content: string; attachments?: DisplayAttachment[] }
  | { kind: 'agent'; ts; agentId; items: TurnItem[]; status: 'streaming'|'complete'|'error'|'aborted' }

type TurnItem =
  | { type: 'text'; format: 'markdown'|'plain'|'code'; content }         // coalesced
  | { type: 'activity'; calls: ToolCall[]; status; startedAt; durationMs } // consecutive tool calls grouped
  | { type: 'status'; label }                                             // thinking etc., streaming only
  | { type: 'error'; message; errorKind }

type ToolCall = { callId; toolName; status: 'running'|'completed'|'failed';
                  summary; inputPreview?; outputPreview?; durationMs?; metadata? }
```

`foldConversation(rows, liveChunks)` is pure and unit-tested to death. It subsumes: text-delta coalescing, call/result pairing by `callId` (incl. callId-less results), consecutive-tool grouping into activity groups, status/error/done handling.

### 4.2 Components

| Component | Behavior |
|---|---|
| `Conversation` | Scroll container: stick-to-bottom while pinned, "↓ new messages" jump pill when scrolled up, day separators, hover timestamps (relative, absolute in tooltip), correct padding |
| `UserMessage` | Right-aligned bubble (proper contrast tokens), attachment thumbnails, whitespace-pre-wrap, copy action |
| `AgentTurn` | Avatar + agent name header (avatar ALWAYS present — including thinking state), turn body renders `TurnItem[]`, copy action, error/aborted footers with "Try again" re-send on error (S7) |
| `ActivityGroup` | Collapsed: icon + humanized label ("Searched the web", fallback "Used web_search") + call count + duration, spinner while any call running. Expand: per-call rows (status glyph, tool name, summary, duration). Row click → `ToolCallDrawer` |
| `ToolCallDrawer` | `BakinDrawer`-based: full input/output (pretty-printed, scrollable, copyable), status, duration, callId, metadata |
| `ThinkingIndicator` | Avatar + shimmer/status label; replaces both the floating "thinking…" and brainstorm's cooking verbs (verbs optional via prop) |
| `Composer` | Auto-grow (`useAutoGrow`) + drag-resize handle (`useVerticalResize`, persisted per `storageKey`); Enter send / Shift+Enter newline / Esc abort; IME composition guard; stop button while streaming; **typing never blocked during streaming — only send waits** (S12); auto-focus on mount/thread switch; per-thread draft persistence (localStorage); send disabled on empty; ↑/↓ history (caret-at-start/empty rules, per-thread, localStorage); attachment support (paperclip + paste + drag-drop, image thumbnails with remove, capability-gated via prop); optional leading slot (agent switcher for brainstorm) |
| `ConversationEmptyState` | Configurable icon/title/description/suggestions; used for brand-new chats ("Chat with Main — ask anything…") |

`MarkdownContent` upgrades (shared, benefits every consumer): syntax-highlighted fenced code with language label + copy button; images render inline with click-to-lightbox, lazy-loaded, max-height clamped; `<video>` for video URLs/asset exports; relative asset URLs (`/api/assets/...`) work as-is; external links open in a new tab with `rel="noopener noreferrer"` (internal `/…` links navigate in-app).

### 4.3 Consumers & migration

- **chat plugin** — reference consumer (full overhaul, §5).
- **`TurnOutputView`** — reimplemented as a thin wrapper over `foldConversation` + kit renderers; existing consumers (tasks `step-output-viewer`, workflows step drawer) keep their API, gain the new visuals.
- **`IntegratedBrainstorm` — DELETED.** messaging + projects in `bakin-bits-official` rebuild their brainstorm surfaces directly on the kit. Features they need become kit capabilities/composition: collapsible resizable panel (compose `useVerticalResize` + a `ConversationPanel` wrapper), mid-thread agent switch (composer leading slot), `transformAssistantMessage` hook (prop for the proposal-JSON stripping), abort, per-request SSE ingestion (`foldConversation` accepts chunks regardless of transport; the brainstorm SSE reader becomes a small `readSseStream` util if still needed).
- `packages/sdk` exports pruned: `IntegratedBrainstorm` and its sub-exports removed (breaking — intentional, no shims).

---

## 5. Chat plugin overhaul

### 5.1 Layout & navigation

- Page: proper padding wrapper (match tasks/schedule: `px-6 pt-3/4 pb-2` header zone), `PluginHeader` with title, count, **search** (filters chat list by title/agent), and a primary **"Start a chat"** action.
- Sidebar rail: "Start a chat" button (opens agent picker popover — friendly copy, replaces "New chat with…" select); `AgentFilter` (FacetFilter) replaces the "All agents" select; **Pinned** group at top (pin/unpin via row hover action, persisted in the chat index), then chats grouped **Today / Yesterday / This week / Older**; each row = avatar, title, relative time, unread count pill, working spinner when a turn is in flight; selected row uses accessible tokens (fix the contrast bug); delete via row hover action + confirm. Rail is collapsible for focus (persisted).
- Keyboard shortcuts: new chat, next/prev chat, focus composer (exact bindings chosen in plan to avoid collisions with the shell's existing ⌘K etc.; surfaced in tooltips).
- Empty right pane = **launcher**: "Start a chat" heading, agent quick-start cards (avatar, name, role — click = draft chat), "Recent" list (last N chats, click to open). Loading states: skeleton rows in rail, skeleton launcher — never a blank pane.
- Draft mode (S2): picking an agent shows the conversation empty state + composer; `POST /chats` happens on first send.
- URL state preserved (`?chat=`, `?agent=` via `useQueryState`), `<Suspense>` wrapped.

### 5.2 Transcript schema v2 (S1)

```jsonc
{ kind: 'user',      ts, content, attachments?: [{ name, mimeType, path }] }
{ kind: 'assistant', ts, turnId, content }                    // full turn text
{ kind: 'tool',      ts, turnId, callId, toolName, status, summary,
                     inputPreview?, outputPreview?, durationMs?, metadata? }
{ kind: 'error',     ts, turnId, message, errorKind? }
{ kind: 'aborted',   ts, turnId }
// status/thinking chunks remain ephemeral — never persisted
```

- `stream-bridge` persists tool rows on `phase:'result'` with the full structured payload (input/output previews as delivered by the runtime tap; large payloads truncated at a byte cap with an honest `truncated: true` marker).
- Rows carry `turnId` so replay reconstructs turn grouping exactly like live streaming.
- Index (`index.json`) per chat gains: `lastSeenAt`, `lastMessageAt`, `lastMessagePreview`, `pinned`, `title` + `titleSource: 'fallback'|'llm'|'user'`.
- Lenient legacy parse: v1 rows still render (tool rows as summary-only calls); no migration code.

### 5.3 Attention system (D2)

- **Server**: `PATCH /chats/:id/seen` sets `lastSeenAt`. `chat.done` SSE payload enriched with `{ chatId, agentId, preview }`. Unread is computed per chat in the list response (`unreadCount`) — no second endpoint.
- **Client**: `ChatBadgeProvider` (renders null) registered in the global `nav-badge-providers` slot; Zustand store tracks `{ unreadByChat, inflightChats }`, seeded from the chat list on mount, updated by `chat.chunk` (inflight) / `chat.done` / `chat.error` events — works from any page (shell SSE is global).
  - Nav badge: total unread count (`tone: 'attention'`); dot/working treatment while any chat is in flight and nothing unread.
  - Toast on `chat.done` when that chat isn't currently visible: avatar/name + reply preview, click navigates to the chat.
  - Sound on the same trigger (subtle, bundled audio asset, settings toggle, default on).
  - `sendBrowserNotification(title, preview, '/chat?chat=<id>')` — existing focus-suppression handles the unfocused-only rule.
  - Viewing a chat (or receiving `done` while viewing) fires the `seen` PATCH and clears its unread.
  - Tab title unread count: `document.title` prefixed `(N)` while total unread > 0 (managed by the badge provider, restored on clear).

### 5.4 Attachments (D5, S3, S8)

- `POST /chats/:chatId/attachments` (multipart, image/* only, size-capped) → stores under `~/.bakin/chat/attachments/<chatId>/`, returns `{ name, mimeType, path }`. Draft-chat sequencing (create-then-upload vs staged drafts) decided in plan — simplest wins.
- `sendMessageBody` gains `attachments?: [{ name, mimeType, path }]`; `startChatTurn`/`runTurn` thread them into `messaging.stream({ attachments })`.
- Downscale >2 MB images before send (extract the enrichment downscale shim into shared core so chat + assets share one implementation).
- Composer affordance shown only when `capabilities({agentId}).input.imageInput` is true (fetched per chat agent, cached); honest tooltip when disabled ("<agent>'s model can't see images").
- Transcript replay renders user attachment thumbnails from the stored files (served via a chat attachment GET route with the same UUID path-traversal guard the store uses).

### 5.5 Composer behaviors

Enter/Shift+Enter (existing), Esc = abort in-flight turn (S5), stop button replaces send while streaming, typing never blocked during streaming — only send waits (S12), auto-focus on open/switch, per-chat draft persistence, ↑/↓ input history per chat (localStorage, shell-style), drag-resize + auto-grow, paste/drop images, char-cap feedback (64k limit exists — show a counter near the limit instead of silently failing).

### 5.6 Global search integration (S11)

- Chat registers a file-backed search content type over the transcript JSONLs (`ctx.search.registerFileBackedContentType`, `schemaVersion: 1`): doc per chat (title, agent, recent message text) so ⌘K finds conversations by content.
- Client: `registerPlugin({ search: { hitRenderers } })` — hit shows avatar, title, matching snippet; click deep-links `/chat?chat=<id>`.
- Engine-down behaves like every other surface (honest `search_unavailable`, no silent fallback).

### 5.7 Titles (D7)

- On first send: title = truncated first user message (`titleSource: 'fallback'`).
- After the first turn completes: background titling call — `messaging.send` with `ephemeral: true` and a strict "return a 3–6 word title" prompt through the **existing budget gate path** (respects kill switch and caps; skipped silently when blocked; never a parallel spend surface). Result → `titleSource: 'llm'` unless the user has renamed (`titleSource: 'user'` is never overwritten).
- Inline rename in the conversation header.

---

## 6. bakin-bits-official changes

- `plugins/messaging` + `plugins/projects`: brainstorm surfaces rebuilt on the kit (`Conversation`, `Composer`, `ActivityGroup`, panel wrapper). Proposal-review panel, agent switching, collapse/resize, storage normalization all preserved via kit composition points. Their hand-rolled SSE handling replaced by the kit's chunk-ingestion path.
- Their tests updated against the new SDK surface; `package-contract.test.ts` kept green.
- SDK version bump consumed by both plugins.

---

## 7. Commands

| Task | Command |
|---|---|
| Dev loop (HMR) | `bun run dev` (server-side changes need manual restart) |
| Dev with mock runtime | `bun run dev:mock` |
| Full test suite | `bun run test` |
| Single test file | `bun test tests/path/foo.test.ts --isolate` |
| Vendor bundles (SDK changes) | `scripts/build-vendors.ts` (part of `bun run build`) |
| Plugin builds | `scripts/build-plugins.ts` (part of `bun run build`) |
| Isolated e2e verify | `/verify` skill (isolated `BAKIN_HOME`, never touches prod 3737) |
| Dev rig (real runtime) | `bun run instance dev --mode isolated` |
| bits repo tests | `bun test` in `~/go/src/github.com/markhayden/bakin-bits-official` |

⚠️ Never `git add -A` after a local `bun run build` (build-stamp trap); run gates bare, never piped.

---

## 8. Project structure (touched areas)

```
packages/sdk/src/components/conversation/       NEW kit (components, fold engine, types)
packages/sdk/src/components/markdown-content.tsx  highlighting + media
packages/sdk/src/components/turn-output-view.tsx  thin wrapper over kit
packages/sdk/src/components/integrated-brainstorm/ DELETED
packages/sdk/src/hooks/                          unread store, sound util
plugins/chat/                                    complete overhaul (components/, lib/store.ts v2,
                                                 lib/stream-bridge.ts, lib/routes.ts + attachments,
                                                 badge provider, settingsSchema)
packages/core/                                   shared image-downscale util (extracted from assets)
plugins/assets/                                  consume extracted downscale util
packages/core/src/adapters/runtime/testing.ts    mock: imageInput opt-in + attachment echo
dev/imitation-crab/gateway.ts                    agent RPC acknowledges attachments
tests/                                           kit unit, chat plugin, RTL, conformance updates
.claude/knowledge/                               chat-plugin.md rewrite, NEW conversation-kit.md
CLAUDE.md                                        Chat bullet update
docs/src/content/docs/extending/                 SDK docs where brainstorm was referenced
bakin-bits-official/plugins/{messaging,projects} migrate to kit
```

Note: the SDK source layout above refers to the shared component source tree that `packages/sdk` re-exports (today at `src/components/…` re-exported via `packages/sdk/src/components/index.ts`) — kit files follow the same pattern as existing shared components.

## 9. Code style

Repo conventions apply unchanged: TS strict, zod at boundaries, functional preference, kebab-case files, import order (builtins → external → SDK → `@/*` → relative), design tokens only for styling, `createLogger` for server logs, no empty catches, `const` over `let`. Kit components follow existing SDK component idioms (`facet-filter.tsx`, `bakin-drawer.tsx` as style references). URL state via `useQueryState`. Cross-plugin communication only via the hooks registry. Conventional commits with scope (`feat(sdk)`, `feat(chat)`, `refactor(sdk)`, …).

## 10. Testing strategy

- **Fold engine**: exhaustive pure unit tests (coalescing, callId pairing, orphan results, grouping boundaries, abort/error mid-stream, legacy v1 rows).
- **Store v2**: round-trip tests, lenient legacy parse, lastSeenAt/unread computation, attachment path guards. Content-dir + OpenClaw-home mocks per the CRITICAL testing rules (both facade paths), temp dirs, cleanup.
- **Routes**: `tests/plugins/test-helpers.ts` (`activatePlugin`, `callRoute`) for chats/messages/seen/attachments (multipart via real `Request` + FormData).
- **Stream bridge**: mocked runtime stream → assert persisted v2 rows, SSE emissions, abort persistence, attachment pass-through.
- **Components (RTL)**: kit components + chat page states (empty/loading/launcher/streaming/unread), `--isolate`, `rtl-settle` import + `settleReact()` on race-prone assertions.
- **Badge/attention**: unread store transitions on synthetic plugin events; toast/notification trigger rules (visible vs not, focused vs not); tab-title prefix set/restore.
- **Search content type**: registration + doc shape unit tests (mocked `ctx.search`).
- **Conformance/mocks**: mock runtime gains opt-in `imageInput` + attachment echo; imitation-crab acknowledges `params.attachments`; `tests/dev/` run explicitly after crab changes (local ignore quirk).
- **E2E**: `/verify` boot + drive chat REST surface; `bun run dev:mock` manual visual pass; browser-testing skill for the streaming UX.
- **bits repo**: messaging/projects plugin tests updated; contract test green.

## 11. Boundaries

**Always:**
- One folding engine, one spend path (titling rides the existing budget gate), one SSE connection (shared bus), one downscale implementation.
- Design tokens only; a11y on interactive elements (resize handles keep the `role=separator` keyboard pattern).
- Honest states: capability-gated affordances explain themselves; failures render as errors, never silence.
- Update `.claude/knowledge/` + `CLAUDE.md` alongside code.

**Ask first:**
- Any change to the runtime adapter contract beyond consuming what exists (none anticipated — attachments already exist).
- Adding a runtime dependency to the SDK beyond the highlighter.
- Any scope growth into non-image attachments, task-creation-from-chat, or multi-agent chats.

**Never:**
- Backcompat shims or migration code (S1's lenient parse is a parser detail, not a shim layer).
- Parallel stat/spend/notification systems.
- Writes to runtime-owned data; provider identifiers upstream of adapters.
- Auto-converting chat uploads into assets (assets-D7).
- Touching `~/.bakin/` or `~/.openclaw/` from tests.
- `git add -A` after local builds.

## 12. Out of scope

- Audio/video/PDF attachments (adapters are image-only; revisit when model catalogs change).
- Regenerate successful turns / edit-a-sent-message (side-effectful tool re-runs; retry exists for errors only — S7).
- In-conversation find (⌘F within one chat) — global ⌘K search over transcripts covers discovery (S11).
- Chat export, multi-agent group chats.
- LaTeX/math and Mermaid rendering (rare for these agents; the markdown pipeline can grow them later).
- Virtualized message lists (single-user transcripts don't need it yet).
- Voice input, mobile-specific layouts (Tailscale desktop is the target).

---

*Next step per kickoff process: `/agent-skills:plan` — task breakdown with the commit/checkpoint strategy across both repos (SDK kit → chat overhaul → attention → attachments → brainstorm migration → docs), each phase independently green.*
