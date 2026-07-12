# PLAN: Chat Plugin UX Overhaul & SDK Conversation Kit

**Spec:** `.claude/specs/chat-conversation-kit.md`
**Status:** Draft — pending approval
**Date:** 2026-07-11
**Repos:** `bakin` (branch `feat/chat-conversation-kit`), `bakin-bits-official` (branch `feat/conversation-kit`)

---

## 0. North-star framing (drives the architecture)

The kit must serve **two consumption modes** from day one:

- **Session-manager mode** (chat plugin): the user creates/navigates/manages many
  conversations — rail, grouping, unread, pins, launcher. The rail/session-list
  components stay **in the chat plugin** for now (single consumer; promote to SDK
  when a second session-manager surface appears — noted in the kit knowledge doc).
- **Embedded single-session mode** (messaging brainstorm, projects brainstorm, plan
  workspace): ONE conversation embedded in a host surface. No session selection UI.
  The kit's `ConversationPanel` wrapper + primitives cover this completely.

Everything conversation-level (turn rendering, tool activity, composer, thinking,
empty state, drawer, folding engine, SSE ingestion) lives in the SDK and is
identical across both modes. That is the gold standard being built.

**Embedded-mode API contract** (extracted from real bits usage — this is the
acceptance bar, not a guess): `messages` / `onMessagesChange`,
`onSend(prompt, history, ctx)` with `ctx = { signal, onToken, onCustom }`,
`agentId` / `onAgentChange`, `placeholder`, `transformAssistantMessage → { text, extras }`,
`readOnly` / `readOnlyNotice`, `fitParent`, `showHeader`. Custom SSE events
(messaging's `proposal`) must dispatch through the kit's SSE reader.

**Server-side kit helpers** (today in `@makinbakin/sdk/utils`, consumed by bits
`index.ts` files): thread-id builder, chunk→storable-message normalization. These
get kit-named replacements (`conversationThreadId`, `chunkToConversationMessage`)
— same subpath, new names, old ones deleted with `IntegratedBrainstorm`.

**Hard ordering constraint:** installed messaging/projects client bundles resolve
`@makinbakin/sdk/components` from the HOST's vendor bundle at runtime. Deleting
`IntegratedBrainstorm` from the SDK before those plugins are migrated + rebuilt
bricks them at runtime. Deletion is therefore the LAST code phase (Phase 8).

---

## 1. Dependency graph

```
P1 Foundations (markdown media/highlighting; downscale extraction)   [parallel-safe]
        │
P2 Fold engine + turn model (pure)                                    [parallel with P1]
        │
P3 Kit components (P3a primitives → P3b activity+drawer → P3c composer
   → P3d embedded panel + SSE reader + server helpers → P3e TurnOutputView wrapper)
        │  requires P1 (markdown), P2 (fold engine)
        ├──────────────────────────────────────────────┐
P4 Chat overhaul core (transcript v2 → page rebuild → titles)         │
        │                                                              │
P5 Attention system          P6 Attachments          P7 Search        │
   (needs P4 store/SSE)         (needs P4 store)        (needs P4)    │
        └──────────────┬───────────────┴──────────────┘               │
P8 bits migration (needs P3 kit published/linked) ────────────────────┘
        │
P9 IntegratedBrainstorm deletion + docs sweep (needs P8 verified)
```

P4–P7 are sequential in practice (same plugin, overlapping files) but each is an
independently shippable, green checkpoint. P8 can start any time after Checkpoint A
(kit complete) — it does not wait for P4–P7.

---

## 2. Commit & checkpoint strategy

### Branches / PRs

| PR | Repo | Contents | Rollback story |
|---|---|---|---|
| **PR-1** `feat(sdk): conversation kit` | bakin | Phases 1–3 | Pure addition (IntegratedBrainstorm untouched, TurnOutputView API-stable). Revert = nothing else moves |
| **PR-2** `feat(chat): chat overhaul` | bakin | Phases 4–7 | Chat plugin + small server surface. Revert restores old chat; kit stays |
| **PR-3** `feat(messaging,projects): migrate to conversation kit` | bits | Phase 8 | Revert restores IntegratedBrainstorm consumers (still exported until PR-4) |
| **PR-4** `refactor(sdk)!: delete IntegratedBrainstorm + docs` | bakin | Phase 9 | Only lands after PR-3 is merged AND installed plugins rebuilt; revert re-exports |

### Commit rules

- One task = one atomic conventional commit (scope from the task table; `!` on the
  PR-4 deletion). Every commit leaves `bun run test` green — commits ARE the
  rollback checkpoints.
- **Checkpoint commits** (end of each phase) additionally require: `bun run build`
  clean, and for UI phases a `bun run dev:mock` visual pass. Checkpoints are noted
  in the commit body (`Checkpoint: A — kit complete`).
- Never `git add -A` after a local build (build-stamp trap); name files explicitly.
- Gates run bare, never piped.
- bits repo: same rules; its checkpoint = `bun test` green + `scripts/build-plugins.ts` clean.

---

## 3. Phases & tasks

### Phase 1 — Foundations (parallel-safe, no dependents blocked)

**T1.1 `feat(sdk): markdown media + syntax highlighting`**
`MarkdownContent`: rehype-based highlighting via `rehype-highlight`/lowlight with an
explicit curated language set (ts/js/tsx/json/bash/python/go/css/html/sql/yaml/md;
registered individually — never the full hljs bundle); custom `code` renderer with
language label + copy button; custom `img` (lazy, max-height clamp, click →
lightbox overlay); `<video>` for video-extension URLs; anchor renderer (external →
new tab + `rel="noopener noreferrer"`, internal `/…` → in-app navigation).
- *Accept:* fenced blocks highlight with label+copy; images clamp and lightbox;
  external/internal links behave per spec; existing consumers (tasks detail,
  brainstorm) render unchanged otherwise.
- *Verify:* new RTL tests for code/img/anchor renderers; `bun run test`; vendor
  build (`bun run build`) succeeds; note vendor-size delta in the commit body
  (size-debt watch).

**T1.2 `refactor(core): extract shared image downscale`**
Move the >2 MB downscale shim from `plugins/assets/lib/enrichment/downscale.ts`
into `packages/core` (e.g. `packages/core/src/media/downscale.ts`); assets
enrichment consumes it; behavior identical.
- *Accept:* enrichment tests green with zero behavioral diff; no `plugins/assets`
  import from chat later (chat imports core).
- *Verify:* existing enrichment tests + new unit test on the extracted module.

### Phase 2 — Fold engine (pure logic, no UI)

**T2.1 `feat(sdk): conversation turn model + foldConversation`**
`ConversationTurn`/`TurnItem`/`ToolCall` types + pure `foldConversation(rows, liveChunks)`
per spec §4.1: text coalescing by format, call/result pairing by callId (orphan
results tolerated), consecutive-tool grouping into activity items, status/error/
aborted handling, legacy v1 row tolerance (summary-only tool calls).
- *Accept:* subsumes the behaviors of `foldTurnChunks`, brainstorm `activity.ts`,
  and `use-chat-data` coalescing (table-driven tests ported from all three).
- *Verify:* exhaustive unit suite (`tests/sdk/conversation-fold.test.ts`) —
  streaming order permutations, mid-stream error/abort, callId-less results,
  format switches, v1 rows.

**Checkpoint pre-A** — commit; suite green.

### Phase 3 — Kit components

**T3.1 `feat(sdk): conversation primitives`**
`Conversation` (stick-to-bottom, jump pill, day separators, hover timestamps),
`UserMessage` (contrast-correct bubble, attachment thumbnails, copy),
`AgentTurn` (avatar always present, name header, TurnItem body, copy, error/aborted
footers + "Try again" callback prop), `ThinkingIndicator` (avatar + shimmer,
optional verb rotation), `ConversationEmptyState`.
- *Accept:* renders every `TurnItem` kind from T2.1 fixtures; avatar present in
  thinking state; tokens only (grep guard: no `zinc-`/`#5e6ad2` in kit files).
- *Verify:* RTL tests per component (`--isolate`, rtl-settle); fixture-driven
  render of a full synthetic conversation.

**T3.2 `feat(sdk): tool activity group + detail drawer`**
`ActivityGroup` (collapsed label/count/duration/spinner → expanded per-call rows)
+ `ToolCallDrawer` (BakinDrawer: pretty-printed input/output, copy, status,
duration, callId, metadata, honest `truncated` marker).
- *Accept:* live-streaming group updates in place (spinner → glyphs); row click
  opens drawer with full payload; keyboard accessible.
- *Verify:* RTL tests incl. streaming-transition fixtures.

**T3.3 `feat(sdk): conversation composer`**
`Composer` per spec §4.2: auto-grow + `useVerticalResize` drag handle, Enter/
Shift+Enter/Esc, IME guard, stop button, typing-never-blocked (send gated),
auto-focus, per-thread draft persistence, ↑/↓ history, attachment UI
(paperclip/paste/drop, thumbnails, remove) behind `attachments` prop with
capability-gated disabled state + tooltip, char counter near cap, optional
leading slot.
- *Accept:* all keyboard behaviors under RTL; drafts/history keyed by
  `storageKey`; attachment UI renders only when enabled and explains itself
  when disabled.
- *Verify:* RTL suite for keyboard matrix, draft restore, history stepping,
  paste/drop synthetic events.

**T3.4 `feat(sdk): embedded conversation panel + stream ingestion`**
`ConversationPanel` (embedded single-session wrapper: `fitParent`, `showHeader`,
`readOnly`/`readOnlyNotice`, collapse + vertical resize composition) +
`useConversationStream` (feeds `foldConversation` from either plugin-event chunks
or a per-request SSE `Response`) + `readSseStream` util (frame parser with
`onToken`/`onCustom`/`onDone`/`onError` — preserves messaging's `proposal`
custom-event bridge) + server helpers `conversationThreadId`,
`chunkToConversationMessage` (+ storable `ConversationMessage` type that
covers today's `BrainstormMessage` shape).
- *Accept:* the full embedded-mode API contract from §0 is satisfied — a fixture
  harness drives it exactly the way `brainstorm-view.tsx` does (transform +
  extras, custom events, readOnly, fitParent/showHeader).
- *Verify:* unit tests for reader + helpers; RTL for panel modes; contract test
  mirroring the three bits call sites.

**T3.5 `refactor(sdk): TurnOutputView as kit wrapper`**
Reimplement `TurnOutputView`/`foldTurnChunks` exports as thin wrappers over the
kit; existing consumers (tasks `step-output-viewer`, workflows step drawer,
current chat plugin) unchanged API-wise.
- *Accept:* all existing TurnOutputView tests pass unmodified; tasks/workflows
  drawers visually verified in dev:mock.
- *Verify:* existing suites + visual pass.

**CHECKPOINT A — kit complete.** Full suite green, `bun run build` clean,
dev:mock visual pass of tasks/workflows surfaces. PR-1 opens here.

### Phase 4 — Chat plugin overhaul core

**T4.1 `feat(chat): transcript v2 + structured stream persistence`**
Store v2 per spec §5.2 (zod union incl. lenient v1), index fields (`lastSeenAt`,
`lastMessageAt`, `lastMessagePreview`, `pinned`, `title`/`titleSource`),
stream-bridge persists structured tool rows (`phase:'result'`, byte-capped
previews + `truncated`), `turnId` on rows, aborted rows, abort support
(`AbortController` → `MessageArgs.signal`, per-chat registry), new/changed
routes: `PATCH /chats/:id/seen`, `PATCH /chats/:id` (rename/pin), abort
`POST /chats/:id/abort` (or DELETE on the turn — plan choice: POST abort),
`unreadCount` in list response, enriched `chat.done` payload
(`{chatId, agentId, preview}`).
- *Accept:* round-trip store tests; v1 rows parse leniently; abort persists
  partial text + aborted row and settles clean; list carries unreadCount.
- *Verify:* store/stream-bridge/route tests (test-helpers, both content-dir
  mocks, temp dirs); `bun run test`.

**T4.2 `feat(chat): page rebuild on the kit`**
Chat page per spec §5.1 + §5.5: padded header (search + Start-a-chat), rail
(pinned group, date groups, AgentFilter facet, unread pills, working spinner,
collapsible, contrast-fixed selection), launcher empty pane (agent cards +
recents, skeleton loading), draft mode (persist on first send), conversation
view on kit primitives, composer wiring (typing-never-blocked, drafts, history,
autofocus, Esc abort, stop button, retry-on-error), rename inline, seen PATCH
on view/done, keyboard shortcuts (⌘⇧O new chat, ⌥↑/⌥↓ prev/next chat,
⇧Esc focus composer — page-scoped, tooltips), URL state preserved.
- *Accept:* spec success-criteria items 1, 3, 7, 8 demonstrable in dev:mock;
  every list/pane has a designed empty + loading state; no contrast violations.
- *Verify:* RTL page-state tests (empty/launcher/draft/streaming/error);
  route tests for rename/pin; dev:mock visual pass incl. screenshots.

**T4.3 `feat(chat): auto-titles (fallback + budget-gated LLM)`**
Fallback title on first send; post-first-turn background `messaging.send`
(`ephemeral: true`, strict titling prompt) through the existing budget gate —
skipped when blocked, never a parallel spend path; `titleSource` precedence
(user > llm > fallback).
- *Accept:* title appears instantly (fallback), upgrades when LLM returns,
  never overwrites a user rename; blocked budget = silent skip (audit log only).
- *Verify:* unit tests with mocked runtime + budget gate (both outcomes).

**CHECKPOINT B — chat core.** Suite green, `/verify` boot + REST drive
(create/send/rename/pin/seen/abort), dev:mock visual pass. 

### Phase 5 — Attention system

**T5.1 `feat(chat): unread badges, toasts, sound, OS notifications`**
`ChatBadgeProvider` in `nav-badge-providers` slot (manifest + client register);
Zustand unread/inflight store seeded from list, driven by `chat.chunk`/`chat.done`/
`chat.error`; nav badge (count, working dot); toast (avatar+preview, click-to-jump,
suppressed when chat visible); sound (bundled subtle asset, settingsSchema toggle,
default on, same suppression); `sendBrowserNotification` on done; tab title `(N)`
prefix set/restore; viewing clears via seen PATCH.
- *Accept:* spec success-criterion 4 end-to-end in dev:mock (reply lands while
  on /tasks → badge, toast, sound, tab title; unfocused → OS notification);
  no double-notify when viewing the chat.
- *Verify:* store transition unit tests on synthetic events; RTL provider tests;
  manual dev:mock pass for sound/notification (documented in PR).

**CHECKPOINT C.**

### Phase 6 — Attachments

**T6.1 `feat(chat): attachment upload + serving`**
`POST /chats/:chatId/attachments` (multipart, image/* only, size cap, sanitized
names) → `~/.bakin/chat/attachments/<chatId>/`; GET route with UUID
path-traversal guard; delete-chat sweeps attachments; draft sequencing:
create-chat-then-upload (simplest — draft send creates chat, uploads, sends).
- *Accept:* route tests (happy, wrong-mime, oversize, traversal attempts);
  files land under temp content dir in tests.
- *Verify:* route tests via test-helpers with real FormData Requests.

**T6.2 `feat(chat): send attachments through the runtime`**
`sendMessageBody.attachments`, threading through `startChatTurn`/`runTurn` →
`messaging.stream({attachments})`; core downscale applied >2 MB; composer
attachment UI enabled per `capabilities({agentId}).input.imageInput` (cached);
user attachment thumbnails in transcript replay.
- *Accept:* spec success-criterion 5; unsupported model = hidden/disabled
  affordance with honest tooltip; oversized image downscales transparently.
- *Verify:* stream-bridge tests assert attachment pass-through; RTL composer
  gating tests.

**T6.3 `test(runtime): attachment coverage in mocks`**
Conformance mock: opt-in `imageInput` + attachment echo; imitation-crab `agent`
RPC acknowledges `params.attachments` (echo into reply for e2e assertion).
- *Accept:* conformance suite still green for all adapters; crab-based dev:mock
  demonstrates image round-trip.
- *Verify:* `bun run test` + explicit `bun test tests/dev/` (local ignore quirk).

**CHECKPOINT D.**

### Phase 7 — Search integration

**T7.1 `feat(chat): transcripts in global search`**
`ctx.search.registerFileBackedContentType` over chat JSONLs (`schemaVersion: 1`,
doc: title/agent/recent text), client `hitRenderers` (avatar/title/snippet →
deep-link `/chat?chat=<id>`).
- *Accept:* ⌘K finds a chat by message content in dev:mock; engine-down =
  honest 503 behavior like other surfaces.
- *Verify:* registration/doc-shape unit tests (mocked ctx.search); manual ⌘K pass.

**CHECKPOINT E — bakin complete.** Full suite, `bun run build`, `/verify` e2e,
dev:mock full visual pass. PR-2 opens here.

### Phase 8 — bits migration (bakin-bits-official, PR-3)

**T8.0 `chore: SDK linkage for kit development`**
Point `.build-sdk` at the kit-bearing SDK (local `file:` link during dev; pinned
rc version once published), update `test-sdk/components.js` + `test-sdk/utils.js`
stubs with kit exports (Conversation primitives, `readSseStream`,
`conversationThreadId`, `chunkToConversationMessage`), keep stubs export-complete
for the shared `mock.module` sites. Update `SDK_ENTRYPOINTS`/`CLIENT_EXTERNAL`
only if subpaths changed (goal: none — kit ships under existing `/components`
and `/utils`).
- *Verify:* `bun test` loads; builds run.

**T8.1 `feat(projects): brainstorm on the conversation kit`** *(small)*
`project-detail.tsx` → `ConversationPanel` + kit composer (agent switch via
leading slot / `onAgentChange`); `index.ts` helpers → `conversationThreadId` /
`chunkToConversationMessage`; type alignment (`ProjectBrainstormMessage` ↔
`ConversationMessage`).
- *Accept:* hydration test passes; ask-stream renders tool activity via
  ActivityGroup; agent switching works.
- *Verify:* `project-detail.test.tsx`, `routes.test.ts` updated + green.

**T8.2 `feat(messaging): brainstorm + plan workspace on the kit`** *(large)*
`brainstorm-view.tsx` (transform+extras via kit prop, `proposal` custom events
through `readSseStream` `onCustom`, readOnly archived mode, fitParent/no-header
layout parity with its own proposals side panel) + `plan-workspace.tsx` (minimal) +
`index.ts` server helpers swap.
- *Accept:* proposals still extract/merge/badge; archived sessions read-only;
  two-pane resize unaffected; streaming tests' activity events unchanged on the
  wire.
- *Verify:* `brainstorm-consumer.test.tsx`, `streaming.test.ts` updated + green;
  manual pass in a dev instance with both plugins linked
  (`bakin plugins link` + `BAKIN_DEV_HOTRELOAD=1`).

**CHECKPOINT F — bits green.** Both plugins build, all bits tests green,
linked-plugin visual pass against the PR-2 host. PR-3 merges; installed plugins
rebuilt/upgraded.

### Phase 9 — Deletion + docs (bakin, PR-4)

**T9.1 `refactor(sdk)!: delete IntegratedBrainstorm`**
Remove `src/components/integrated-brainstorm/` + brainstorm util exports + SDK
export entries; prune types (`BrainstormMessage` et al.); confirm no in-repo
consumers remain (grep gate).
- *Accept:* bakin suite + build green; vendor bundle sheds the dead code
  (note size delta).
- *Verify:* full suite; `bun run build`; grep for `IntegratedBrainstorm|readBrainstormSse|brainstormThreadId` returns nothing outside history/docs.

**T9.2 `docs: conversation kit + chat plugin docs sweep`**
`.claude/knowledge/chat-plugin.md` rewrite (v2 schema, attention, attachments,
search); NEW `.claude/knowledge/conversation-kit.md` (turn model, two consumption
modes, embedded API contract, extension points, "session rail promotion" note);
`CLAUDE.md` Chat bullet update; `.claude/knowledge/repo-architecture.md` +
`plugin-system.md` touch-ups; docs site (`docs/src/content/docs/extending/`)
wherever IntegratedBrainstorm/TurnOutputView are referenced; README check
(likely untouched — verify).
- *Accept:* knowledge docs match shipped behavior; no doc references the deleted
  component.
- *Verify:* grep sweep; doc read-through.

**FINAL CHECKPOINT — both repos green, docs true, PR-4 merges.**

---

## 4. Verification matrix (rolls up per checkpoint)

| Gate | A | B | C | D | E | F | Final |
|---|---|---|---|---|---|---|---|
| `bun run test` (bakin) | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `bun run build` (vendors+plugins+binary) | ✓ | — | — | — | ✓ | — | ✓ |
| `/verify` isolated e2e REST drive | — | ✓ | — | — | ✓ | — | ✓ |
| dev:mock visual pass | ✓ (tasks/workflows) | ✓ (chat) | ✓ (attention) | ✓ (attach) | ✓ (full) | ✓ (linked bits) | — |
| `bun test tests/dev/` explicit | — | — | — | ✓ | — | — | ✓ |
| bits `bun test` + plugin builds | — | — | — | — | — | ✓ | ✓ |

## 5. Risks & mitigations

1. **Messaging `proposal` custom-event bridge** breaks silently → contract test in
   T3.4 mirrors the exact bits call site before migration starts.
2. **Runtime break of installed plugins** on SDK deletion → Phase 9 gated on
   Checkpoint F + installed-plugin rebuild; deletion is its own revertable PR.
3. **Vendor bundle growth** (highlighter) → curated language registration only;
   size delta recorded at T1.1 and re-checked at T9.1 (net should shrink after
   IB deletion).
4. **RTL flake on CI 2-vCPU** → every kit test file imports rtl-settle; race-prone
   assertions end with `settleReact()` (per testing rules).
5. **Transcript v2 field drift vs runtime tap payloads** → stream-bridge tests use
   recorded `RuntimeToolActivity` fixtures from both adapters' shapes.
6. **Scope creep in chat page rebuild** → T4.2's accept list is closed; anything
   new goes to the backlog doc.
