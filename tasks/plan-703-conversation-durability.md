# PLAN — Issue #703: Shared conversation turn engine + plan iteration

Companion to `spec-703-conversation-durability.md`. Tasks are vertical slices; every task has acceptance criteria
and a verification step. Commit boundaries ARE the rollback checkpoints.

## Dependency graph

```
[E1 engine (server)] ──► [C1 chat server swap] ──► [C2 chat client swap]
[E2 hook (client)]  ──┘                             │
[E3 attention kit]  ──► [C3 chat attention swap]    │
        │                                           ▼
        └────────► [B1 brands migration]  (proves embedded mode, PR 1)
                            │
                            ▼  (PR 1 live-approved on 3737)
[P1 projects server] ► [P2 projects client] ► [P3 projects badges]
[P4 plan history]    ► [P5 diff/restore UI]
[P6 prompt rewrite]
[M1 messaging server] ► [M2 messaging client + badges]
                            │
                            ▼  (PR 2 live-approved)
[Z1 delete legacy path + final docs]   (PR 3, bakin — trivial, mechanical)
```

**PR 3 — DECIDED (Mark approved 2026-07-20).** Historical framing below kept for the record. NOTE for readers: config shapes in this plan are PRE-BUILD working names (store.append→appendRow, makePayload→payload, onSettle→onSettled); the engine landed at `src/core/conversation-turns.ts` (not packages/core) with tests at `tests/core/conversation-turns.test.ts` — the SDK contract in `packages/sdk/src/types/conversation-turns.ts` is the reference, not this sketch. Original deviation note:
deleting the per-request stream path (`useConversationStream` + client `sse.ts`)
from the SDK before the bits plugins migrate would break the installed
projects/messaging plugins at runtime (they load the SDK from the running
server's vendor bundles). The deletion must land AFTER PR 2. Proposal: a third,
tiny, purely-mechanical **PR 3** (delete dead path + final doc pass). Alternative
(not recommended): fold deletion into PR 1 and accept that the bits working tree
must sit on its migrated branch from PR 1 merge onward — a hidden cross-repo
coupling with no checkpoint.

## Engine design notes (binding for the build phase)

**Engine delivery: ctx service, NOT an SDK export.** Verification finding:
`@makinbakin/sdk/utils` is one of the browser vendor bundles
(`scripts/build-vendors.ts` `SDK_VENDOR_TARGETS`) — `createTurnRecorder` passes
only because it is pure. The engine needs `crypto`, core media downscale, and
the server logger; exporting it from any vendored SDK sub-path would drag
server internals into the browser bundle (or break the vendor build), and
user-plugin server bundles would each re-bundle their own engine copy. Instead:
the engine lives in `packages/core/src/conversation/turn-service.ts`
(server-only), is typed in BOTH `PluginContext` definitions
(`packages/core/src/plugin-types.ts` + `packages/sdk/src/types/context.ts`),
and reaches plugins as a context service (working name `ctx.conversations`).
Chat's `stream-bridge.ts` facade imports the core module directly (core plugin
privilege) so its exported signatures — `startChatTurn(ctx, …)`,
`abortChatTurn`, `isTurnInFlight`, `waitForTurn`, `resolveActiveTurnForAgent`,
`CHAT_TURN_FRAMING` — stay identical for every existing importer
(`plugins/chat/index.ts`, `plugins/chat/lib/routes.ts`, and the four frozen
test files that import the bridge directly).

Parameterization of `plugins/chat/lib/stream-bridge.ts` → core
`turn-service.ts`. Consumer config:

- `resolveThread(key) → { agentId } | null` (chat: `getChatSummary`)
- `store.append(key, row)` (chat: `appendTranscriptRow`)
- `events: { chunk, done, error }` names + `makePayload(key)` base payload
  (chat: `{ chatId }` — wire frozen; projects: `{ projectId }`; messaging:
  `{ sessionId }`; brands: `{ brandId, doc }`)
- `framing?: string` appended to content (chat: `CHAT_TURN_FRAMING`)
- `threadId(key) → string` (chat: `` `chat:${key}` ``; embedded:
  `conversationThreadId(...)`)
- hooks: `onChunk?(key, chunk)` (messaging proposal parsing),
  `meter?(key, agentId, turnId, usage)` (chat's `meterChatTurn`; brainstorms
  gain metering under work class `chat` — today they're unmetered, a standing
  cost-attribution gap this closes), `onSettled?(key, outcome)` (chat
  auto-title), attachments prepare/cleanup kept in-engine (verbatim from
  bridge).

Preserved VERBATIM (load-bearing — full inventory from the stream-bridge read,
each one chat-UX-observable):
- synchronous slot reservation before any await (TOCTOU); busy → 409
- `recorder.drain()` persistence per chunk; crash keeps the partial turn
- `persist()` NEVER throws (chat deleted mid-turn: log + continue)
- user-row append failure → slot release + `not_found` (route 404)
- attachment-only sends get the visible "See the attached image." placeholder
- attachments prepared (downscale shim) before the stream, cleaned in `finally`
- only `text|tool|status` chunks ride the chunk event — `done`/`error` never do
- `StreamTurnError` typed-kind carry → durable row `errorKind` + event `kind`
- abort → clean done, `aborted: true` payload flag, `aborted` marker row
- done payload preview = `firstLine(assistantText)` clipped to 140
- metering runs even for aborted turns; usage-less done still records; runId
  `chat:<chatId>:turn:<turnId>`, workClass `chat`, activityClass `user`
- slot releases BEFORE auto-title chains (holding it 409'd quick follow-ups);
  errored/aborted turns skip auto-title
- `resolveActiveTurnForAgent` ambiguity-is-null (engine `listInFlight()`; chat
  keeps its hook on top)

Client: kit `useConversationThread` generalizes `useChatStream`'s core
(optimistic append + failure rollback, bus subscription + text-delta coalescing,
active-thread ref guards incl. post-body-read re-check, settle → refetch,
settle-while-viewing mark-seen callback, server-seeded `streaming` flag).
Chat-specific concerns (seen POST + synthetic `chat.seen` after the write
lands, retry incl. attachments, attachment URL mapping, capability probe) stay
in chat's wrapper.

**Client gate is weak — characterization tests are mandatory before the swap.**
Verification finding: `chat-page.test.tsx` has exactly ONE `ChatView` test
(transcript render + seen-on-mount). Nothing pins optimistic append,
coalescing, settle/refetch, sendError, or retry at the client layer, so
"frozen tests green" alone cannot protect C2. Task C2a (below) writes NEW
characterization tests against the CURRENT `useChatStream` first (adding test
files is allowed — the freeze forbids edits, not additions); they must pass
before AND after the reimplementation.
`plugins/chat/components/attention.ts` becomes a facade over kit rules
(module-facade pattern, same as `src/core/*` over `packages/core` — NOT a compat
shim) so `tests/plugins/chat/attention.test.tsx` stays byte-identical.

---

## PR 1 — bakin: engine + chat + brands (branch `feat/703-conversation-turn-engine`, MAIN checkout so 3737 serves it)

### E1. `feat(sdk): conversation turn service` — commit 1
Kit `turn-service.ts` (extraction per notes above) + lifecycle tests against a
mock consumer, mirroring `tests/plugins/chat/stream.test.ts` shapes: TOCTOU
double-send, busy result, abort partial + marker row, incremental drain
persistence, typed error kind, event emission w/ custom payload, detachment
from request lifecycle, `listInFlight` ambiguity.
**AC:** engine tests green; zero existing files touched.
**Verify:** `bun test tests/sdk/turn-service.test.ts --isolate` + full suite.
**Rollback:** revert commit — nothing depends on it.

### E2. `feat(sdk): useConversationThread hook` — commit 2
Kit client hook + tests: optimistic user append (with attachments) + rollback on
failed POST, chunk accumulation/coalescing, thread-switch guard, remount
rehydration with seeded `streaming`, custom event forwarding.
**AC:** hook tests green; `ConversationPanel` contract untouched.
**Verify:** targeted tests + full suite.

### E3. `feat(sdk): attention rules + badge provider kit` — commit 3
Extract pure rules (viewing→seen / elsewhere→toast+chime+OS / aborted→nothing,
`badgeFor`, title prefix) into the kit; provider building block over
`useNavBadge`/`usePluginEvent`. New kit tests.
**AC:** kit tests green; chat untouched (swap is C3).

### C1. `refactor(chat): server turns on the shared engine` — commit 4
`stream-bridge.ts` reduced to the chat consumer config + chat-specific exports
(`CHAT_TURN_FRAMING`, `resolveActiveTurnForAgent`, `waitForTurn`, etc. as
facades over the engine instance). Routes untouched.
**AC / GATE:** `tests/plugins/chat/**` byte-for-byte unchanged, all green.
**Verify:** `git diff --stat tests/plugins/chat` is empty; full suite.
**Rollback:** revert commit — engine (E1) stays, chat returns to private bridge.

### C2a. `test(chat): characterize useChatStream` — commit 5
NEW test file pinning current client behavior before any change: optimistic
user row (with attachment URLs) appended synchronously pre-POST; failed POST →
rollback of streaming state + sendError from body; chunk coalescing rule
(same-format text deltas merge); cross-chat event guard; settle on done/error →
refetch + mark-seen; retry re-sends content AND attachments; rehydration seeds
from server `streaming` flag. Passes against the UNTOUCHED hook.
**Rollback:** none needed — additive tests only.

### C2b. `refactor(chat): client on useConversationThread` — commit 6
`useChatStream` reimplemented as a thin wrapper (seen/retry/attachments/probe
stay chat-side).
**AC / GATE:** C2a characterization tests + all frozen chat tests green,
unchanged.

### C3. `refactor(chat): attention facade over kit rules` — commit 7
`attention.ts` re-exports kit rules; `chat-badge-provider.tsx` on the kit
building block.
**AC / GATE:** `attention.test.tsx` unchanged + green.

### B1. `feat(brands): durable doc brainstorm` — commit 8
Server: brainstorm route → engine (`brands.brainstorm.*` events, 202 + 409),
transcript sidecar per draft doc, GET returns transcript + streaming flag.
Client: `brand-doc-brainstorm.tsx` on `useConversationThread`.
New tests (durability, optimistic echo, rehydration). Old per-request path left
in place (still exported — see Z1).
**AC:** brands brainstorm survives navigation; transcript durable.
**Verify:** brands tests + full suite.

### D1. `docs(knowledge): conversation kit engine docs` — commit 9
Update `.claude/knowledge/conversation-kit.md`, `chat-plugin.md`,
`brands-plugin.md`. README checked (no changes expected).

### ✅ PR 1 GATE (before PR 2 merges)
- Full suite green (`bun run test`).
- `git diff main --stat -- tests/plugins/chat tests/integration/pi/chat-on-pi.test.ts`
  → empty (the pi integration test imports the bridge directly — it is part of
  the freeze perimeter).
- **Live on 3737 (Mark):** chat indistinguishable from today — send/stream/
  abort/409/badges/toast/chime/OS/auto-title/attachments; brands brainstorm
  survives navigation. Kill dev server + verify port free afterward.

---

## PR 2 — bakin-bits-official: projects + messaging (branch `feat/703-brainstorm-durability`)

### P1. `feat(projects): brainstorm turns on the shared engine` — commit 1
`/ask` handler → 202 + engine (`projects.brainstorm.*`, store = existing
`.brainstorm.json` helpers, metering hook workClass `chat`); 409 when busy;
abort route; GET `/:projectId` gains `brainstormStreaming`. Route tests
rewritten (bits tests are editable): 202 + bus events + persistence replace
SSE-frame assertions.
**Rollback:** revert — client (P2) not yet swapped, old client still works? NO —
old client expects SSE frames. P1+P2 are one checkpoint pair; commit separately
for review clarity but treat P1..P2 as the atomic rollback unit.

### P2. `feat(projects): brainstorm client on useConversationThread` — commit 2
`project-detail.tsx` wiring: optimistic echo, bus streaming, rehydration on
return, abort. Component tests for the #703 symptoms (message visible on Enter;
transcript restored with partial rows).

### P3. `feat(projects): nav badge + attention provider` — commit 3
Manifest declares `nav-badge-providers`; provider on kit building block
(working dot in-flight, unread after done, toast+chime+OS elsewhere, seen on
project-brainstorm view, deep link). Seen state persisted plugin-side.

### P4. `feat(projects): plan history + restore (server)` — commit 4
`<id>.history.json` sidecar (cap 20, `{ts, author, body}`), written by
`applyProjectPlan`, body-changing `PUT`, and restore (restore snapshots current
first). REST: `GET /:id/history`, `POST /:id/history/:index/restore`.
Unit tests: cap, attribution, restore ordering, no-op writes don't snapshot.

### P5. `feat(projects): plan diff + history UI` — commit 5
"Changes" toggle: hand-rolled LCS line diff (added/removed highlighting),
default current-vs-previous, snapshot picker, restore via ConfirmDialog
(whole flow in the modal). Component + diff-util tests.

### P6. `feat(projects): plan-first brainstorm instructions` — commit 6
Rewritten `PROJECT_BRAINSTORM_INSTRUCTIONS` (auto-apply incremental / confirm
big rewrites, per SPEC §3.5) as ONE shared constant used by both `/ask` and the
`bakin_exec_projects_ask` tool; test pins both call sites use it.

### M1. `feat(messaging): brainstorm turns on the shared engine` — commit 7
Sessions route → engine: `messaging.brainstorm.*` events, `onChunk` hook does
the proposal/plan_update parsing (now emitted as bus events), **incremental
assistant persistence** (closes the lost-interrupted-reply gap), 202/409/abort,
session GET seeds `streaming`. Route tests rewritten; incremental persistence
pinned. (M1+M2 = atomic rollback unit, same as P1+P2.)

### M2. `feat(messaging): brainstorm client + attention provider` — commit 8
`brainstorm-view.tsx` on `useConversationThread` (proposals via bus events),
badge/attention provider, seen tracking.

### V1. `chore: bump plugin manifest versions` — commit 9
projects + messaging manifests (minor — behavior additions).

### ✅ PR 2 GATE
- Bits suite green (`bun run test` in bits repo — preload rule).
- **Live on 3737 (Mark), server running PR 1 code:** full #703 acceptance walk —
  optimistic echo both surfaces; navigate away mid-turn and return (partial then
  complete reply); badges + toast/chime/OS; plan auto-edit + conversational
  confirm on a big rewrite; diff toggle; restore.

---

## PR 3 — bakin: delete legacy path + final docs (branch `chore/703-remove-per-request-stream`)

### Z1. `refactor(sdk)!: remove per-request conversation streaming` — commit 1
Delete `use-conversation-stream.ts`, client `sse.ts` reader, their SDK exports,
and their tests; prune `conversation-panel.test.tsx` stream cases. Repo-wide
grep proves zero remaining imports.

### Z2. `docs: final knowledge + CLAUDE.md pass` — commit 2
`messaging-plugin.md`, CLAUDE.md "Conversation Kit & Chat" bullet (engine as
the single-engine fact), knowledge-doc sweep for stale per-request references.
Remove `spec-703-conversation-durability.md` + `tasks/` working files (or park in `.claude/specs/` if Mark
wants them kept — ask at gate).

### ✅ PR 3 GATE
Full suite green; live smoke of chat + one brainstorm on 3737.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Chat behavior drift during extraction | Frozen tests as gate (C1–C3); verbatim-preservation list; live parity session before PR 2 |
| TOCTOU regression | Slot reservation moved as-is; engine test replicates the double-send race |
| SDK export deletion breaks installed bits plugins | Deletion deferred to PR 3, after bits migrates (the PR-count deviation) |
| Messaging proposal parsing breaks in engine world | `onChunk` hook designed for it; M1 pins proposal events in tests |
| Metering double-count or miss on brainstorms | New metering follows chat's `meterAgentTurn` shape; runId scheme `brainstorm:<plugin>:<key>:turn:<id>` distinct from chat's |
| Live-test window leaves dev server squatting 3737 | Standing rule: kill + verify port free before ending sessions |

## Standing rules honored
- Branch in MAIN checkouts (both repos); Mark live-tests before every merge.
- `bun run test` (never bare `bun test`) in bits repo; `--isolate` everywhere.
- Content-dir + OpenClaw-home mocks in every new test file; rtl-settle for RTL.
- Never touch `bakin-bits-official-private`, `~/.openclaw`, or generated-version.ts.
- Conventional commits with scope; bits manifest version bumps in-PR.
