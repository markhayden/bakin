# Discord Bridge + Inbound Chat — Plan

Spec: `.claude/specs/discord-bridge/SPEC.md` (approved 2026-07-26)
Tracking: `.claude/specs/discord-bridge/TODO.md`

## 1. Dependency graph

```
A0 compile spike (de-risk @discordjs/ws under bun build --compile)
 └─ A1 neutral ChannelBridge contract + AdapterInitOpts.channelBridge
     ├─ A2 settings.integrations + config module + System & Alerts fields
     │   └─ A3 discord client lifecycle (boot gating, channel cache, teardown)
     │       ├─ A4 send surface (messages/embeds/content/threads/edits/DM/
     │       │      chunking/retry/oversize fallback) + audit + idempotency
     │       └─ A5 approvals (cards, buttons, modal, allowlist,
     │              ApprovalResolveEvent)
     └─ A6 adapter-pi delegation + 'shimmed' capability + conformance pin
         (needs A1 types; integrates A3–A5 behavior)
A7 doctor check + Integrations & Keys token entry   (needs A2, A3)
A8 docs sweep + §10.1 superseded marker             (needs A1–A7 settled)
── CHECKPOINT: PR 1, live validation, owner merge ──
B1 inbound contract member + bridge gating (mention/allowFrom/attachments)
 └─ B2 chat plugin wiring (channel↔chat map, turn engine, reply, typing)
     └─ B3 docs + close-out (#669 comment, knowledge updates)
── CHECKPOINT: PR 2, live validation, owner merge ──
```

Phase B touches only additive surfaces (one optional contract member, chat
plugin wiring) — reverting PR 2 leaves Phase A fully functional. That is the
deliberate rollback seam.

## 2. Commit strategy (rollback checkpoints)

- **Branch discipline:** work happens on `feat/discord-bridge` (Phase A) and
  `feat/discord-inbound-chat` (Phase B, branched after PR 1 merges) —
  **in the main checkout** so the dev server serves the branch for live
  testing (standing rule: owner tests live before any merge).
- **One task = one conventional commit**, listed per task below. Every commit
  passes the full gate before it lands: `bun run typecheck && bun run lint &&
  bun run test && bun run check:cycles`. No WIP commits — each commit is a
  self-consistent rollback point.
- **Ordering guarantees greenness:** contract/types first (A1), config next
  (A2), then behavior (A3–A5), then integration (A6) — at every commit the
  tree builds, tests pass, and the bridge is inert unless configured.
- **Rollback ladder:** single bad commit → `git revert <sha>` (commits are
  vertical and independent within their layer); bad phase → revert the phase
  PR merge commit; Phase B revert never degrades Phase A.
- **Never committed:** `generated-version.ts` mutations from builds; secrets;
  `~/.bakin` state.
- **PRs:** two, one per phase (mirrors pi-parity D14). PR bodies carry the
  live-validation checklist results.

## 3. Phase A — Delivery bridge

### A0 — Compile spike (de-risk, throwaway)
Prove `@discordjs/core`+`@discordjs/ws`+`@discordjs/rest` (no optional
native deps) connects and receives INTERACTION_CREATE under a
`bun build --compile` binary, in the scratchpad (not the repo).
- **Accept:** compiled scratch binary connects to the gateway with the real
  token, logs READY, exits clean. Documented result (works / needs the
  raw-WebSocket fallback from SPEC D2).
- **Verify:** run the scratch binary once; no repo changes.
- **Commit:** none (scratchpad only). If the fallback is needed, SPEC D2 is
  amended BEFORE A3 proceeds.

### A1 — Neutral ChannelBridge contract
`packages/core/src/delivery/bridge.ts`: `ChannelBridge` interface =
`isConfigured()` + the full `channels` surface shape (reusing the existing
concepts types verbatim) + `boot()`/`shutdown()`. Add optional
`channelBridge?: ChannelBridge` to `AdapterInitOpts`
(`packages/core/src/adapters/shared.ts`). Types only, no behavior.
- **Accept:** typecheck green; no adapter consumes it yet; no Discord
  identifiers in `packages/core` (arch test still green untouched).
- **Verify:** `bun run typecheck && bun run test tests/architecture/ --isolate`
- **Commit:** `feat(core): neutral ChannelBridge contract + AdapterInitOpts slot`

### A2 — Config + settings
`BakinSettings.integrations` (type, defaults, normalizer — CSV→string[] for
guildIds/approvers/allowFrom) in `packages/core/src/settings.ts`;
`src/core/delivery/config.ts` (`readDiscordConfig()`, `isConfigured()` =
enabled && token && guildIds.length, token via
`getStoredSecret('discord','botToken')` — never env); System & Alerts fields
in `src/components/system-settings.ts` (list fields as comma-separated
strings, unflattened to arrays by the normalizer).
- **Accept:** settings round-trip via `/api/settings` preserves the shape;
  settings.json stays secret-free; unit tests for normalizer + isConfigured
  (temp-dir mocked per testing rules).
- **Verify:** `bun test tests/core/settings*.test.ts tests/core/delivery/config.test.ts --isolate` + gate
- **Commit:** `feat(delivery): settings.integrations.discord + config module`

### A3 — Discord client lifecycle
Add deps (root package.json; NO zlib-sync/bufferutil/utf-8-validate).
`src/core/delivery/discord/client.ts`: REST + gateway (intents GUILDS,
GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT), reconnect via
@discordjs/ws defaults, guild text-channel cache (D3) with on-demand
refresh, DM-channel resolution, clean `shutdown()`.
`src/core/delivery/index.ts`: singleton `getDeliveryBridge()`,
`bootDeliveryBridge()` gated per D11 (configured AND active runtime
delivery !== 'native'), wired in `server.ts` after `createAppServices()`;
teardown joins `registerShutdownHandlers`. Arch-test allowlist for
`src/core/delivery/` + new pin banning discord identifiers outside it +
`.claude/hooks/check-adapter-boundary.mjs` allowlist.
- **Accept:** server boots with bridge unconfigured (no-op, zero Discord
  imports evaluated at startup cost paths); configured+mocked client boots
  and tears down cleanly; arch tests prove confinement bites (teeth case).
- **Verify:** `bun test tests/core/delivery/ tests/architecture/ --isolate` + gate
- **Commit:** `feat(delivery): discord client lifecycle + boot gating + confinement`

### A4 — Send surface
`src/core/delivery/discord/send.ts` + `audit.ts`: sendMessage /
sendNotification (severity-colored embeds) / deliverContent (asset refs →
uploads; oversize → Bakin link) / createThread / editMessage; 2000-char
chunking; `discord:user:<id>` DMs; bounded retry with backoff →
`delivery.send_failed` audit; ledger idempotency keys on retryable send
paths; `delivery.sent` + lifecycle audit events.
- **Accept:** unit tests against a mocked REST layer cover every method,
  chunking edge (2000/2001 chars), oversize fallback, DM ref, retry-then-
  fail audit, idempotent re-send (ledger row suppresses duplicate).
- **Verify:** `bun test tests/core/delivery/ --isolate` + gate
- **Commit:** `feat(delivery): discord send surface with retry, DMs, audit`

### A5 — Approvals
`src/core/delivery/discord/approvals.ts`: buttoned card (embed + approve/
reject components + Review-in-Bakin link), INTERACTION_CREATE subscription,
approver allowlist fail-closed (ephemeral deny + `delivery.approval_denied`),
reject modal (reason required per `requireRejectReason`), MODAL_SUBMIT →
`ApprovalResolveEvent`, ack + disable buttons, editApproval/cancelApproval/
resolveApproval semantics against rendered cards.
- **Accept:** unit tests: card render shape, unauthorized click denied +
  audited, approve → event with actor, reject → modal → event with reason,
  restart survives (custom_id carries approvalId; no in-memory dependency
  for button resolution), stale click (record resolved) acked without event
  side effects beyond the existing consumer contract.
- **Verify:** `bun test tests/core/delivery/ --isolate` + gate
- **Commit:** `feat(delivery): discord approval cards, modal reject, allowlist`

### A6 — adapter-pi delegation + conformance
`packages/adapter-pi/src/runtime.ts`: `channels` present iff
`channelBridge?.isConfigured()` (pure delegation);
`capabilities().delivery.mode` = `'shimmed'`/`'unavailable'` accordingly;
`credentialStatus().channels` reflects it. `src/core/app-services.ts`
threads the bridge handle into `AdapterInitOpts` (handle only — no boot).
Conformance: extend `conformance.ts` with `'shimmed'` ⇒ surface-present +
teeth case; mock-runtime helpers updated (shimmed variant).
- **Accept:** conformance suite green across mock/Pi/OpenClaw-mock; teeth
  file proves the new check bites; integration test: configured fake bridge
  ⇒ Pi exposes channels + shimmed; unconfigured ⇒ member absent +
  unavailable; workflows gate round-trip test against the fake bridge
  emitting `ApprovalResolveEvent` (existing `wireChannelApprovals` path,
  zero consumer changes proven).
- **Verify:** `bun test tests/integration/runtime-conformance/ tests/adapter-pi/ tests/plugins/workflows/channel-approvals.test.ts --isolate` + gate
- **Commit:** `feat(adapter-pi): runtime.channels by bridge delegation (shimmed)`

### A7 — Doctor + token UX
`delivery.discord` health check (owner-registered, class-stamped):
configured-no-token / gateway-down / approvals-alias-unknown-channel /
enabled-but-empty-allowlists (fail-closed notice) / double-handling copy.
Integrations & Keys tab: Discord Bot Token entry (existing masked
`/api/secrets` plumbing).
- **Accept:** check registered + surfaces in `bakin check all` and Health;
  unknown states honest (engine down ≠ healthy); token entry saves via
  existing endpoint; component test for the new tab entry.
- **Verify:** `bun test tests/plugins/health/ tests/components/provider-keys-tab.test.tsx --isolate` + gate
- **Commit:** `feat(health): delivery.discord doctor check + token entry`

### A8 — Docs sweep (Phase A)
New `.claude/knowledge/delivery-bridge.md`; fix stale `pi-adapter.md:52`
row; touch `runtime-capabilities.md`, `workflow-approvals.md`; CLAUDE.md
architecture bullet + settings shape; README feature-list check; mark
pi-parity SPEC §10.1 superseded-by this spec.
- **Accept:** every doc claim matches shipped behavior; no doc references
  unshipped Phase B behavior as current.
- **Verify:** re-read each changed doc against the code; gate.
- **Commit:** `docs(knowledge): delivery bridge architecture + corrections`

### CHECKPOINT 1 — Live validation + PR 1
Runbook (extends `docs/validation/gate-discord-runbook.md` pattern):
token copied to secret store via UI; settings configured via System &
Alerts; OpenClaw daemon STOPPED (double-handling precondition); server
restart; then: gate card round-trip (approve), reject-modal round-trip
(reason lands in the durable record + decision summary edit), unauthorized
click (second account or empty-allowlist probe), watchdog/budget notify
send, `bakin_exec_post_channel`, DM send, oversize asset fallback, restart
idempotency (no double-post), `bakin check all` clean.
- Owner tests live on 3737 from the branch. PR 1 after sign-off:
  `feat(delivery): Discord delivery bridge for shimmed runtime channels (#669)`.

## 4. Phase B — Inbound chat

### B1 — Inbound contract + bridge gating
`channels.subscribeInboundMessages?(handler)` + neutral
`InboundChannelMessage` (platform, channelRef, threadRef?, authorId,
authorName, text, attachments?, messageRef) in concepts; bridge
MESSAGE_CREATE handling: mention gate (guild) / allowFrom gate (fail
closed) / self-message + bot filter; denied senders audited
(`delivery.inbound_denied`), never answered; image attachments resolved to
temp files for the event; Pi delegates; mock-runtime opt-in helper.
- **Accept:** unit tests for every gate branch + attachment mapping;
  conformance untouched surfaces stay green (member optional).
- **Verify:** `bun test tests/core/delivery/ tests/integration/runtime-conformance/ --isolate` + gate
- **Commit:** `feat(delivery): inbound discord messages behind neutral contract`

### B2 — Chat plugin wiring
`plugins/chat/lib/channel-inbound.ts` (mirrors workflows'
`wireChannelApprovals`): find-or-create chat keyed by channel/thread ref
(mapping in chat plugin data), agent = `inbound.agentId` (default `main`),
turn via the conversation turn service (work class `chat`, queue-when-busy
202 semantics), typing indicator while running, reply on done via
`ctx.runtime.channels.sendMessage` (chunked), image attachments through
chat's existing downscale path; wired in `activate()`, unsubscribed on
shutdown.
- **Accept:** integration tests with fake inbound events: new channel →
  new chat + turn + reply posted; same channel → same chat; thread → own
  chat; busy chat → queued, replies in order; attachment → chat attachment
  on the turn; reply chunking; chat visible via existing chat REST (UI
  parity free). Bump chat plugin manifest version.
- **Verify:** `bun test tests/plugins/chat/ --isolate` + gate
- **Commit:** `feat(chat): inbound discord messages become real chats`

### B3 — Docs + close-out
`chat-plugin.md`, `conversation-kit.md`, `delivery-bridge.md` inbound
section; CLAUDE.md touch-up; #669 close-out comment (delta: inbound chat
added beyond the reserved design).
- **Commit:** `docs(knowledge): discord inbound chat surfaces`

### CHECKPOINT 2 — Live validation + PR 2
@mention in guild channel → reply (exactly once — daemon check);
non-mention ignored; DM from allowed user → reply; DM from stranger →
silent + audited; screenshot attachment → agent sees it; same-channel
continuity from web UI; busy-queue behavior; `bakin check all` clean.
Owner sign-off → PR 2: `feat(chat): inbound Discord chat via delivery bridge`.

## 5. Risks

| Risk | Mitigation |
|---|---|
| `@discordjs/ws` breaks under `bun build --compile` | A0 spike before any repo work; SPEC D2 raw-WebSocket fallback pre-agreed |
| Gateway flake in dev/tests | No live Discord in any test; client fully mocked; live behavior only in runbooks |
| Double-handling with OpenClaw daemon | Documented precondition + runbook step + doctor copy (SPEC §4.5) |
| Modal/interaction state across restart | custom_id carries approvalId; durable record is authority; pinned by A5 restart test |
| Settings CSV↔array papercuts | Normalizer unit tests both directions; fields documented in System & Alerts descriptions |
