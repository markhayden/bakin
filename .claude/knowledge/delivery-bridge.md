# Discord Delivery Bridge (#669)

The runtime-neutral channel bridge that gives runtimes WITHOUT a native
delivery layer (Pi) a full `runtime.channels` surface over Discord. Spec:
`.claude/specs/discord-bridge/SPEC.md` (supersedes pi-parity §10.1).

## Shape

- **Neutral seam:** `packages/core/src/delivery/bridge.ts` — `ChannelBridge`
  (`isConfigured()`, `boot()`, `shutdown()`, `channels: RuntimeChannelSurface`).
  Threaded to adapters via `AdapterInitOpts.channelBridge` (handle only).
  Channel contract types live in the leaf module
  `packages/core/src/adapters/runtime/channels.ts` (re-exported by concepts)
  so `shared → bridge → channels` stays acyclic.
- **Implementation:** `src/core/delivery/` — the ONE sanctioned Discord
  client upstream of runtime adapters (arch-test + edit-time hook enforce
  confinement; teeth fixtures prove the rules bite).
  - `config.ts` — reads `settings.integrations.discord` + token
    (env `DISCORD_BOT_TOKEN` first, then secret-store `discord.botToken`;
    NEVER injected into process.env). `isDiscordConfigured()` = enabled &&
    token && guildIds.
  - `discord/client.ts` — `@discordjs/core`+`rest`+`ws` transport (D2: no
    full discord.js, no native optional deps — pure-JS paths survive
    `bun build --compile`; verified by the A0 spike). Intents: GUILDS,
    GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT.
  - `discord/channel-cache.ts` + `channel-info.ts` — guild text channels
    enumerated at boot (D3), cached, stale-beats-broken refresh. Channel ids
    are `discord:channel:<id>`; DM sends accept `discord:user:<id>`.
  - `discord/send.ts` — messages / severity-embed notifications / content
    with attachments (path files + `{kind:'asset'}` via `assets.resolveServe`;
    oversize degrades to an honest note) / threads / edits; 2000-char
    chunking; bounded retry → `delivery.send_failed` audit (D13 — NO durable
    outbox by design; approval rehydration + in-app attention cover outages);
    optional `metadata.idempotencyKey` dedupe via the execution ledger.
  - `discord/approvals.ts` — buttoned cards. The embed FOOTER carries the
    approvalId (approvalIds exceed the 100-char custom_id cap) so clicks are
    stateless across restarts. Approver allowlist FAILS CLOSED (D4);
    destructive options collect the reason via modal (D5,
    `requireRejectReason` ⇒ required input). Emits `ApprovalResolveEvent`;
    the durable Bakin approval record stays the only authority (D12).
  - `audit.ts` — `delivery.{connected,disconnected,sent,send_failed,
    approval_rendered,approval_denied,inbound_denied}`.
  - `index.ts` — singleton + D11 boot gating; approval-handler relay lives
    OUTSIDE boot state so `subscribeApprovalResponses` never crashes a
    plugin's activate() when the bridge is down.

## Lifecycle (D11)

`server.ts` calls `bootDeliveryBridge(runtime)` after `createAppServices()`
(never inside it — read-only CLI paths also build app services). Boots ONLY
when configured AND the active runtime's `capabilities().delivery.mode !==
'native'`: on OpenClaw the same bot token is already consumed by the
runtime's own Discord connection — two consumers would double-handle.
`@discordjs` is dynamically imported at boot so CLI/doctor paths never load
it. Teardown joins the graceful-shutdown chain (`src/core/lifecycle.ts`).

**Operational precondition:** a still-running OpenClaw *daemon* holds its
own gateway session on the same token and will also answer. Bakin cannot see
that session (and must not read `~/.openclaw`). If the bot answers twice,
stop the OpenClaw daemon.

## Adapter delegation

`adapter-pi` exposes `channels` via a getter iff
`initOpts.channelBridge?.isConfigured()`; `capabilities().delivery.mode`
reports `'shimmed'`/`'unavailable'` accordingly. Zero consumer changes —
everything already goes through `runtime.channels` feature-detection.
Conformance pins BOTH directions of the claim: `'native'` ⇒ surface present
AND `'shimmed'` ⇒ surface present (teeth-proven).

## Config

`settings.integrations.discord` (non-secret; System & Alerts tab edits it —
list fields render as comma-separated strings, normalized to arrays):
`{ enabled, guildIds[], approvers[], inbound: { enabled, agentId,
requireMention, allowFrom[] } }`. Empty `approvers`/`allowFrom` = deny all.
Token: Settings → Integrations & Keys → integration `discord`, secret
`botToken`.

## Health

`delivery-discord` doctor check (health plugin, runtime group): disabled →
not-applicable; missing token/guilds → action_required with remediation;
native runtime → idle-healthy (by design); configured-but-disconnected →
action_required; empty allowlists while on → `policy_denial` watch notices.

## Inbound chat (Phase B — planned, not yet shipped)

`channels.subscribeInboundMessages` + chat-plugin wiring per the spec:
mention-gated guild messages / allowlisted DMs become real Bakin chats
through the conversation turn engine. Until it ships, the bot ignores
ordinary messages.

## Testing

Unit tests mock the REST/interaction layer (`tests/core/delivery/`); no
live Discord in any test. Pi delegation:
`tests/adapter-pi/channel-bridge-delegation.test.ts`. Conformance teeth:
`tests/integration/runtime-conformance/teeth.conformance.test.ts`. Live
validation rides the checkpoint runbook in the spec/plan.
