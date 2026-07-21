# SPEC — Issue #703: Conversation-kit durable turns + Project plan iteration

**Issue:** [markhayden/bakin#703](https://github.com/markhayden/bakin/issues/703)
**Date:** 2026-07-20
**Status:** Draft — awaiting approval

## 1. Objective

Make every conversational surface in Bakin behave with core chat's reliability, by
extracting chat's turn machinery into ONE shared engine in the SDK conversation kit —
and give the projects plan document real change visibility (bounded version history,
diff view, restore).

Target user: Mark (single-user machine). Priority: reduce tech debt. No backwards
compatibility, no shims — old code paths are deleted once all consumers migrate.

### Root causes being fixed (established by codebase exploration)

| Symptom (issue) | Root cause |
|---|---|
| User message doesn't appear until refresh | `useConversationStream.send()` seeds only agent `liveChunks`; neither the kit nor the containers append the user's message. Server persists it immediately — client never shows it until `onDone` → refetch. |
| Brainstorm dies on navigation | Embedded surfaces run the runtime turn *inside* the per-request SSE response (`ReadableStream.start()`); navigating cancels the fetch, killing the turn. Core chat instead runs turns server-side in a background registry (`plugins/chat/lib/stream-bridge.ts`) and streams over the shared plugin-event bus. |
| No in-progress/completion signal | Projects/messaging/brands have zero nav-badge/attention integration; chat's implementation is chat-private. |
| Plan changes invisible | `applyProjectPlan` overwrites the body in place; no history exists. |

## 2. Locked decisions (from interview, 2026-07-20)

1. **Architecture:** ONE shared conversation turn engine in the SDK kit. **Chat migrates onto it in this effort** — no deferred consolidation.
2. **Chat is behaviorally frozen:** chat is perfect today from a UX standpoint. Its wire contract (event names `chat.chunk/done/error/titled`, payloads, routes, 409/abort semantics, transcript schema v2, files) does not move. `tests/plugins/chat/**` AND `tests/integration/pi/chat-on-pi.test.ts` stay **byte-for-byte unchanged** and green; needing to edit one is a stop-the-line signal that the engine — not the test — is wrong. Where existing coverage is thin (the client hook), NEW characterization tests are written against current behavior BEFORE the refactor and must pass on both sides of it.
3. **Scope:** projects + messaging (bakin-bits-official) AND brands doc-brainstorm (in-repo) all migrate in this initiative. Brands additionally gains a durable transcript (today: component-state only).
4. **Plan edits:** auto-apply incremental changes (additions, checklist ops, section-scoped updates); **confirm before big rewrites** (wholesale body replacement / large deletions). Confirmation is conversational — the agent asks in the thread; no new confirm UI. Messaging keeps its existing proposal side-panel UX.
5. **Plan history:** bounded snapshots (last **20**) in a sidecar, written on **every** body write (agent and manual), each with timestamp + author. UI: current-vs-previous diff toggle with line-level add/remove highlighting, a small history list to view older diffs, one-click **restore** (restore itself snapshots — never destructive).
6. **Notifications:** full chat parity for projects + messaging brainstorms — working-dot + unread nav badges, and toast + chime + OS notification when a turn completes while the user is elsewhere; viewing marks seen. Built as a generalized attention helper in the kit. (Brands: badges/notifications not required — embedded drawer surface; engine events make adding it later trivial.)
7. **PR strategy:** 2 PRs, staged live-test. PR 1 (bakin): engine + attention helper + chat migration + brands migration — live-tested and approved on 3737 **before** PR 2 merges. PR 2 (bakin-bits-official): projects + messaging migrations + plan history. Checkpoint commits inside each PR (detailed strategy in PLAN.md).

## 3. Design

### 3.1 Server: conversation turn service (the engine)

New server-only module `packages/core/src/conversation/turn-service.ts`,
surfaced to plugins as a context service (`ctx.conversations`, typed in both
`PluginContext` definitions). NOT an SDK export: every SDK sub-path is a
browser vendor bundle, and the engine needs `crypto`/media/logger — server
internals that must never ride into the browser or into per-plugin server
bundles. Core plugins (chat) may import the core module directly.

Factory shape (generalization of `plugins/chat/lib/stream-bridge.ts`, code lifted
nearly verbatim):

```ts
const turns = createConversationTurnService({
  ctx,                        // events.emit + runtime access
  events: { chunk: 'chat.chunk', done: 'chat.done', error: 'chat.error' }, // per-consumer names
  store: { append(threadKey, rows), … },   // consumer-owned transcript persistence
  threadId: (key) => string,               // runtime threadId scheme
  hooks?: { meter?, onSettle?, … },        // chat's metering/auto-title thread through here
})
turns.start(key, { agentId, content, attachments? })  // 'started' | 'busy'
turns.abort(key)
turns.isInFlight(key)
```

Preserved verbatim from stream-bridge (load-bearing):
- **Synchronous slot reservation** before any await (TOCTOU close) — one in-flight turn per thread key, `busy` → HTTP 409.
- **Incremental persistence** via `createTurnRecorder.drain()` per chunk — crash/navigation keeps partial replies.
- Abort → clean `done` with `aborted` marker row; typed `RuntimeError` kinds on `error` events (never message-text classification).
- Turn runs detached from any HTTP request; POST returns 202 immediately.

Consumers and their event namespaces:
- chat: `chat.*` (unchanged wire contract), store = existing chat transcript store, metering + auto-title via hooks.
- projects: `projects.brainstorm.*`, store = existing `<id>.brainstorm.json` repo helpers.
- messaging: `messaging.brainstorm.*`, store = session JSON — **gains incremental persistence** (today assistant text persists only after stream completion; custom `proposal`/`plan_update` events ride the engine's custom-event extension point).
- brands: `brands.brainstorm.*`, **new** durable transcript sidecar per draft doc.

### 3.2 Client: one embedded-surface hook

`useConversationStream` is **replaced** by a bus-driven hook (working name
`useConversationThread`) modeled on chat's `useChatStream` (`plugins/chat/components/use-chat-data.ts`):

- **Optimistic append:** user row (+ attachments) appended to local messages synchronously before the POST; `streaming`/`liveChunks` seeded immediately. Failure → optimistic row marked failed / send error surfaced.
- **Bus transport:** subscribes to the consumer's `*.chunk/done/error` plugin-events via `usePluginEvent` (shared SSE connection) — events arrive regardless of which page is mounted.
- **Rehydration:** on mount/thread-switch, refetch the durable transcript (includes incrementally-persisted partial rows) + seed `streaming` from a server-provided in-flight flag; subsequent chunks resume accumulation. No unmount cleanup needed — turns are server-owned.
- Custom events (messaging proposals) via an `onEvent` extension.

`ConversationPanel` stays presentational/controlled (unchanged contract where possible).
Chat's `useChatStream` becomes a thin wrapper over the same hook logic or migrates to
it outright — whichever leaves chat's observable behavior identical (chat tests decide).

**Deleted after migration** (no shims): per-request streaming in
`use-conversation-stream.ts`, client `sse.ts` reader (`readConversationSseStream`),
and the per-request SSE response paths in all four consumers' routes.

### 3.3 Attention/badge helper

Generalize chat's attention rules (`plugins/chat/components/attention.ts` +
`chat-badge-provider.tsx`) into a kit helper: pure rules
(`attentionForDone`-style: viewing → mark seen; elsewhere → toast + chime + OS
notification; aborted → nothing) + a provider building block over
`useNavBadge`/`usePluginEvent`. Chat's provider refactors onto it (behavior
identical); projects and messaging mount their own providers in the
`nav-badge-providers` slot (declared in their manifests) with per-surface seen
tracking and deep links to the owning page.

### 3.4 Plan document history (projects)

- Sidecar `<projectId>.history.json` beside the plan markdown: array of `{ ts, author: 'agent' | 'user', body }`, capped at 20 (oldest dropped). Written by every body-mutating path (`applyProjectPlan`, manual `PUT /:projectId` when body changed, restore).
- REST: history list + restore endpoints on the projects plugin; restore pushes current body as a snapshot first.
- UI (project detail): "Changes" toggle rendering a line-level diff (small hand-rolled LCS line diff — no new dependency) of current vs previous by default, selectable against any stored snapshot; add/remove highlighting; restore button per snapshot (ConfirmDialog flow).
- Exec tool surface: no new agent tools — history is a UI/user affordance; the agent's safety net is that every edit is visible and revertable.

### 3.5 Brainstorm prompt changes (projects)

Rewrite `PROJECT_BRAINSTORM_INSTRUCTIONS` (`bakin-bits-official/plugins/projects/index.ts`):
the plan document is the primary working artifact — create it if missing, keep it
current as the conversation evolves, apply incremental edits directly via
`bakin_exec_projects_apply_plan` (+ item tools) and report what changed; ask
conversationally before wholesale rewrites or large deletions of existing content.
Keep the near-duplicate context assembly in the `bakin_exec_projects_ask` exec tool
in sync (same instructions block — single shared constant).

## 4. Acceptance criteria (mapped to issue)

- [ ] Sending a message on ANY conversational surface (chat, projects, messaging, brands) renders the user's text immediately — no refresh. (Issue AC 1)
- [ ] Navigating away mid-turn on projects/messaging/brands: the turn completes server-side; returning shows the full (or partial-in-progress) reply; partial replies survive server restarts up to the last drained row. (AC 2)
- [ ] Projects + messaging nav items show working-dot while a turn is in flight and unread state after completion; completion while elsewhere fires toast + chime + OS notification; viewing marks seen. (AC 3)
- [ ] Projects brainstorm applies incremental plan edits directly and reports them; asks conversationally before big rewrites. (AC 4)
- [ ] Plan detail exposes current-vs-previous diff with add/remove highlighting, a ≤20-entry history, and snapshot restore. (AC 5)
- [ ] **Chat regression gate:** `tests/plugins/chat/**` pass unmodified; live chat session on 3737 verified indistinguishable from today (send, stream, abort, 409, badges, toast/chime/OS, auto-title, attachments).
- [ ] Old per-request streaming path fully deleted from kit + all consumers; no dual engines remain.

## 5. Testing strategy

- **Chat:** existing suite frozen (the gate). No new chat tests unless net-new engine seams need pinning — added as new files, never edits.
- **Engine (new, bakin):** lifecycle tests mirroring `tests/plugins/chat/stream.test.ts` shapes against a mock consumer — TOCTOU, 409, abort partials, incremental drain, typed errors, event emission, detachment from request lifecycle.
- **Kit client (new, bakin):** optimistic append (incl. failure rollback), bus-driven chunk accumulation, remount rehydration with in-flight seeding — the exact gaps `conversation-panel.test.tsx` documents as untested today.
- **Brands (bakin):** migrated surface — durable transcript, optimistic echo.
- **Projects/messaging (bits):** container tests updated for the new hook; route tests move from SSE-frame assertions to 202 + bus-event + persistence assertions; messaging incremental-persistence pinned; plan history unit tests (cap, author attribution, restore-snapshots-first) + diff component tests; prompt constant pinned (single shared constant asserted used by both assembly sites).
- All standard repo rules apply (content-dir + OpenClaw-home mocks, `--isolate`, rtl-settle, etc.).
- **Live verification:** staged — PR 1 live-tested (chat parity + brands) before PR 2; PR 2 live-tested (projects + messaging flows, navigation mid-turn, badges/notifications, plan history) before merge. Server is currently down; live tests run a dev server from the branch on 3737 per the standing test-live-before-merge flow.

## 6. Boundaries

**Always:**
- One engine, one client hook, one attention rule set — every consumer composes them.
- Delete superseded code in the same initiative (per-request stream path, duplicated container wiring).
- Update knowledge docs with the code they describe (see §7).
- Bump touched bits plugin manifest versions in PR 2 (patch/minor per change size).

**Ask first:**
- Any change that would require editing a chat test or chat wire contract.
- Any scope growth beyond the four surfaces + plan history (e.g. new chat features, messaging plan-doc history).

**Never:**
- Backwards-compat shims or parallel old/new paths left alive.
- Error classification by message text; silent drops of turns or events.
- Touching `bakin-bits-official-private` (stale snapshot) — active repo is `bakin-bits-official`.
- Editing `~/.openclaw` / production `~/.bakin` from tests (standard mocks mandatory).

## 7. Documentation impact

- `.claude/knowledge/conversation-kit.md` — rewrite: engine, bus transport, hook, deleted per-request path.
- `.claude/knowledge/chat-plugin.md` — stream-bridge → engine consumption; behavior unchanged.
- `.claude/knowledge/messaging-plugin.md` (+ bits-repo docs if present) — new turn flow, incremental persistence.
- `.claude/knowledge/brands-plugin.md` — doc-brainstorm durability.
- CLAUDE.md "Conversation Kit & Chat" bullet — engine as the new single-engine fact.
- README.md — checked; only touched if it references the old behavior (not expected).
- Bits repo: projects plugin docs/README for plan history + prompt posture.

## 8. Out of scope

- Full document management (branching, named versions, >20 history, merge UI).
- Chat UX changes of any kind.
- Messaging plan-workspace version history (projects-only per issue).
- New agent-facing exec tools for history.
- SDK v* release mechanics (bits CI red on unpublished SDK is a standing, accepted condition).
