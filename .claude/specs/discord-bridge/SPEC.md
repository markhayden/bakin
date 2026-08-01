# Discord Delivery Bridge + Inbound Chat (issue #669)

Status: DRAFT — pending approval
Date: 2026-07-26
Origin: pi-parity §10.1 reserved architecture, expanded by owner decision to
include basic inbound chat.

## 1. Objective

Give the Pi runtime a Discord channel layer so gated work, notifications, and
content delivery reach the owner where they already live — and let the owner
talk back. Today `adapter-pi` omits `runtime.channels` entirely
(`packages/adapter-pi/src/runtime.ts:219-221`, `delivery: 'unavailable'`), so
on Pi every channel consumer (gate approval cards, watchdog alerts,
`bakin_exec_post_channel`, budget notify) degrades to log-only/in-app.

Two deliverables, phased:

- **Phase A — Delivery bridge (the #669 reserved design):** runtime-neutral
  `ChannelBridge` in `src/core/delivery/`, Discord implementation behind it,
  `adapter-pi` surfaces `runtime.channels` by delegation
  (`delivery: 'shimmed'` when configured). Zero consumer changes.
- **Phase B — Inbound chat (owner-approved expansion):** @mention/DM messages
  become turns in real Bakin chats via the one conversation turn engine
  (#703). Replies post back to the originating channel/thread.

Single user (this box). No backwards-compat constraints; no shims for old
shapes. Priority: reduce tech debt, keep the adapter boundary clean.

## 2. Ground truth (verified 2026-07-26)

- Contract: `AgentRuntimeAdapter.channels?` at
  `packages/core/src/adapters/runtime/concepts.ts:936-962` — `list`,
  `sendNotification`, `sendMessage`, `deliverContent`, `createApproval`,
  `editApproval`, `cancelApproval`, `resolveApproval`,
  `subscribeApprovalResponses`, optional `createThread`/`editMessage`.
  Feature-detection is compile- and arch-test-enforced (`.channels!.` banned).
- Consumers (all go through `ctx.runtime`/`getAppServices().runtime` — none
  change): workflows gate notifications + channel approvals + rehydration,
  watchdog, post-channel exec tool, channel-aliases resolver, switch-report,
  onboarding credentials check, health checks.
- Durable approval record is canonical:
  `~/.bakin/workflows/approvals/<id>.json`
  (`plugins/workflows/lib/approval-store.ts`); inbound resolution contract is
  `ApprovalResolveEvent` consumed by
  `plugins/workflows/lib/channel-approvals.ts:41`. Discord buttons are
  transport only.
- Secret store already fits: `setStoredSecret('discord','botToken',…)` works
  today (`packages/core/src/media/secret-store.ts`); masked REST at
  `/api/secrets`; Settings → Integrations & Keys tab manages named secrets.
- Live box config: `settings.notifications` already targets Discord
  (`channel: 'discord'`, `gateAlerts: true`, `channelAliases.approvals =
  discord:channel:1492642521728290816`). OpenClaw's config holds a working
  bot token (72 chars), guild `1483917789918920714`, approver/allowFrom user
  `202168845362921483`, `requireMention: true`, `streaming.mode: off`.
- No `settings.integrations` key exists yet. No discord dependency anywhere
  in the repo. `src/core/delivery/` does not exist.
- Arch guard: `tests/architecture/adapter-boundary.test.ts:112-115` bans
  Discord API references outside the runtime adapter with NO allowlist — the
  bridge requires adding `allow: rel => rel.startsWith('src/core/delivery/')`.
- Conformance: `'native'` delivery ⇒ surface-present is pinned
  (`tests/integration/runtime-conformance/conformance.ts:591-592`); nothing
  pins `'shimmed'` ⇒ surface-present — this work extends it.
- Pi ecosystem research: nothing to adopt. Upstream pi has no channel layer
  (pi-mono #1253 closed unimplemented); community bridges
  (pi-messenger-bridge, pi-gateway) are inbound-only chat bridges living
  agent-side — wrong shape and wrong side of the adapter boundary.

## 3. Decisions (owner-interviewed 2026-07-26)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Bot identity | **Reuse the existing bot** (same token as OpenClaw's config). One-time guided copy into Bakin's secret store as `discord.botToken`. Bakin never reads `~/.openclaw`. |
| D2 | Library | **`@discordjs/core` + `@discordjs/rest` + `@discordjs/ws` + `discord-api-types`.** No full discord.js framework (cache/sweepers unused). Do NOT install optional native deps (`zlib-sync`, `bufferutil`, `utf-8-validate`); pure-JS paths for `bun build --compile`. Gateway (outbound WS) carries interactions — works behind Tailscale and in any future cloud host; public-endpoint interactions remain a possible future swap without changing the bridge interface. |
| D3 | Channel discovery | **Enumerate guild text channels via REST** at connect (config holds `guildIds`), cached with on-demand refresh. `list()` returns them all as `ChannelInfo` with real names. Send paths additionally accept `discord:user:<id>` refs (DM-channel creation via REST) — parity with OpenClaw's `user:` targets. |
| D4 | Approval authorization | **`approvers` allowlist of Discord user IDs, fail closed.** Unauthorized clicks get an ephemeral "not authorized" reply + `delivery.approval_denied` audit; never resolve a gate. Empty list = deny all. |
| D5 | Reject flow | **Discord modal collects the reject reason** (required when `requireRejectReason`, else optional). Bridge advertises `modal-input` capability — first channel surface to honor `requireRejectReason` honestly. |
| D6 | Scope | **Delivery + basic inbound chat** (owner expanded beyond §10.1). Phased: bridge first, inbound second — natural rollback checkpoint between them. |
| D7 | Inbound model | **Real Bakin chats.** Each Discord channel maps to a persistent chat-plugin conversation; a Discord thread gets its own chat. Turns run through `createConversationTurnService` (work class `chat`, durable transcript, queueing). Same conversation usable from web UI and Discord. |
| D8 | Inbound agent | **One configured agent** (`inbound.agentId`, default `main`). Per-channel agent map deferred until needed. |
| D9 | Inbound gating | Guild channels require @mention; DMs allowed from `allowFrom` users; `allowFrom` fail-closed (empty = deny all). Mirrors the owner's existing OpenClaw posture. |
| D10 | Streaming | **Off in v1.** Typing indicator while the turn runs; one reply on completion, chunked to Discord's 2000-char limit. Live message-edit streaming is a possible follow-up. |
| D11 | Bridge lifecycle vs runtime | Bridge boots **only when configured AND the active runtime's `capabilities().delivery.mode !== 'native'`**. On OpenClaw the native bot owns Discord (same token — two consumers would double-handle). Never boots inside `createAppServices()`; clean shutdown teardown. |
| D12 | Authority | Discord is transport. The durable Bakin approval record decides; stale/duplicate button clicks are ignored against it. In-app attention (P3 badge/toast/OS notification) stays the always-on companion. |
| D13 | Delivery resilience | **No durable outbox** (OpenClaw has a delivery-queue; we deliberately don't). Pending approvals survive outages via the existing rehydration path (durable record re-renders at boot/wire). Plain sends get bounded in-bridge retry with backoff; final failure is audited (`delivery.send_failed`) and surfaced by the doctor check — never silent, never queued forever. In-app attention covers the gap. |
| D14 | Known parity gaps (accepted) | OpenClaw's Discord `execApprovals` (shell-command approval buttons) is runtime-owned — Pi has no equivalent; documented non-goal. `requireMention` is one global flag, not per-guild (one guild in practice). OpenClaw's `groupPolicy: open` is intentionally NOT matched — fail-closed allowlists are stricter by design. |

## 4. Architecture

### 4.1 Module layout (Phase A)

```
packages/core/src/delivery/bridge.ts   — neutral ChannelBridge interface (types only;
                                         what AdapterInitOpts threads to adapters)
src/core/delivery/
  index.ts          — bridge singleton: createDeliveryBridge(), bootDeliveryBridge(),
                      shutdownDeliveryBridge(); boot gating per D11
  config.ts         — reads settings.integrations.discord + secret-store token;
                      isConfigured() (enabled && token && guildIds.length)
  discord/client.ts — @discordjs/core lifecycle: REST + gateway (intents: GUILDS,
                      GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT), reconnect,
                      channel cache (D3), teardown
  discord/send.ts   — sendMessage / sendNotification (severity-colored embeds) /
                      deliverContent (asset refs → attachment uploads via the
                      existing { kind: 'asset' } resolution) / createThread /
                      editMessage; 2000-char chunking; oversize attachments
                      (> Discord's upload cap) degrade to posting the Bakin
                      asset link; bounded retry w/ backoff (D13);
                      discord:user:<id> DM targets (D3)
  discord/approvals.ts — buttoned approval cards (approve/reject components),
                      INTERACTION_CREATE subscription, approver allowlist (D4),
                      reject-reason modal (D5), → ApprovalResolveEvent
  audit.ts          — delivery.* audit events + execution-ledger idempotency keys
                      (send dedupe on retry paths)
```

Discord identifiers/imports confined to `src/core/delivery/` by extending the
adapter-boundary arch test allowlist + `.claude/hooks/check-adapter-boundary.mjs`.

### 4.2 Adapter delegation (Phase A)

- `AdapterInitOpts` gains optional `channelBridge?: ChannelBridge`
  (`packages/core/src/adapters/shared.ts`). The factory in `src/core/`
  injects the Discord bridge handle when creating adapter-pi.
- `adapter-pi`: `channels` present **only when** `channelBridge?.isConfigured()`
  — pure delegation, no Discord knowledge. `capabilities().delivery.mode`
  returns `'shimmed'` when configured, `'unavailable'` otherwise.
- OpenClaw untouched.
- Conformance suite extended: `'shimmed'` ⇒ surface must be present (and the
  teeth file proves the check bites).

### 4.3 Approvals (Phase A)

Outbound: unchanged — workflows plugin already writes the durable record then
calls `channels.createApproval`. The bridge renders an embed + approve/reject
buttons with `custom_id` carrying the approvalId.

The card embed carries the "Review & Approve in Bakin" deep link
(`buildGateApprovalUrl`) alongside the buttons — same escape hatch the
context message already renders, so full context is always one click away.

Inbound: button click → allowlist check (D4) → (reject: modal, D5) →
`ApprovalResolveEvent` → existing `wireChannelApprovals` handler does record
lookup, staleness check, `approveGate`/`rejectGate`, audit, decision summary
(which flows back through `editMessage`). Bridge acks the interaction and
disables the buttons; the durable record remains the only authority.

### 4.4 Inbound chat (Phase B)

- Contract addition: optional
  `channels.subscribeInboundMessages?(handler): Unsubscribe` with a neutral
  `InboundChannelMessage` type (platform, channelRef, threadRef?, authorId,
  authorName, text, attachments?, messageRef). Image attachments ride the
  event and land as chat attachments (downscaled via `@bakin/core/media`,
  capability-gated like web-originated attachments) — parity with OpenClaw's
  inbound media. Pi delegates to the bridge; OpenClaw omits the member
  (native inbound is OpenClaw's own).
- The **chat plugin** wires it (mirroring how workflows wires
  `subscribeApprovalResponses`): find-or-create a chat keyed by
  channel/thread ref → run the turn via the conversation turn service
  (agent = `inbound.agentId`, work class `chat`, queue-when-busy) → on done,
  post the reply back via `ctx.runtime.channels.sendMessage` and mark the
  turn delivered. Typing indicator while running (D10).
- Gating per D9 enforced in the bridge before the event is emitted;
  denied senders are audited (`delivery.inbound_denied`), not answered.

### 4.5 Config & secrets

New top-level `BakinSettings.integrations` (typed + normalized in
`packages/core/src/settings.ts`, secret-free — settings.json is broadcast):

```jsonc
"integrations": {
  "discord": {
    "enabled": false,
    "guildIds": [],
    "approvers": [],            // Discord user IDs allowed to decide gates
    "inbound": {
      "enabled": true,           // effective only when the bridge is up
      "agentId": "main",
      "requireMention": true,
      "allowFrom": []            // Discord user IDs allowed to chat
    }
  }
}
```

All non-secret fields join `SYSTEM_SETTINGS_SCHEMA`
(`src/components/system-settings.ts`) so the System & Alerts tab edits them —
no hand-editing settings.json.

Token: secret store only (`discord.botToken`), read directly via
`getStoredSecret` at bridge boot — **never** injected into `process.env`
(agent shells inherit the server env; the antfly-password pattern is the
precedent). Settings → Integrations & Keys gets a Discord Bot Token entry;
the guided one-time copy from the OpenClaw config is a human step surfaced by
doctor remediation, not code that reads `~/.openclaw`.

**Operational precondition (same-token double-handling):** D11 gates on
Bakin's active adapter, but a still-running OpenClaw *daemon* holds its own
gateway session on the same token and will also answer mentions. Bakin
cannot see that session (and must not read `~/.openclaw`). Documented setup
precondition + live-validation runbook step; doctor check copy mentions it
("if the bot answers twice, stop the OpenClaw daemon").

### 4.6 Observability

- `delivery.*` audit events: `delivery.sent`, `delivery.send_failed` (final,
  post-retry), `delivery.approval_rendered`, `delivery.approval_denied`,
  `delivery.inbound_denied`, plus connect/disconnect lifecycle.
- Doctor check `delivery.discord` (owner-registered, class-stamped):
  configured-but-no-token, token-but-gateway-down, approvals alias pointing
  at an unknown channel, approvers/allowFrom empty while enabled
  (fail-closed notice). Remediation copy points at Integrations & Keys.
- Ledger idempotency keys on send paths that can retry (gate cards,
  notifications) so restarts never double-post.

## 5. Non-goals

- OpenClaw channel behavior changes (native path untouched).
- Streaming replies via message edits (follow-up candidate).
- Per-channel agent routing (D8 defers).
- Public HTTPS interactions endpoint (gateway-only for now).
- Any other platform (Slack/Telegram) — but `ChannelBridge` is the neutral
  seam a future platform would implement.
- Exec-approval flows for the runtime's own shell commands (runtime-owned;
  see D14 — on Pi, workflow gates + capability packs are the control points).
- Durable delivery outbox (D13 — rehydration + retry + honest audit instead).

## 6. Testing strategy

- Unit: bridge modules with a mocked Discord API layer (REST + gateway event
  injection) — approval card rendering, allowlist fail-closed, modal reason
  flow, chunking, channel cache, config gating (D11). Standard temp-dir +
  content-dir mocks per CLAUDE.md testing rules; no live Discord in tests.
- Contract: conformance extension (`'shimmed'` ⇒ surface present) + teeth.
- Arch: adapter-boundary allowlist for `src/core/delivery/` + a new pin that
  bans discord identifiers outside it; `check:cycles` clean.
- Integration: adapter-pi delegation (channels present iff configured),
  workflows gate round-trip against a fake bridge emitting
  `ApprovalResolveEvent`, chat inbound round-trip against a fake inbound
  event (find-or-create chat, turn runs, reply posted).
- Live validation before merge (standing rule): branch in the main checkout,
  real bot + real guild, runbook mirroring
  `docs/validation/gate-discord-runbook.md` — gate card round-trip, reject
  modal, unauthorized click, inbound @mention → chat reply, inbound image
  attachment, DM send + DM inbound, oversize-asset link fallback, restart
  idempotency, and the double-handling check (OpenClaw daemon stopped — bot
  answers exactly once). Owner tests before merge.

## 7. Documentation impact

- `.claude/knowledge/delivery-bridge.md` (new) — architecture, config,
  lifecycle, audit surface.
- `.claude/knowledge/pi-adapter.md:52` — correct the stale degradation row
  (channels member is omitted, not throwing) + delivery now `'shimmed'`.
- `.claude/knowledge/runtime-capabilities.md`, `workflow-approvals.md`,
  `chat-plugin.md`, `conversation-kit.md` — new inbound surface + shimmed
  delivery mentions where they describe current behavior.
- `CLAUDE.md` — Architecture bullet for the delivery bridge; settings shape.
- `README.md` — check and update the feature list if channels/notifications
  are mentioned (verify during build).
- `.claude/specs/pi-parity/SPEC.md` §10.1 — mark as superseded-by this spec.
- Issue #669 close-out comment with the delta (inbound chat added).

## 8. Boundaries

- **Always:** feature-detect `runtime.channels`; durable record is the
  authority; fail closed on empty allowlists; secrets out of settings.json;
  discord code confined to `src/core/delivery/`.
- **Ask first:** anything that would touch OpenClaw's native path, add new
  runtime-contract members beyond `subscribeInboundMessages`, or store new
  secrets.
- **Never:** read `~/.openclaw` from core; boot the bridge inside
  `createAppServices()`; parallel spend/metering paths (inbound turns ride
  work class `chat`); silent drops (every denial audited).
