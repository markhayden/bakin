# Discord Delivery Bridge (#669) and Channel Readiness (#908)

The runtime-neutral channel bridge that gives runtimes WITHOUT a native
delivery layer (Pi) a full `runtime.channels` surface over Discord, and the
ONE readiness snapshot every surface reads to say whether delivery works.
Specs: `.claude/specs/discord-bridge/SPEC.md` (bridge, supersedes pi-parity
§10.1) and `.claude/specs/channel-readiness/SPEC.md` (readiness, hot
reconciliation, Channels tab — the margo incident where the post tool said
"no channel layer" while the doctor said "missing token").

## Shape

- **Neutral seam:** `packages/core/src/delivery/bridge.ts` — `ChannelBridge`
  (`isConfigured()`, `status(): BridgeStatus`, `reconcile(reason)`,
  `subscribe(listener)`, `shutdown()`, `channels: RuntimeChannelSurface`).
  There is no `boot()`: the server calls `reconcile('boot')`. Threaded to
  adapters via `AdapterInitOpts.channelBridge` (handle only). Channel
  contract types live in the leaf module
  `packages/core/src/adapters/runtime/channels.ts` (re-exported by concepts)
  so `shared → bridge → channels` stays acyclic.
- **Neutral readiness + errors:** `packages/core/src/delivery/readiness.ts`
  (wire types, the pure classifier `classifyChannelReadiness`, the pure
  projector `projectChannelReadiness`, `readinessOwner`,
  `DELIVERABLE_STATES` / `NOT_CONFIGURED_STATES`), `errors.ts`
  (`DeliveryError { kind, detail }`, `isDeliveryError`,
  `summarizeDeliveryError`), `copy.ts` (`remediationForState`,
  `deliveryFailureCopy`, `CHANNELS_SETTINGS_HREF = '/settings?tab=channels'`
  — the ONE copy table shared by the tool, the onboarding check, the CLI,
  Health and the tab). All exported through `@bakin/core/delivery`.
- **Secret slot:** the token is a declared row in the secret-slot registry
  (`packages/core/src/secrets/slots.ts`, `SECRET_SLOT.discordBotToken` =
  secret-store `discord.botToken` with env `DISCORD_BOT_TOKEN`; env wins
  and the status says so). `resolveSecretSlotStatus` (presence + source,
  never the value) is public; `readSecretSlotValue` lives in
  `secrets/slot-value.ts`, is NOT on the `@bakin/core` root barrel
  (architecture test), and is used only by the bridge config reader. The
  token is never injected into `process.env`, never logged, audited,
  broadcast or rendered.
- **Implementation:** `src/core/delivery/` — the ONE sanctioned Discord
  client upstream of runtime adapters (arch-test + edit-time hook enforce
  confinement; teeth fixtures prove the rules bite).
  - `config.ts` — reads `settings.integrations.discord` + the token slot
    value. `isDiscordConfigured()` = enabled && token && guildIds.
  - `discord/client.ts` — `@discordjs/core`+`rest`+`ws` transport (D2: no
    full discord.js, no native optional deps — pure-JS paths survive
    `bun build --compile`; verified by the A0 spike). Intents: Guilds,
    GuildMessages, DirectMessages and the privileged MessageContent (a bot
    without the portal toggle gets a 4014 close, classified `intents`). Shard
    `Closed`/`Error`/`Ready`/`Resumed` listeners are attached at
    construction (without an `error` listener the manager THROWS on a fatal
    close and `gateway.connect()` never resolves). `connect({ signal })`
    races `gateway.connect()` against a READY gate that a fatal close
    rejects early (`4004` → `auth_failed`, `4013/4014` → `intents`), the
    timer rejects (`timeout`), abort rejects; a REST 401 from
    `GET /gateway/bot` — the usual path for a bogus token, which never
    reaches the socket — is `auth_failed` too (`discord/errors.ts`,
    `classifyConnectFailure`). `destroy()` is idempotent and always
    destroys the manager; our own teardown's `closed 1000` echo is
    suppressed. `status()` / `subscribe()` expose phase, bot user, READY
    guild ids and the last close code.
  - `discord/channel-cache.ts` + `channel-info.ts` — guild text channels
    enumerated per connect and on Verify, cached per guild with a
    per-guild result (`guildResults`: one failing guild no longer hides the
    others; a 403 marks it `forbidden` and the bridge `degraded`).
    Channel ids are `discord:channel:<id>`; DM sends accept
    `discord:user:<id>`.
  - `discord/send.ts` — messages / severity-embed notifications / content
    with attachments (path files + `{kind:'asset'}` via `assets.resolveServe`;
    oversize degrades to an honest note) / threads / edits; 2000-char
    chunking; REST failures wrapped as typed `DeliveryError`s (401 →
    `auth_failed`, 403 → `forbidden`, 404 → `target_not_found`, other 4xx →
    `rejected` with no retry, 5xx and network errors → `transport` after `RETRY_ATTEMPTS` bounded retries;
    429s are handled inside @discordjs/rest) → `delivery.send_failed`
    audit (D13 — NO durable outbox by design; approval rehydration +
    in-app attention cover outages); optional `metadata.idempotencyKey`
    dedupe via the execution ledger — **per channel**
    (`delivery:<surface>:<key>:<channelRef>`), so a retry after a partial
    multi-channel failure re-sends only the channels that never recorded a
    delivery. Ledger read/write failures degrade to best-effort with a warn:
    bookkeeping must never convert a delivered send into a reported failure,
    and an alert is never blocked on ledger availability.
  - `discord/approvals.ts` — buttoned cards. The embed FOOTER carries the
    approvalId (approvalIds exceed the 100-char custom_id cap) so clicks are
    stateless across restarts. Approver allowlist FAILS CLOSED (D4);
    destructive options collect the reason via modal (D5,
    `requireRejectReason` ⇒ required input). Emits `ApprovalResolveEvent`;
    the durable Bakin approval record stays the only authority (D12).
  - `discord/fake-transport.ts` — the deterministic transport for tests
    (D15). Selected by `loadDiscordModules()` ONLY when
    `BAKIN_DELIVERY_TRANSPORT=fake` (loud boot warning; refused without the
    gate); scenario via `BAKIN_DELIVERY_FAKE=ready[:<guildIds>]|reject-401|hang`.
    No test talks to live Discord.
  - `audit.ts` — `delivery.{reconciling,connected,connect_failed,
    disconnected,sent,send_failed,approval_rendered,approval_denied,
    inbound_denied}`. `connect_failed` carries the classified kind and a
    sanitized message, never the token.
  - `index.ts` — the singleton + the reconciliation loop (below);
    `getDeliveryBridge`, `getBridgeStatus`, `getBridgeIdleReason`,
    `getAppliedChannels`, `probeDeliveryBridge` (Verify's read-only probe:
    gateway identity, `GET /users/@me/guilds` membership with guild-level
    View Channels + Send Messages bits — channel overrides are NOT checked,
    the copy says so), `reconcileDeliveryBridge`, `shutdownDeliveryBridge`.
    The approval-handler relay lives OUTSIDE connection state so
    `subscribeApprovalResponses` never crashes a plugin's activate() when
    the bridge is down.

## Lifecycle: reconciliation to the latest configuration (D2/D7/D11)

The bridge converges on the CURRENT settings + token in-process — every
"restart the server" remediation for the bridge is retired.

- **Desired generation.** Every relevant change bumps `desiredGeneration`:
  a settings write touching `integrations.discord` (`subscribeSettingsChanged`
  in core settings — `updateSettings` and `replaceSettingsValue` notify with
  the top-level keys they touched), a secret-store set/unset of
  `discord.botToken` (`subscribeSecretChanged`), an operator Reconnect, a
  runtime boot/switch. Automatic reasons bump only when the snapshot key
  (Discord block JSON + sha256 of the resolved token + delivery mode)
  actually changed — so an A→B token rotation reconnects while a no-op save
  applies silently. Subscriptions are armed lazily on the first
  server-driven reconcile, so a CLI process writing settings never starts a
  loop.
- **One attempt at a time.** The loop runs until `applied === desired` or
  stopped. An attempt captures its generation; after EVERY await it checks
  it is still current. A stale attempt publishes nothing and its transport
  is destroyed in `finally`; the new transport is fully built before it
  replaces the old one (no send gap). Transport events are accepted only
  from the current transport: non-fatal close → `disconnected` (guild facts
  kept), resume/ready → back to `connected`/`degraded`, fatal error →
  `failed`.
- **Non-run reasons** in precedence `stopped > runtime_unknown > native >
  disabled > missing_token > missing_guild` tear the current transport down,
  publish `idle`, and log ONE "Delivery bridge idle" line with the reason.
  `delivery.reconciling { reasons, generation }` is audited once per attempt
  start.
- **Operator semantics.** `reconcile('operator')` JOINS a running loop (no
  new attempt, nothing discarded); with nothing running it bumps and forces
  a fresh attempt even for identical config — that is what Reconnect means.
  The returned promise always settles for the latest generation.
- **Entry points.** `reconcileDeliveryBridge(runtime, 'boot' | 'runtime')`
  reads `capabilities().delivery.mode` ONCE (Pi's `capabilities()` probes
  models — never per settings write) and caches it for the loop. Callers:
  `server.ts` after `createAppServices()` (never inside it — read-only CLI
  paths also build app services); `runtime-switch.ts` after the real
  switch's `createAppServices()` and inside `restore()` — dry runs never
  call it. A native target tears the bridge down immediately (on OpenClaw
  the same bot token is already consumed by the runtime's own Discord
  connection — two consumers would double-handle); a Pi target brings it
  up now, and the switch report notes plugin-bound surfaces follow at
  restart. `@discordjs` is dynamically imported on the first attempt so
  CLI/doctor paths never load it. Teardown joins the graceful-shutdown
  chain (`src/core/lifecycle.ts`: `stopChannelReadiness()` then
  `shutdownDeliveryBridge()`).

**Operational precondition:** a still-running OpenClaw *daemon* holds its
own gateway session on the same token and will also answer. Bakin cannot see
that session (and must not read `~/.openclaw`). If the bot answers twice,
stop the OpenClaw daemon.

## Readiness: one snapshot, every surface (D3/D8)

`src/core/delivery/readiness.ts` is the app-side collector over the pure
classifier. `getChannelReadiness()` returns the cached `ChannelReadiness`
synchronously (available from boot: `startChannelReadiness()` runs after
the boot reconcile); `refreshChannelReadiness(reason)` recollects the async
facts — the native runtime's `channels.list()` under a 2 s budget (failure
⇒ `channels.error`, previous items kept: stale beats broken), bridge guild
results, routing resolution — then classifies and publishes. Refreshes are
coalesced (one in flight, one queued). Triggers: bridge status transition,
settings change touching `integrations.discord` / `notifications` /
`approvals`, token secret change, Verify completion, boot.

States (first match wins): `native` (the runtime owns delivery — the Bakin
bridge block is idle configuration whatever its token/guild state, D14) →
`disabled` → `missing_token` → `missing_guild` → `connecting` →
`connected` / `degraded` (a configured guild unjoined or unenumerated) →
`disconnected` → `failed` (an `idle` bridge that never attempted under a
configured non-native runtime is `failed` with kind `not_connected` — the
classifier never invents `connected`). `owner` is `runtime` / `bridge` /
`none`. `token` is `{ present, source: 'env' | 'store' | null }` — never
the value. `connection.since` is the last STATE transition and survives
refreshes. `projectChannelReadiness` is the bridge-free projection for
switch previews: a configured, unprobed target is `ready_to_connect`,
never a failure.

Every publish broadcasts SSE `{ type: 'plugin-event', event:
'channels.readiness', readiness }` (`usePluginEvent('channels.readiness')`
on the client) and feeds the Health reruns (below). Consumers that read
the snapshot instead of probing: the post-channel tool's pre-flight, the
three channel health checks, the alias resolver, the onboarding check,
the CLI, the Channels tab, the Runtime page row, the switch report.

## Routes and CLI (D7/D12)

`packages/host/src/api/channels.ts`, dispatched from
`src/core/server/request-handler.ts`:

| Route | Behavior |
|---|---|
| `GET /api/channels` | The cached snapshot; `?refresh=1` collects first. |
| `POST /api/channels/reconnect` | Owner `runtime` → 409 `owner_is_runtime`. Else `reconcile('operator')` → 202 `{ readiness }` (joins an in-flight attempt, nothing discarded); `?wait=1` long-polls up to 45 s for the settled snapshot (200) or 202 if still connecting. |
| `POST /api/channels/verify` | Read-only probe → 200 `{ items, readiness }`; 409 `connecting` while an attempt runs. NEVER sends. Items: `gateway`, `guild:<id>`, `channels:<guild>` (refreshes the cache — the old "new channels invisible until restart" gap), `routing:<setting>` (one per alert / approvals / alias target), `health` (the targeted rerun's outcome). Native runtimes verify the runtime-owned list and need no Bakin token. |
| `PUT /api/channels/routing` | `{ alertChannel, approvalsEnabled, approvalsChannel, aliases }`, zod-validated; writes `notifications.channel` / `approvals.channelAlerts` / `approvals.channel` and REPLACES `notifications.channelAliases` wholesale (`replaceSettingsValue` — the deep-merge settings path cannot delete a key). |

CLI (`src/cli/commands/channels.ts`, HTTP clients, `--json`):
`bakin channels status` (exit 0 deliverable, 2 otherwise), `bakin channels
verify` (0 all pass, 1 any fail, 2 everything skipped), `bakin channels
reconnect` (0 connected, 2 nothing to connect — disabled / missing token /
missing guild / degraded, 1 failed or timed out; native → 0 with the
explanation). All three require a reachable server and say so otherwise.
`bakin check channels` (and `check all`) speaks from `GET /api/channels`
when a server is reachable and returns an explicitly labeled
configuration-only result when it is not — it never claims connected and
never says "no channel layer"; `bakin check <target> --json` / `check all
--json` print the structured result. The cross-process proof is
`tests/integration/channels/readiness-agreement.test.ts`: a CLI spawned
with a dummy `DISCORD_BOT_TOKEN` in ITS env still reports the SERVER's
`missing_token`.

## Adapter delegation (D5)

`adapter-pi` exposes `channels` whenever a bridge handle is threaded —
the surface is PERMANENT; delivering members throw typed `DeliveryError`s
(`not_configured` / `not_connected`) when the bridge is down, subscribe
members stay always-safe. `capabilities().delivery.mode` is `'shimmed'`
iff `bridge.isConfigured()`, `'unavailable'` otherwise;
`credentialStatus().channels` lists enumerated channel labels while
`connected`/`degraded`. Conformance pins: `'native'` ⇒ surface present,
`'shimmed'` ⇒ surface present, and threaded bridge ⇒ surface present
regardless of configuration (`channelBridgeThreaded`, teeth-proven).
Because the surface is permanent, every consumer that calls
`channels.list()` outside a send — the two channel health checks and the
alias resolver (`src/core/channel-aliases.ts`, which rethrows
`DeliveryError`s and resolves against joined guilds on `degraded`) — is
readiness-aware, so an outage never produces a second incident or a
misleading alias error.

## Config and the Channels tab (D1/D10)

`settings.integrations.discord` (non-secret): `{ enabled, guildIds[],
approvers[], inbound: { enabled, agentId, requireMention, allowFrom[] } }`.
Empty `approvers`/`allowFrom` = deny all. It is edited in **Settings →
Channels** (`src/components/channels-tab.tsx`, host-owned tab id
`channels`, `/settings?tab=channels`, `&field=<key>` focuses the owning
control) — NOT in System & Alerts, which no longer carries any
`integrations.discord.*` or routing field (`approvals.requireRejectReason`
stays there: approval policy, not routing). The tab's sections: status
header (badges per fact + a Banner with the state's remediation and the
classified last error), bridge settings (ID lists are text-entry + Add +
removable rows — first-time setup must accept ids never discovered, so
not a Combobox; saves show "reconnecting…" then the SSE-settled state),
bot token (the shared `src/components/secret-slot-field.tsx`: write-only
input, status badge, Set / Clear; env-sourced says the stored value is
ignored while `DISCORD_BOT_TOKEN` is set), servers & channels (per-guild
joined/count/error + channel table; runtime-owned read-only list on
native), routing (`notifications.channel`, `approvals.channel` +
`channelAlerts`, `notifications.channelAliases` add/rename/delete — pickers
over the enumerated channels with free-text fallback), actions (Reconnect
busy while connecting / disabled on native; Verify with inline pass/fail/
skipped rows linking to the owning field).

Integrations & Keys (`provider-keys-tab.tsx`) shows the known slot rows
from `GET /api/secrets` `slots[]` (label, owner link, Not set / Bakin store
/ Environment, Set / Clear through the same field) above the custom
secrets. Flipping `enabled` off, clearing the token, or removing the last
guild tears the gateway down within the reconcile — no restart. The
Runtime page's "Channel delivery" row and the runtime-switch report's
`channels` section (`src/core/switch-report.ts`, `buildChannelSwitchReport`:
source/target owner, projected state, setup steps, explicit ownership copy
both directions) link to the tab.

## Health (D8)

The Health incident IS the attention — no Channels nav badge, no toast.
`plugins/health/lib/system-checks/delivery-discord.ts` is a projection of
the snapshot in classifier order (native FIRST): `native` → healthy `idle`
(never an incident, whatever the bridge block holds); `disabled` →
not-applicable; `missing_token` / `missing_guild` → action_required (keys
`missing-token` / `missing-guild`); `connecting` → `watch` with a rerun
resolution; `failed` → `bridge-failed` with the classified kind;
`disconnected` → `bridge-disconnected`; `degraded` → `guild-unjoined`
naming the guilds; `connected` → healthy plus the existing empty-allowlist
`policy_denial` notices. Every navigate resolution opens
`/settings?tab=channels` (optionally `&field=`). `channel-aliases.ts` and
`channel-approvals.ts` read the snapshot: owner `none` → not-applicable;
owner `bridge` with a non-deliverable state → not-applicable "Channel
delivery is unavailable (<state>) — see the Discord delivery bridge check"
(they never emit their own incident for an outage); otherwise today's
logic over `readiness.channels.items`. `plugins/health/lib/channel-readiness-reruns.ts`
subscribes to readiness changes and, 1 s debounced, runs
`runTargetedDiagnostics(CHANNEL_HEALTH_CHECK_IDS)` so the cached report
follows a transition within seconds. The reproduction state yields exactly
ONE incident (`missing-token`) across the three checks; recovery leaves zero.

## Inbound chat (Phase B — SHIPPED)

Optional contract members `channels.subscribeInboundMessages` (pre-gated
`InboundChannelMessage` events) and `channels.sendTyping` (ephemeral typing
pulse). ALL gating is bridge-side before the contract (D9):
`discord/inbound.ts` filters bot/self messages, mention-gates guild
messages (DMs exempt), fails closed on `inbound.allowFrom` with
`delivery.inbound_denied` audits, and materializes image attachments to
local temp files (CDN semantics never cross the boundary; failed downloads
degrade to text-only).

The chat plugin consumes it (`plugins/chat/lib/channel-inbound.ts`,
mirroring core's approvals channel wiring (`bootApprovals`) — feature-detected
at activate, unsubscribed on shutdown): each channel binds to a chat via
`ChatSummary.externalKey` (delete-resilient; a Discord thread is its own
channel id, so threads get their own chats for free), turns run through
the ONE conversation turn engine (work class `chat`, queue-when-busy,
engine-side downscaling), a typing pulse repeats while the turn runs, and
the `chat.done` bus event posts the assistant reply back to the channel —
including for turns started from the web UI on a bound chat
(interchangeable conversation is the D7 point, not a bug). `chat.error`
posts an honest failure line; aborted turns stay silent. Unsupported
image input degrades to a visible note in the message; non-raster files
(PDF, …) pass through as attachments and the turn engine's `fileLaneNote`
points the agent at `bakin_exec_pdf_read`/file tools (#742 — inbound and
the web composer share ONE note generator).

Facade note: `src/lib/plugin-context-services.ts` forwards the optional
channel members (subscribeInboundMessages, sendTyping, createThread,
editMessage) conditionally so user plugins see honest absence; the
permission map (`src/lib/plugin-permissions.ts`) covers them.

## Testing

No live Discord in any test (D15). Unit tests mock the REST/interaction
layer or the transport (`tests/core/delivery/`: classify, errors,
reconcile race matrix, transport status, collector, send, channel cache,
fake transport, boot gating). Pi delegation + the permanent-surface pin:
`tests/adapter-pi/channel-bridge-delegation.test.ts`. Conformance teeth:
`tests/integration/runtime-conformance/teeth.conformance.test.ts`. Health
projection + reruns: `tests/plugins/health/`. Tool + aliases:
`tests/core/exec-tools/post-channel.test.ts`, `tests/core/channel-aliases.test.ts`.
Tab + secret field + Integrations rows: `tests/components/`, browser
fixture `packages/host/tests/channels-tab.ui.fixture.tsx` (every state at
375 px, axe clean). Cross-surface agreement on a REAL server booted from
source on the fake transport (`tests/helpers/isolated-server.ts`):
`tests/integration/channels/readiness-agreement.test.ts`. Live validation
rides the owner runbook in the readiness spec §10.
