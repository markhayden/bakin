# Channel Readiness & Recovery (issue #908)

Status: v3 — APPROVED (plan approved 2026-10-06; v3 amendments from the two
plan reviews + the reconciliation design review folded in)
Date: 2026-10-06
Plan: `.claude/specs/channel-readiness/PLAN.md`, tracking in `TODO.md`
Origin: production incident on margo (rc.35, Pi runtime, Discord enabled,
Bakin bot token absent) where a missing credential looked like an
unsupported runtime feature. Builds on the shipped Discord bridge (#669,
`.claude/specs/discord-bridge/`).

## 1. Objective

Make the state of channel delivery impossible to misread, from the agent
tool output to the Health incident to the settings page, and give the owner
an in-app recovery path that never ends in "restart the server from a
terminal".

Concretely:

- ONE readiness engine answers "can Bakin deliver to Discord right now, and
  if not, why and what do I do". Every surface is a projection of it.
- Enabled, configured, and connected are three different facts and are
  shown as three different facts.
- Saving a token or a setting takes effect without a server restart, and
  the bridge always converges on the LATEST configuration.
- A failed post tells the agent the real cause and the next step, and a
  retry never re-sends a chunk that already went out.
- A verified recovery clears the incident within seconds, and recovery
  produces ONE incident chain, never a cascade of dependent ones.

Single user (this box + margo). No backwards-compat constraints; no shims
for old shapes. Priority: reduce tech debt, keep the adapter boundary
clean.

## 2. Ground truth (verified 2026-10-05)

### Code

- Bridge state is `state !== null` (`src/core/delivery/index.ts:195`).
  There is no connection enum, no last error, no connected-at, no record
  of the guilds the bot joined (READY's `data.guilds` is logged and
  dropped, `discord/client.ts:58`), and no per-guild channel result: one
  failing guild aborts the whole enumeration and leaves the cache null
  (`discord/channel-cache.ts:37-45`; swallowed by `log.warn` at
  `index.ts:117-121`).
- A connect failure is a `log.warn` in `server.ts:144`. No audit event, no
  stored reason. Enabled-but-unconfigured boots return silently
  (`bootDeliveryBridge` → `shouldBootDeliveryBridge` false → nothing
  logged).
- `boot()` is single-flighted on one promise (`index.ts:69-84`); nothing
  reconciles a config change that lands while a connect is in flight.
- The bridge throws a plain `Error('Discord delivery bridge is not
  connected …')` from `requireState()`; `send.ts` rethrows raw
  `@discordjs` errors; `isNonRetryable` treats every 4xx except 429 the
  same (`send.ts:132-135`), 401 included.
- Pi: `capabilities().delivery.mode` and the `channels` getter depend on
  `channelBridge.isConfigured()` alone (`packages/adapter-pi/src/runtime.ts:155,251`).
  `credentialStatus().channels` is always `[]` (`:113-119`). Conformance
  pins native/shimmed ⇒ surface present only
  (`tests/integration/runtime-conformance/conformance.ts:767-774`).
- Two consumers feature-detect `runtime.channels` at activation and never
  look again: `plugins/chat/lib/channel-inbound.ts:84` and
  `src/core/approvals/channel-wiring.ts:16`.
- `post-channel.ts`: `resolveRuntimeChannelRef` (`src/core/channel-aliases.ts:95-106`)
  calls `channels.list()` FIRST and swallows throws into an empty known
  set, so an unconnected bridge surfaces as "No channel alias configured"
  before any delivery attempt. Absent surface → "no channel layer"; any
  throw → "Runtime channel delivery failed: <message>"; content goes out
  as sequential chunks (`:252-277`), and failures are memoized 5 min
  (`POST_IDEMPOTENCY_TTL_MS`) regardless of how far delivery got.
- Health: `delivery-discord.ts` evaluates bridge configuration BEFORE the
  runtime's delivery mode, so an OpenClaw box with a Bakin bridge block
  enabled and no Bakin token gets a false `missing-token` incident.
  `channel-aliases.ts:15-31` and `channel-approvals.ts:19-23` return
  not-applicable only when the surface is ABSENT; when present they call
  `channels.list()` and emit their own `inspection-failed` /
  `evidence_gap` incidents on a throw.
- Secrets: `discord.botToken` is a magic string (`delivery/config.ts:24`,
  health check copy). No slot registry; `STATIC_ENV_SECRET_MAPPINGS` holds
  only brave. `/api/secrets` returns names only; POST calls
  `injectSecretEnvForSlot`; DELETE has no hook. No change event.
- Settings: `updateSettings` deep-merges (`packages/core/src/merge.ts`:
  nested plain objects merge key-wise, arrays and null replace) and
  invalidates the cache (`packages/core/src/settings.ts:740`). An omitted
  map key SURVIVES a write, so alias deletion cannot ride the generic
  settings POST. No change subscription.
- CLI: `bakin check channels` (`src/cli/commands/onboarding.ts:135-152`)
  imports the onboarding component and runs `check()` IN THE CLI PROCESS,
  building local app services as needed. The bridge never boots there and
  the CLI process has its own environment, so today's check cannot see
  the server's connection or an env-only token the server inherited.
- UI: no Channels page. Discord's 7 fields live in System & Alerts
  (`src/components/system-settings.ts:86-137`, CSV lists). The token is
  entered as free-form provider/name in Integrations & Keys
  (`src/components/provider-keys-tab.tsx:220-270`). `notifications.channel`,
  `approvals.channel`, `approvals.channelAlerts`, `approvals.requireRejectReason`
  are in System & Alerts; `notifications.channelAliases` has no field.
  Runtime page: a "Channel delivery" capability row with mode copy only.
- Runtime switch: `SwitchResult.credentials` carries the target's
  `channels`, the client type narrows it away
  (`packages/host/src/components/runtime/types.ts:46-83`);
  `buildCantCarryReport` emits a generic "reconfigure channels" concern.
- Onboarding `channels` component (`src/core/onboarding/credentials.ts:93-155`)
  returns OK "no channel layer — by design" when `runtime.channels` is
  absent, and warns "no channel with usable credentials" when
  `credentialStatus().channels` is empty — which it always is on Pi.
- Targeted health runs exist: `runHealthCheck` /
  `runDetailedPluginHealthChecks` (`src/core/doctor-checks.ts`),
  `applyHealthCheckRuns` (`src/core/doctor-report-cache.ts`); the
  auto-close path uses them.
- Knowledge docs that state the OLD Pi behavior: `.claude/knowledge/pi-adapter.md:63`
  ("Member OMITTED unless the Discord delivery bridge is configured") and
  the channels row further down; `.claude/knowledge/delivery-bridge.md`
  § Adapter delegation; CLAUDE.md Discord bullet.
- Live dev box: Pi, Discord enabled, 1 guild, bridge connected, token from
  `DISCORD_BOT_TOKEN` in the dev server's environment (the store has only
  `brave.apiKey`).

### Incident evidence (margo, read-only; `~/.bakin/audit.jsonl`, `~/.bakin/logs/server.log`)

Sanitized excerpts (ids are task ids / audit event names, no secrets):

| When (UTC) | Source | Event |
|---|---|---|
| 2026-09-20T23:36:08 | server.log `workflows` | "Runtime has no channel layer — workflow gates are UI-only" — first Pi boot after the switch. No `delivery` line at all (silent boot gate). |
| 2026-09-21T15:04:05 | audit `exec.bakin_exec_post_channel.fail` task `0d61b1f1` | `error: "Channel delivery is not available: the active runtime (pi) has no channel layer."` (preceded at 15:03:48 by `No channel alias configured for #daily-summary`). |
| 2026-09-21T18:05 → 09-22T00:56 | audit, same event | 7 more identical failures across tasks `73872009`, `839cee2e`, and an untasked post. |
| 2026-09-22T00:15:01 | audit `task.blocked` task `73872009` | reason quotes the tool error and adds "`bakin check channels --json` confirms the pi runtime has no channel layer/no channel credentials to configure". |
| 2026-09-22T00:20:01 | audit `task.blocked` task `5f9397b5` ("Health repair: 2 incidents need attention") | reason: "Incidents still failing fresh checks: health:runtime:missing-token (Discord bridge enabled but no bot token stored; sanctioned fix is operator adding integration "discord" secret "botToken" at /settings?tab=integrations …)". |
| 2026-09-22T01:04:23 | audit `delivery.connected` | `{platform: discord, guilds: 1}` — token added, bridge up. |
| 2026-09-20 → 09-26 | tasks store | 20+ tasks titled "Health repair: N incidents need attention" created; none name Discord in the title (escalation loop, memory note 2026-09-28). |

Root cause of the discoverability failure: three surfaces contradicted
each other (tool: "no channel layer"; `bakin check channels`: OK by
design; doctor: missing token), and the one that was right spoke through
a generic repair-task title in a flood of identical titles. The check
itself was correct.

## 3. Decisions (owner-interviewed 2026-10-05; v2 amendments marked)

| # | Decision | Choice |
|---|---|---|
| D1 | Home of channel management | **New Settings tab "Channels"** (host-owned, id `channels`, `/settings?tab=channels`). One place for status, bridge settings, token, discovered channels, routing targets, Reconnect, Verify. Runtime page row links there. |
| D2 | Lifecycle | **Hot reconnect in-process**, implemented as **reconciliation to the latest desired configuration** (§4.2): every relevant change bumps a desired generation; one attempt runs at a time; a stale attempt's result is discarded and its transport destroyed. Retires every "restart the server" remediation for the bridge. Folds in deferred TODO "settings-change-driven bridge teardown". **v3:** `reconcileDeliveryBridge(runtime, 'runtime')` is also called by `switchRuntime` after the real switch's `createAppServices()` and inside `restore()`; dry runs never call it. A native target tears the bridge down immediately (no double-handling); a Pi target brings it up now, and the report notes that plugin-bound surfaces follow at restart. |
| D3 | Readiness model | **One snapshot**: a pure classifier over collected facts (`packages/core/src/delivery/readiness.ts`) + an app-side async collector with explicit refresh triggers and stale/failed evidence (`src/core/delivery/readiness.ts`). Precedence table in §4.1. **v3:** observation and projection are separate functions — `classifyChannelReadiness` needs a real `BridgeStatus`; `projectChannelReadiness` (no bridge input) yields a `ProjectedChannelState` for switch previews, where a configured, unprobed target is `ready_to_connect`, never a failure. |
| D4 | Token slot | **Declared secret-slot registry** in core; `discord.botToken` (+ `DISCORD_BOT_TOKEN`) and the brave mapping become rows. Presence/status resolution is public; VALUE resolution is a separate private function used only by the transport. Env wins over store; the status says so. |
| D5 | Pi surface | **`runtime.channels` is always present** when a bridge handle is threaded. Delivering members throw typed `DeliveryError`s; subscribe members stay always-safe. `delivery.mode` stays `shimmed` iff configured, `unavailable` otherwise. `credentialStatus().channels` reports enumerated channels when connected. (Owner: "I guess" — accepted as the decision that keeps hot reconnect honest.) **v2:** every consumer that calls `channels.list()` outside a send — the two channel health checks and the alias resolver — becomes readiness-aware so the permanent surface never produces a second incident or a misleading alias error. |
| D6 | Tool output | **Kind → cause + next step mapping** (§4.6). **v2:** failure memoization is decided by delivery OUTCOME (anything accepted, or uncertain ⇒ memoize), never by error kind alone. **v3:** the identical-retry memo lookup runs BEFORE pre-flight, keyed without any channel-surface call, so a completed or partially completed post retried while the bridge is down returns the saved result instead of a fresh readiness failure; pre-flight then runs BEFORE alias resolution. |
| D7 | Verify | **Read-only probe**, never sends. **v2:** full observable contract per state in §4.5; reconnect has its own terminal result and exit codes; Verify on a native runtime uses runtime-owned surfaces and needs no Bakin token. **v3:** operator semantics are fixed: `reconcile('operator')` JOINS a running loop (no new attempt, nothing discarded); when nothing is running it bumps and forces a fresh attempt even with identical config (that is what the Reconnect button means). The returned promise always settles for the latest generation. |
| D8 | Attention | **Health incident is the attention.** One incident per non-ready state with a stable key, `action_required` / `service_failure`, navigate → Channels tab. State changes trigger a targeted rerun of `delivery-discord` AND its dependents (`channel-aliases`, `channel-approvals`). **No** Channels nav-badge provider, no toast. |
| D9 | Runtime switch | **`SwitchResult.channels` section** (source/target owner, bridge config source, projected state on target, setup list) in dry-run and real runs; explicit ownership copy both directions; client stops narrowing `credentials.channels`. |
| D10 | Routing settings | **Move `notifications.channel`, `approvals.channelAlerts`, `approvals.channel`, `notifications.channelAliases`** into the Channels tab "Routing" section. `approvals.requireRejectReason` stays in System & Alerts. **v2:** the alias map is written with REPLACE semantics through `PUT /api/channels/routing` (§4.5), because the generic deep-merge settings path cannot delete a key. |
| D11 | Config write path | **Change subscriptions**: the bridge subscribes to settings changes (new `subscribeSettingsChanged` in core settings) and secret-store changes (new notification on set/unset), diffs the Discord block and **a hash of the resolved token value** (env or store — presence alone would miss an A→B rotation), and bumps the desired generation. Every writer (tab, generic settings POST, routing route, CLI) triggers it. Subscriptions are armed once, on the first server-driven reconcile, so a CLI process writing settings never starts a loop. |
| D12 | CLI | **`bakin channels {status,verify,reconnect}`** (HTTP clients, `--json`). **v2:** `bakin check channels` (and `check all`) is HTTP-backed when a server is reachable and returns an explicit configuration-only result when it is not (§4.10). **v3:** `bakin check <target>` and `bakin check all` gain `--json` (structured `CheckResult` / array, exit codes unchanged). |
| D13 | Delivery shape | **One branch in the main checkout, one PR, 10 dependency-ordered checkpoint commits** (§9), live-tested on 3737 before merge. Rollback = revert dependents in reverse order. |
| D14 | Native runtime (OpenClaw) | **Native ownership takes precedence over bridge configuration.** Channels tab shows owner = runtime, state `native`, the runtime's channel list read-only; the Bakin bridge block is shown as idle configuration, never as a problem, whatever its token/guild state. |
| D15 | Deterministic tests (v3) | **No live Discord in any test.** A fake transport module (`src/core/delivery/discord/fake-transport.ts`) is selected by `loadDiscordModules()` only when `BAKIN_DELIVERY_TRANSPORT=fake` (scenario via `BAKIN_DELIVERY_FAKE=ready:<guildIds>\|reject-401\|hang`), with a loud boot warning — the same env-override precedent as `BAKIN_RUNTIME_ADAPTER` and `BAKIN_CHANNEL_TEST_MODE`. The cross-surface integration test boots a real server with it. |

Inherited, unchanged: D11 of the bridge spec (bridge never boots on a
natively-delivering runtime), D13 (no durable outbox), the token is never
injected into `process.env`, Bakin never reads `~/.openclaw`.

## 4. Design

### 4.1 Readiness: types, classifier, collector

**Neutral types** (`packages/core/src/delivery/readiness.ts`, exported via
`@bakin/core/delivery`; shared by core, app, host client, CLI):

```ts
export type ChannelReadinessState =
  | 'native' | 'disabled' | 'missing_token' | 'missing_guild'
  | 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'failed'

export type DeliveryErrorKind =
  | 'not_configured' | 'not_connected' | 'auth_failed' | 'intents'
  | 'target_not_found' | 'forbidden' | 'rejected' | 'timeout' | 'transport'

export interface DeliveryErrorSummary { kind: DeliveryErrorKind; message: string; at: string }

export interface RoutingTarget {
  setting: string                       // e.g. 'notifications.channel', 'notifications.channelAliases.alerts'
  value: string | null                  // configured ref/alias, null = unset
  resolved: 'ok' | 'unset' | 'unknown_channel' | 'unverifiable'  // unverifiable = no channel list available
  channelId?: string
}

export interface GuildReadiness {
  id: string; name?: string; joined: boolean | null   // null = not yet known
  channelCount: number | null; error?: DeliveryErrorSummary
}

export interface ChannelReadiness {
  runtime: { adapter: string; deliveryMode: CapabilityMode }
  owner: 'runtime' | 'bridge' | 'none'
  enabled: boolean
  token: { present: boolean; source: 'env' | 'store' | null }   // never the value
  guilds: GuildReadiness[]
  connection: {
    state: ChannelReadinessState
    since: string                       // ts of the last STATE transition; stable across refreshes
    lastError: DeliveryErrorSummary | null
    botUser?: { id: string; name: string }
    attempt?: { generation: number; startedAt: string }   // present while connecting
  }
  channels: { items: ChannelInfo[]; source: 'bridge' | 'runtime' | 'none'; collectedAt: string | null; error?: DeliveryErrorSummary }
  routing: { alertChannel: RoutingTarget; approvalsChannel: RoutingTarget; approvalsEnabled: boolean; aliases: RoutingTarget[] }
  generatedAt: string
}

export interface BridgeStatus {          // what the bridge itself knows (no settings, no runtime)
  state: 'idle' | 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'failed'
  since: string; lastError: DeliveryErrorSummary | null
  botUser?: { id: string; name: string }
  joinedGuildIds: string[]; guildResults: GuildReadiness[]
  generation: number                    // the last APPLIED config generation
  attempt?: { generation: number; startedAt: string }   // present while an attempt is in flight
}

/** Projection for previews (runtime switch): no bridge observation involved. */
export type ProjectedChannelState =
  | 'native' | 'disabled' | 'missing_token' | 'missing_guild' | 'ready_to_connect'
```

**Observation vs. projection — two pure functions** (same file; exhaustive
test matrices):

- `classifyChannelReadiness(facts): ChannelReadinessState` — facts:
  `deliveryMode`, `enabled`, `tokenPresent`, `guildCount`, `bridge:
  BridgeStatus` (NON-null: after boot the bridge always has a status).
- `projectChannelReadiness(facts): ProjectedChannelState` — same facts
  WITHOUT `bridge`; rows 1–4 below, else `ready_to_connect` ("ready to
  connect after restart"). A configured but unprobed target is never
  reported as a connection failure.

Precedence for the classifier (first match wins):

| # | Condition | State |
|---|---|---|
| 1 | `deliveryMode === 'native'` | `native` — the runtime owns delivery; the Bakin bridge block is idle configuration regardless of enabled/token/guilds |
| 2 | `!enabled` | `disabled` |
| 3 | `!tokenPresent` | `missing_token` |
| 4 | `guildCount === 0` | `missing_guild` |
| 5 | `bridge.state === 'connecting'` or `bridge.attempt` present | `connecting` |
| 6 | `bridge.state === 'connected'` and every configured guild joined + enumerated | `connected` |
| 7 | `bridge.state === 'connected'` otherwise, or `bridge.state === 'degraded'` | `degraded` |
| 8 | `bridge.state === 'disconnected'` | `disconnected` |
| 9 | `bridge.state === 'failed'`, or `idle` with no attempt | `failed` (lastError from the bridge; an `idle` bridge with no attempt under a configured, non-native runtime means "never attempted" — reported as `failed` with kind `not_connected` and that copy, because the classifier must never invent `connected`) |

`owner` = `runtime` for rule 1, `bridge` for 2–9 when a bridge handle
exists, `none` when the adapter exposes no surface at all.

**Collector** (`src/core/delivery/readiness.ts`):

- `getChannelReadiness(): ChannelReadiness` returns the cached snapshot
  synchronously (always available after boot; before the first collection
  it is the classifier over config + `bridge.status()` with
  `channels.source = 'none'`, `collectedAt = null`).
- `refreshChannelReadiness(reason): Promise<ChannelReadiness>` recollects
  async facts — native runtime channel list via `runtime.channels.list()`
  under a 2 s budget (failure ⇒ `channels.error`, previous items kept with
  their old `collectedAt`; stale beats broken), bridge guild results, and
  routing resolution — then classifies, publishes, and returns.
- Refresh triggers: bridge status transition (`bridge.subscribe`), settings
  change touching `integrations.discord` / `notifications` / `approvals`,
  secret change on `discord.botToken`, Verify completion, runtime boot.
  Refreshes are coalesced (one in flight, one queued).
- `subscribeChannelReadiness(listener)` fires on EVERY published snapshot
  with `{ previous, next, stateChanged }`. Consumers: SSE
  `channels.readiness` (every publish), targeted health rerun (when
  `stateChanged` or routing resolution changed), debounced 1 s.
- `since`: carried over from the previous snapshot when `state` is
  unchanged; set to `generatedAt` on a transition.

### 4.2 Bridge: state model and reconciliation

**Contract** (`packages/core/src/delivery/bridge.ts`):

```ts
export interface ChannelBridge {
  isConfigured(): boolean
  status(): BridgeStatus
  /** Converge the transport on the CURRENT configuration. Resolves when the
   *  attempt for the latest generation settles (connected/degraded/failed)
   *  or the bridge is stopped. Safe to call concurrently. */
  reconcile(reason: 'boot' | 'settings' | 'secret' | 'operator' | 'runtime'): Promise<BridgeStatus>
  subscribe(listener: (status: BridgeStatus) => void): () => void
  shutdown(): Promise<void>
  channels: ChannelSurface
}
```

`boot()` is removed; the server calls `reconcile('boot')`.

**Reconciliation** (`src/core/delivery/index.ts`):

- `desiredGeneration` increments on every relevant change (settings diff
  on the Discord block, token presence change, operator request, runtime
  boot). `reconcile()` returns the shared promise of the loop, which runs
  attempts until `appliedGeneration === desiredGeneration` or `stopped`.
- One attempt at a time. An attempt captures `generation` and the config
  snapshot (settings + token value) at start. When it settles: if its
  generation is still desired → apply (publish `connected`/`degraded`/
  `failed`); otherwise → destroy any transport it created, publish
  nothing from it, and loop.
- Desired config says "should not run" (native, disabled, missing token,
  missing guild) → the attempt is a teardown: destroy the current
  transport, publish `idle`, log ONE line with the reason.
- `shutdown()` sets `stopped`, awaits the in-flight attempt (which then
  destroys its transport), destroys the current transport, audits
  `delivery.disconnected`.
- Transport-level events (`WebSocketShardEvents.Closed`/`Error`/`Resumed`,
  READY) update `BridgeStatus` only when they carry the applied
  generation; stale transports are ignored and destroyed.
- Classification of connect failures into `DeliveryError` kinds:
  `auth_failed` (REST 401 from `GET /gateway/bot` — the usual path for a
  bogus token, which never reaches the socket — or gateway close 4004),
  `intents` (4013/4014), `timeout` (READY timeout), `transport` (everything
  else, incl. abort). Stored as `lastError`, audited as
  `delivery.connect_failed` (kind + sanitized message, never the token).
  `delivery.reconciling` audits the coalesced reasons and generation once
  per attempt start.
- Transport prerequisites (verified against `@discordjs/ws@2.0.4`): the
  manager's `Closed`/`Error`/`Ready`/`Resumed` shard events are subscribed at
  construction — without an `error` listener the manager THROWS on a fatal
  close and `gateway.connect()` never resolves; `connect()` races
  `gateway.connect()` against a READY gate that a fatal close rejects early
  with the code; `destroy()` is idempotent and always destroys the manager;
  our own teardown's `closed 1000` echo is suppressed.
- Operator semantics (D7): `reconcile('operator')` joins a running loop;
  with nothing running it bumps and forces a fresh attempt even for an
  identical config. Automatic reasons bump only when the Discord block or
  the token hash actually changed (snapshot key = settings block JSON +
  sha256(token) + delivery mode); an unchanged key applies silently.
- `reconcileDeliveryBridge(runtime, 'boot' | 'runtime')` reads
  `capabilities().delivery.mode` once (Pi's `capabilities()` probes models —
  never per settings write) and caches it for the loop. Callers: `server.ts`
  at boot; `runtime-switch.ts` after the real switch's `createAppServices()`
  and in `restore()`. `reconcile()` before any `'boot'` is a non-run reason
  `runtime_unknown`, logged like the others.
- Channel cache records a per-guild result (`guildResults`); a failing
  guild no longer hides the others; READY's `data.guilds` fills
  `joinedGuildIds`.
- Covered by tests: rapid saves A→B while A connects (B wins, A's
  transport destroyed, never applied); disable during connect; token
  cleared during connect; shutdown during reconcile; runtime boot on a
  native runtime with a configured bridge (teardown, `idle`); operator
  reconcile while an automatic one is in flight (joins, never discards).

### 4.3 Typed errors (`packages/core/src/delivery/errors.ts`)

```ts
export class DeliveryError extends Error {
  constructor(
    readonly kind: DeliveryErrorKind,
    message: string,
    readonly detail: { state?: ChannelReadinessState; target?: string; guildId?: string; status?: number } = {},
  ) { super(message); this.name = 'DeliveryError' }
}
```

The bridge throws `DeliveryError` wherever it threw a plain Error (the
`not_connected`/`not_configured` kinds carry the readiness `state` in
`detail`). `send.ts` wraps REST errors: 401 → `auth_failed`; 403 →
`forbidden`; 404 → `target_not_found`; other 4xx (≠429) → `rejected`
(non-retryable, never described as "after retries"); 5xx / network →
`transport` (retried, "after retries"); READY/HTTP timeouts → `timeout`.
Consumers classify by `kind` only; `tests/architecture` gains a rule
banning `.message.includes(` / regex over `DeliveryError` messages.

### 4.4 Secret slots (`packages/core/src/secrets/slots.ts`)

```ts
export interface SecretSlotDef {
  provider: string; name: string; label: string; description: string
  envVar?: string; injectEnv: boolean      // brave: true; discord: false (never in process.env)
  owner: { label: string; href: string }   // Settings → Channels, …
}
export const SECRET_SLOT = {
  discordBotToken: { provider: 'discord', name: 'botToken', envVar: 'DISCORD_BOT_TOKEN', injectEnv: false, … },
  braveApiKey:     { provider: 'brave',   name: 'apiKey',   envVar: 'BRAVE_SEARCH_API_KEY', injectEnv: true, … },
} as const satisfies Record<string, SecretSlotDef>
export const SECRET_SLOTS: readonly SecretSlotDef[] = Object.values(SECRET_SLOT)

/** Presence only — safe for any surface. */
export function resolveSecretSlotStatus(def: SecretSlotDef): { present: boolean; source: 'env' | 'store' | null }
/** The value — PRIVATE to transports (delivery/config.ts, secret-env.ts). Not re-exported by @bakin/core's public barrel. */
export function readSecretSlotValue(def: SecretSlotDef): string | null
```

`src/core/secret-env.ts` derives `STATIC_ENV_SECRET_MAPPINGS` from rows
with `injectEnv`. `delivery/config.ts` reads through `readSecretSlotValue`.
The secret store emits `subscribeSecretChanged((provider, name) => …)`
from `setStoredSecret` / `unsetStoredSecret`. `GET /api/secrets` adds
`slots: Array<SecretSlotDef & { status }>`; the names-only `secrets` map
stays for pack slots. Consumers of the response (`provider-keys-tab.tsx`,
tests) migrate in the same commit.

### 4.5 Routes (`packages/host/src/api/channels.ts`)

| Route | Behavior |
|---|---|
| `GET /api/channels` | The cached snapshot. `?refresh=1` forces a collection first. |
| `POST /api/channels/reconnect` | Owner `runtime` → 409 `{ error: 'owner_is_runtime' }`. Otherwise bumps the desired generation (`operator`), returns 202 `{ readiness }` with `connecting`. A request while an attempt is in flight ALSO returns 202 (it joins; nothing is discarded). Terminal result arrives via SSE `channels.readiness` and `GET /api/channels`; `?wait=1` long-polls up to 45 s and returns the settled snapshot (200) or 202 if still connecting. |
| `POST /api/channels/verify` | Read-only probe → 200 `{ items, readiness }`. State `connecting` → 409 `{ error: 'connecting' }`. Never sends. Ends with a targeted rerun of `delivery-discord` + dependents and a readiness refresh. |
| `PUT /api/channels/routing` | Body `{ alertChannel: string \| null, approvalsEnabled: boolean, approvalsChannel: string \| null, aliases: Record<string, string> }`, zod-validated (alias names `^[a-z0-9][a-z0-9-]{0,63}$`, targets non-empty). Writes `notifications.channel`, `approvals.channelAlerts`, `approvals.channel` via `updateSettings` and REPLACES `notifications.channelAliases` wholesale via a new core `replaceSettingsValue(path, value)` (no merge). Returns the refreshed snapshot. Tested: add, rename, delete, reload. |

**Verify items** `{ key, status: 'pass' | 'fail' | 'skipped', summary, detail?, setting? }`:

| Key | bridge `connected`/`degraded` | `native` | `disabled` / `missing_token` / `missing_guild` / `failed` / `disconnected` |
|---|---|---|---|
| `gateway` | pass with bot identity, or fail | skipped "owned by the runtime" | skipped with the state's remediation (same copy table) |
| `guild:<id>` | pass/fail from live `GET /users/@me/guilds`; checks guild-level View Channels + Send Messages, labeled "guild-level permissions — channel overrides not checked" | skipped | skipped |
| `channels:<guild>` | pass/fail; refreshes the cache (folds in the deferred on-demand refresh TODO) | runtime list via `runtime.channels.list()` (pass/fail) | skipped |
| `routing:notifications.channel` | pass / fail `unknown_channel` / skipped "not configured" | same, against the runtime list | skipped |
| `routing:approvals.channel` | skipped "approval alerts disabled" when `channelAlerts` is false; else as above | same | skipped |
| `routing:alias:<name>` | as above, per alias | same | skipped |
| `health` | the targeted rerun's outcome for `delivery-discord` | same | same |

"All pass" copy on the tab reads "Connection and routing verified
(guild-level permissions only)".

**Reconnect terminal contract**: the settled snapshot's `connection.state`.
CLI exit codes: `connected` → 0; `degraded` → 2 (names the guilds);
`disabled` / `missing_token` / `missing_guild` → 2 with the copy-table
remediation (nothing to connect — not an error, not success);
`failed`/`disconnected` → 1 with `lastError`; still `connecting` after the
wait → 1 "timed out waiting for the bridge"; 409 `owner_is_runtime` → 0
with the native explanation.

### 4.6 Post-channel tool (`src/core/exec-tools/tools/post-channel.ts`)

Order of operations:

1. Workflow policy check (unchanged).
2. **Identical-retry memo lookup.** The signature is computed from the
   params alone — agent, normalized REQUESTED channel, content, embed,
   asset ids, repost, taskId, test mode — with NO channel-surface call, so
   it can be found while the bridge is down. The memoized result stores
   the resolved channel. A completed or partially completed post retried
   verbatim while the bridge is `disconnected`/`failed` returns the saved
   result (`deduped: true`), never a fresh readiness failure that would
   hide evidence content already went out.
3. **Pre-flight** against `getChannelReadiness()`: on owner `bridge`, any
   state other than `connected`/`degraded` fails with the copy below and
   nothing else runs (no alias resolution, no send). On owner `runtime`
   (native) pre-flight passes. On owner `none` → "no channel layer".
4. Alias resolution. `resolveRuntimeChannelRef` no longer swallows
   `DeliveryError`s; on `degraded` it resolves against the joined guilds'
   channels, and a target in an unjoined guild fails `target_not_found`
   with the guild id.
5. Once-per-task asset guard (unchanged).
6. Chunked delivery. Each chunk's result is tracked; the attempt record is
   `{ delivered: number, total: number, uncertain: boolean }`.

| Kind (+ state) | Agent sees |
|---|---|
| `not_configured` / `disabled` | Discord delivery is disabled. Enable it in Settings → Channels. |
| `not_configured` / `missing_token` | Discord is enabled but its bot token is missing. Add the token in Settings → Channels, then reconnect. |
| `not_configured` / `missing_guild` | Discord is enabled but no server is configured. Add a guild ID in Settings → Channels. |
| `not_connected` / `connecting` | Discord bridge is still connecting. Retry in a few seconds. |
| `not_connected` / `disconnected` or `failed` | Discord bridge is not connected (<kind: message>). Use Reconnect in Settings → Channels. |
| `auth_failed` | Discord rejected the bot token. Replace it in Settings → Channels. |
| `intents` | Discord refused the bot's gateway intents. Enable Message Content Intent for the bot in the Discord developer portal, then reconnect. |
| `target_not_found` | Channel <ref> is not in a connected server<, guild <id> is not joined>. Pick a channel from Settings → Channels. |
| `forbidden` | The bot lacks permission to post in <channel>. Fix the channel permissions in Discord. |
| `rejected` | Discord rejected the post: <reason>. (No retry was attempted.) |
| `timeout` / `transport` | Discord delivery failed after retries: <reason>. Retry later. |

Every failure result carries `chunksDelivered`/`chunkCount` so an agent
can see a partial delivery.

**Memoization rule** (outcome-based): a failed result is memoized for the
TTL when `delivered > 0` OR `uncertain` (a chunk call threw after the
request may have reached Discord: `timeout`, `transport`, any error after
the first chunk). A failed result bypasses the memo only when it is
confidently unsent: pre-flight failures, alias-resolution failures, and
first-chunk failures with kinds `not_connected`, `auth_failed`, `intents`,
`target_not_found`, `forbidden`, `rejected` (deterministic 4xx — the
request was refused, nothing was posted). Regression test: chunk 1
succeeds, chunk 2 throws `auth_failed` → the result is memoized and a
verbatim retry returns it with `deduped: true` instead of re-sending
chunk 1.

The copy table lives in `src/core/delivery/copy.ts` and is shared with
the onboarding check, the CLI, and the tab Banner.

### 4.7 Health (`plugins/health/lib/system-checks/`)

`delivery-discord.ts` becomes a projection of the snapshot, evaluated in
the precedence order of §4.1 (native FIRST):

| State | Finding |
|---|---|
| `native` | healthy, key `idle` (unchanged copy) — never an incident, whatever the bridge block holds |
| `disabled` | not-applicable |
| `missing_token` | action_required, key `missing-token`, navigate → `/settings?tab=channels` |
| `missing_guild` | action_required, key `missing-guild`, navigate → tab |
| `connecting` | watch observation, no incident (the bridge's own READY timeout bounds it) |
| `failed` | action_required, key `bridge-failed`, detail = classified kind, navigate → tab |
| `disconnected` | action_required, key `bridge-disconnected`, navigate → tab |
| `degraded` | action_required, key `guild-unjoined`, lists the guild ids, navigate → tab |
| `connected` | healthy (+ existing empty-allowlist `policy_denial` watch notices) |

`channel-aliases.ts` and `channel-approvals.ts` read the snapshot instead
of calling `channels.list()`:

- owner `none` → not-applicable (today's copy).
- owner `bridge` and state ∉ {`connected`, `degraded`} → not-applicable
  with "Channel delivery is unavailable (<state>) — see the Discord
  delivery bridge check." They never emit their own incident for a
  delivery outage.
- otherwise → today's logic over `readiness.channels.items` (aliases) and
  the channel capabilities (approvals); `channels.error` ⇒ `healthUnknown`
  as today (a genuinely failed enumeration on a connected bridge is an
  evidence gap).
- Navigate hrefs move to the tab.

Rerun wiring (`plugins/health/index.ts`): `subscribeChannelReadiness` →
when `stateChanged` or routing changed → `runDetailedPluginHealthChecks`
for `health.delivery-discord`, `health.channel-aliases`,
`health.channel-approvals` → `applyHealthCheckRuns`, debounced 1 s.
Acceptance test: the reproduction state yields exactly one incident
(`missing-token`) across the three checks; recovery leaves zero.

### 4.8 Pi adapter (`packages/adapter-pi/src/runtime.ts`)

- `get channels()` returns `bridge.channels` whenever `initOpts.channelBridge`
  exists.
- `capabilities().delivery.mode`: `shimmed` iff `bridge.isConfigured()`.
- `credentialStatus().channels`: enumerated channel labels when
  `bridge.status().state` is `connected`/`degraded`, else `[]`.
- Conformance: new pin "a threaded bridge ⇒ surface present regardless of
  configuration" in `channel-bridge-delegation.test.ts`; the existing
  native/shimmed ⇒ present pins stay; the teeth file proves the new pin
  bites.

### 4.9 Runtime switch (`src/core/runtime-switch.ts`, `switch-report.ts`)

```ts
channels: {
  source: { owner: 'runtime' | 'bridge' | 'none'; state: ChannelReadinessState }
  target: { owner: 'runtime' | 'bridge' | 'none'; projectedState: ChannelReadinessState; tokenSource: 'env' | 'store' | null }
  setup: string[]     // owner-facing steps, empty when nothing to do
  ownership: string   // explicit copy, both directions
}
```

`projectedState` = the pure classifier over current settings + token
presence + the target's declared delivery mode + `bridge: null` (never
connects during a switch or dry run). Client (`runtimes-tab.tsx`) renders
it in the preview and the result with a `PluginLink` to the tab when
`setup` is non-empty; `types.ts` stops narrowing `credentials.channels`.

### 4.10 Onboarding + CLI

- `channelsComponent.check()` has two modes, chosen by whether a server is
  reachable through the BAKIN_URL-aware client (`src/cli/http.ts`):
  - **server mode**: `GET /api/channels` → `native` with runtime channels
    → ok; `connected` → ok (lists channels); `degraded` → warn naming the
    guilds; every other state → warn with the copy-table remediation and
    `href: /settings?tab=channels`.
  - **configuration-only mode** (no server): reads settings + slot STATUS
    from the CLI process's own env/store and returns `warn`/`ok` labeled
    "server not running — configuration only; connection state unknown
    (missing_token here does not rule out a server-side env token)". It
    never claims connected and never claims "no channel layer".
  `checkAll()` uses the same component, so `bakin check all` inherits both
  modes. `install()` stays a no-op. Test: spawn the CLI as a separate
  process with a DIFFERENT env than the isolated server (server has the
  env token, CLI does not) and assert server mode reports the server's
  truth.
- `src/cli/commands/channels.ts`: `status` (table or `--json`), `verify`
  (item list; exit 1 on any `fail`, 2 when the state made everything
  `skipped`), `reconnect` (`POST …?wait=1`, exit codes per §4.5).
  Registered in `cli/bakin.ts` + help. All three require a reachable
  server and say so otherwise.
- `bakin check <target> --json` and `bakin check all --json` print the
  structured `CheckResult` (or array) and nothing else; exit codes are
  unchanged (0 ok, 1 error/missing/broken, 2 warn).

### 4.11 UI (host)

Load `.claude/skills/bakin-ui-conformance/SKILL.md` before building.
Start from `storybook/public/recipes/settings-dashboard-pages.stories.tsx`,
`feedback/banner.stories.tsx` (`CanonicalUsage`/`TonesAndActions`),
`system-state.stories.tsx` (`StateMatrix`/`ScopeAndRecovery`),
`status-badge.stories.tsx`. Compose only `@makinbakin/sdk/{ui,layout,
patterns,navigation}`; URL state via `useQueryState`; `PluginLink` for
every internal link; no new design-system primitives without separate
approval (none expected).

`src/components/channels-tab.tsx` (`CHANNELS_TAB_ID = 'channels'`):

1. **Status header** — `StatusBadge` per fact: Runtime, Owner, Enabled,
   Token (Not set / Bakin store / Environment), Connection (state + since),
   Bot identity. A `Banner` for any state other than `connected`/`native`
   with the inline recovery action (Reconnect / Add token / Add guild /
   Fix intents) and the classified last error. `degraded` is a warning
   Banner naming the guilds.
2. **Bridge settings** — enabled, guild IDs, approvers, inbound (enabled,
   agent, requireMention, allowFrom). The three ID lists use a text-entry +
   Add composition (`InputGroup — LocalSubmitAction`) over removable rows
   (`ListRows — InteractiveRows`, each row's Remove button labeled with the
   id) — NOT a Combobox: those select from a predefined catalog, and
   first-time setup must accept ids that have never been discovered. Saves
   through `POST /api/settings`; feedback shows "reconnecting…" then the
   settled state from SSE.
3. **Bot token** — the shared slot field (`src/components/secret-slot-field.tsx`:
   write-only input, status badge, Set / Clear). Env-sourced shows "set by
   DISCORD_BOT_TOKEN; the stored value is ignored while the variable is
   set". On a native runtime the section is annotated "idle — the runtime
   owns delivery".
4. **Servers & channels** — per guild: joined badge, channel count, error;
   channel table (label, id, capabilities) with copy-id. On native: the
   runtime's list, read-only, labeled as runtime-owned.
5. **Routing** — alert channel, approvals channel (+ `channelAlerts`
   toggle), alias table (name → channel) with add/rename/delete; each a
   picker over `readiness.channels.items` with free-text fallback when the
   list is empty/unverifiable. Saves through `PUT /api/channels/routing`.
6. **Actions** — Reconnect (busy while `connecting`, disabled on native
   with the explanation), Verify (busy; result list inline with
   pass/fail/skipped rows and `PluginLink` to the owning field via
   `?field=`; disabled while `connecting`).

Live updates: subscribe to SSE `channels.readiness`; refetch on settings /
secrets writes.

Integrations & Keys: known-slot rows from `slots` (label, owner link,
status badge, Set / Clear via the shared field) above the existing table;
free-form add moves under a collapsed "Custom secret" section.

System & Alerts: removed from `SYSTEM_SETTINGS_SCHEMA` are the seven
`integrations.discord.*` fields plus `notifications.channel`,
`approvals.channelAlerts`, and `approvals.channel`;
`approvals.requireRejectReason` STAYS (approval policy, not routing).
`CSV_LIST_KEYS` shrinks accordingly.

Runtime page: the "Channel delivery" row shows the readiness state with a
`PluginLink` to the tab (Overview) and the switch report's channels
section (Runtimes tab).

## 5. Tech stack

Bun 1.3.13 (pinned), TypeScript strict, zod at boundaries, React 19 +
TanStack Router (host), `@makinbakin/sdk/*` focused entrypoints,
`@discordjs/{core,rest,ws}` (unchanged, no new deps), bun:test +
happy-dom + RTL, Storybook (public) as the UI contract.

## 6. Commands

```
Dev:            bun run dev                      # host/plugins watch; server code needs a manual restart
Typecheck:      bun run typecheck
Lint:           bun run lint
One test file:  bun test tests/core/delivery/readiness.test.ts --isolate
Full suite:     bun run test                     # never concurrently with ui:conformance
UI quick gate:  bun run ui:conformance --quick
UI full gate:   bun run ui:conformance            # merge-ready UI changes
Cycles:         bun run check:cycles
Isolated live:  /verify skill (isolated BAKIN_HOME server from source; never the compiled binary with a throwaway home)
```

## 7. Project structure (files this work touches)

```
packages/core/src/delivery/readiness.ts         NEW  neutral types + pure classifier
packages/core/src/delivery/errors.ts            NEW  DeliveryError + kinds
packages/core/src/delivery/bridge.ts                 status()/reconcile()/subscribe(); boot() removed
packages/core/src/secrets/slots.ts              NEW  registry, status resolver, private value reader
packages/core/src/media/secret-store.ts              subscribeSecretChanged
packages/core/src/settings.ts                        subscribeSettingsChanged, replaceSettingsValue
packages/core/src/merge.ts                           unchanged (documented limitation)
src/core/delivery/readiness.ts                  NEW  collector, cache, refresh triggers, subscription
src/core/delivery/copy.ts                       NEW  the one cause/next-step copy table
src/core/delivery/index.ts                           reconciliation loop, status, boot logging
src/core/delivery/discord/client.ts                  status(), READY guilds, ws events, error classification
src/core/delivery/discord/channel-cache.ts           per-guild results
src/core/delivery/discord/send.ts                    DeliveryError wrapping, 401/403/404/4xx/5xx split
src/core/delivery/audit.ts                           connect_failed, reconciling
src/core/delivery/config.ts                          reads the slot registry (private value reader)
src/core/channel-aliases.ts                          readiness-aware resolver (no swallowed DeliveryError)
src/core/secret-env.ts                               mappings from the registry
src/core/exec-tools/tools/post-channel.ts            pre-flight, mapping, outcome-based memo
src/core/onboarding/credentials.ts                   two-mode channels check
src/core/runtime-switch.ts, switch-report.ts         channels section
src/core/server/request-handler.ts                   /api/channels dispatch
src/cli/http.ts                                      reachability probe reuse
src/cli/commands/channels.ts                    NEW  status/verify/reconnect
cli/bakin.ts, src/cli/help.ts                        registration
packages/adapter-pi/src/runtime.ts                   permanent surface, credential channels
packages/host/src/api/channels.ts               NEW  routes (GET, reconnect, verify, routing)
packages/host/src/api/secrets.ts                     slots in GET
packages/host/src/routes/settings.tsx                tab registration
packages/host/src/components/runtime/{types,runtimes-tab,overview-tab,shared}.tsx
src/components/channels-tab.tsx                 NEW
src/components/secret-slot-field.tsx            NEW  shared write-only slot field
src/components/provider-keys-tab.tsx                 known slots (same commit as the API change)
src/components/system-settings.ts                    fields removed
plugins/health/lib/system-checks/{delivery-discord,channel-aliases,channel-approvals}.ts
plugins/health/index.ts                              readiness → targeted rerun wiring
server.ts                                            reconcile('boot')
tests/core/delivery/{readiness-classify,readiness-collect,reconcile,status,errors}.test.ts   NEW
tests/core/secrets/slots.test.ts                NEW
tests/api/{channels,secrets}.test.ts
tests/core/exec-tools/post-channel.test.ts
tests/core/channel-aliases.test.ts
tests/plugins/health/{delivery-discord-check,channel-aliases-check,channel-approvals-check}.test.ts
tests/adapter-pi/channel-bridge-delegation.test.ts
tests/integration/runtime-conformance/{conformance,teeth.conformance.test}.ts
tests/integration/channels/readiness-agreement.test.ts   NEW  isolated server: API + tool + health + CLI (both modes)
tests/core/runtime-switch*.test.ts, tests/core/onboarding/*.test.ts
tests/cli/channels.test.ts                      NEW
tests/components/{channels-tab,secret-slot-field,provider-keys-tab,system-settings,settings-route-*}.test.tsx
storybook/public/… stories for the tab states (see §10)
tests/architecture/*                                 DeliveryError kind-only rule
docs: .claude/knowledge/delivery-bridge.md, .claude/knowledge/pi-adapter.md (degradation matrix rows),
      .claude/knowledge/adapter-architecture.md (onboarding/channels statements), CLAUDE.md,
      docs/src/content/docs/using/essentials.md, docs/src/content/docs/reference/generated/settings.md (regenerate),
      .claude/specs/discord-bridge/TODO.md, README.md (only if it gains a channel claim — none today)
```

## 8. Code style

```ts
// packages/core/src/delivery/readiness.ts — pure, exhaustive, no I/O
export function classifyChannelReadiness(facts: ReadinessFacts): ChannelReadinessState {
  if (facts.deliveryMode === 'native') return 'native'
  if (!facts.enabled) return 'disabled'
  if (!facts.tokenPresent) return 'missing_token'
  if (facts.guildCount === 0) return 'missing_guild'
  const bridge = facts.bridge
  if (!bridge || bridge.state === 'connecting' || bridge.attemptPending) return 'connecting'
  switch (bridge.state) {
    case 'connected': return everyGuildReady(facts, bridge) ? 'connected' : 'degraded'
    case 'disconnected': return 'disconnected'
    case 'degraded': return 'degraded'
    case 'failed':
    case 'idle': return 'failed'
  }
}
```

Conventions: kebab-case files, `PascalCase` types, `UPPER_SNAKE_CASE`
constants, `const` only, no empty catch, every 5xx handler logs the stack,
zod at every HTTP boundary, SDK-only imports in browser code, `kind`
classification only — never `err.message.includes(...)`.

## 9. Commit strategy (one branch `feat/channel-readiness`, one PR)

Dependency-ordered checkpoints. Each commit leaves the tree green
(`bun run lint && bun run typecheck` + the touched test files). Rollback
is honest: reverting commit N requires reverting N+1…10 first (they
consume its contracts); the branch is never merged partially.

The authoritative task breakdown is `PLAN.md` (T0–T12); the commit map:

| # | Scope | Task |
|---|---|---|
| 1 | `docs(spec): channel readiness v3 amendments + plan` | T0 |
| 2 | `feat(core): readiness types/classifier/projector, DeliveryError, secret-slot registry, change subscriptions` | T1 |
| 3 | `feat(secrets): slot status in /api/secrets, known-slot rows, shared secret field` | T2 |
| 4 | `feat(delivery): bridge status model, reconciliation loop, per-guild cache, error classification` (+ every `ChannelBridge` fixture migrated) | T3 |
| 5 | `feat(delivery): readiness collector, /api/channels, SSE, fake transport gate` | T4 |
| 6 | `feat(health): readiness projection, readiness-aware channel checks, targeted reruns, two-mode check` | T5 |
| 7 | `feat(exec-tools): post-channel memo-first retries, pre-flight, classified failures` | T6 |
| 8 | `feat(adapter-pi): permanent channels surface, credential channels, conformance pin` | T7 |
| 9 | `feat(cli): bakin channels + check --json` | T8 |
| 10 | `feat(runtime): channels section in the switch report + runtime page` | T9 |
| 11 | `feat(host): Channels settings tab, routing fields moved, browser fixture` | T10 |
| 12 | `test(integration): readiness agreement across API, tool, health, CLI` | T12 |
| 13 | `docs(delivery): channel readiness` | T11 |

Before the PR: `bun run test` (full), `bun run ui:conformance` (full,
sequential, never concurrent with the suite), `bun run check:cycles`.
Live test on 3737 by the owner; merge after approval.

## 10. Testing strategy

- **Unit (bun:test, `--isolate`)**: classifier matrix (every precedence
  row × token source × delivery mode, incl. native with enabled+no token
  ⇒ `native`); collector refresh triggers, stale-beats-broken channel
  evidence, `since` stability; transport status transitions with a mocked
  ws manager (READY, close 4004/4014, timeout, resume); reconciliation
  scenarios listed in §4.2; per-guild cache; REST error wrapping
  (401/403/404/other-4xx/5xx/timeout); slot status vs value resolution +
  change notification; settings change subscription diff;
  `replaceSettingsValue`; post-channel mapping for every kind, pre-flight
  before alias resolution, outcome-based memo incl. the chunk-1-ok /
  chunk-2-auth-failed regression; alias resolver on `degraded`; health
  projection per state for all three checks (and "exactly one incident"
  in the reproduction); onboarding check in both modes; switch report
  channels section (dry-run + real, both directions); CLI output + exit
  codes.
- **Conformance**: threaded bridge ⇒ surface present; shimmed/native pins
  unchanged; teeth prove the new pin bites.
- **API**: `/api/channels` GET/reconnect/verify/routing (409s, native 409,
  join-not-discard, `?wait=1`, never-sends via a mocked send surface,
  alias add/rename/delete/reload), `/api/secrets` slots.
- **Integration (`tests/integration/channels/readiness-agreement.test.ts`)**:
  boots an isolated server from source with `BAKIN_DELIVERY_TRANSPORT=fake`
  (D15 — no live Discord) in the reproduction state and asserts, from ONE
  run, that `GET /api/channels`, the post tool's failure (invoked through
  `POST /api/exec-tools/bakin_exec_post_channel`), the health report's
  incident set, and BOTH CLI paths spawned as separate processes with a
  different env (`bakin check channels --json`, `bakin channels status
  --json`, with a dummy `DISCORD_BOT_TOKEN` set only in the CLI env) agree
  on `missing_token`; then, under `BAKIN_DELIVERY_FAKE=reject-401`, sets a
  token through the secrets API and asserts convergence to
  `failed`/`auth_failed` with the incident keyed `bridge-failed` and zero
  alias/approval incidents; a third boot under `ready:<guild>` proves
  `connected`, Verify all-pass, and zero incidents.
- **Browser (RTL + stories)**: Channels tab StateMatrix (every readiness
  state, native included), loading/error/busy states for Reconnect +
  Verify, keyboard traversal (tab order, Enter/Space on actions, Escape
  on dialogs), narrow layout (375 px) with no horizontal scroll, long
  identifiers (snowflake ids, 80-char channel names) truncating with full
  value on hover/copy, recovery flow (missing token → set → connecting →
  connected → Banner gone), alias add/rename/delete. Stories carry
  `CanonicalUsage` first per the storybook contract.
- **Architecture**: delivery confinement unchanged; new rule: no message
  inspection on `DeliveryError`; no-hard-nav allowlist untouched.
- **Isolation**: every test mocks both content-dir facades and OpenClaw
  home; `getBakinPaths` mocks include `db` and `media`; RTL files import
  `rtl-settle` and use `actRender`; waits via `waitUntil`/`settleFor`.
- **Live runbook (owner, 3737)**. Preparation: the dev server currently
  gets its token from `DISCORD_BOT_TOKEN`; before the test the owner
  stores the token in the Bakin store (Integrations & Keys) and relaunches
  the dev server WITHOUT the env var so the store is the source (status
  must read "Bakin store"). Steps: (1) Clear the stored token → tab shows
  Missing token within seconds, incident appears, `bakin channels status`
  agrees, a post from an agent returns the missing-token copy. (2) Set
  the token → connecting → connected, incident clears, Verify all-pass.
  (3) Add a bogus guild id → degraded, Verify names it; remove it →
  connected. (4) Dry-run switch to openclaw shows the ownership copy.
  Restoration: confirm the token is in the store and the guild list is
  back to the original single guild before ending.

## 11. Boundaries

- **Always**: one readiness engine; classify by `kind`; never log, audit,
  broadcast, or render a token value; keep `@discordjs` imports inside
  `src/core/delivery/`; mock content dirs in every test; run lint +
  typecheck + touched tests before every commit; follow the UI conformance
  skill for every browser change; apply native precedence before any
  bridge-config judgment.
- **Ask first**: any new design-system primitive or story pattern; any
  contract change in `packages/core/src/adapters/runtime/concepts.ts`
  beyond what §4.8 lists; adding a dependency; sending anything to Discord
  from a verification path; changing the escalation policy.
- **Never**: read `~/.openclaw` or extract a runtime-owned secret; inject
  `discord.botToken` into `process.env`; boot the bridge on a natively
  delivering runtime; add a second attention/badge system; keep a
  compatibility shim for the removed System & Alerts fields, the old
  `boot()` member, or the old `/api/secrets` shape; edit the live box's
  `~/.bakin` by hand; touch margo.

## 12. Success criteria

1. Reproduction (isolated server, Pi, Discord enabled, one guild, no
   token): the API, the tab, the post tool, the health report, and both
   CLI paths report `missing_token` from one server run (the
   readiness-agreement integration test), the health report holds exactly
   ONE incident for it, and no post is attempted.
2. Saving the token flips the state to `connecting` then `connected`
   without a restart; a second save during connect wins; the incident
   clears after the targeted rerun; Verify reports all-pass (guild-level);
   a retried post succeeds (no stale memo); a post that delivered chunk 1
   before failing is memoized, never re-sent.
3. Every state in §4.1 has a classifier test, a health projection, a tab
   rendering, a Verify behavior, and a tool message; an OpenClaw (native)
   runtime renders `native` and is never flagged, even with the Bakin
   bridge block enabled and token-less.
4. An invalid token yields `failed`/`auth_failed`, never `connected`; a
   bogus guild id yields `degraded` naming the guild; alias/approval
   checks emit no incident while delivery is unavailable.
5. `bakin check channels` (server mode and configuration-only mode, each
   labeled), `bakin channels status`, the tab, and the doctor agree on one
   isolated server in every state above.
6. Alias add, rename, and delete survive a reload (replace semantics).
7. Runtime-switch dry-run and real runs show the channels section with
   ownership copy in both directions.
8. `tests/architecture` and conformance (incl. teeth) pass; `bun run test`,
   `bun run ui:conformance`, `bun run lint`, `bun run typecheck`,
   `bun run check:cycles` are green.
9. Docs updated: `.claude/knowledge/delivery-bridge.md` (readiness,
   reconciliation, slots, tab, routes), `.claude/knowledge/pi-adapter.md`
   degradation rows (channels / createThread / editMessage), adapter
   architecture onboarding statements, CLAUDE.md Discord bullet, docs site
   `using/essentials.md`, regenerated settings reference, discord-bridge
   TODO close-out of the two folded items.

## 13. Open questions

None blocking. Deferred, not in scope: channel-level permission
computation (Verify checks guild-level bits and says so); a second chat
platform; streaming replies; the remaining discord-bridge deferred items
not folded in (editApproval embed patch, idempotency-row GC, reply-relay
image attachments; the bridge-down reply-loss audit rides commit 3 since
`not_connected` is now a typed, auditable path).
