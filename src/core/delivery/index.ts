/**
 * Delivery bridge singleton: reconciliation to the latest desired
 * configuration (channel-readiness spec §4.2, D2).
 *
 * The bridge HANDLE is cheap and always constructible (adapters receive it
 * via AdapterInitOpts at createAppServices time); the Discord transport
 * only connects when the SERVER reconciles it (`reconcileDeliveryBridge` at
 * boot and on a runtime switch) — never inside createAppServices (read-only
 * CLI paths also build app services). Config changes (settings block,
 * token value) bump a desired generation; ONE attempt runs at a time; a
 * stale attempt's transport is destroyed and never applied. The transport
 * module is dynamically imported so CLI and doctor paths never evaluate
 * @discordjs.
 */
import { createHash } from 'crypto'
import type { ApprovalResolveEvent, CapabilityMode, ChannelInfo, InboundChannelMessage } from '@bakin/core/adapters/runtime'
import {
  DeliveryError,
  summarizeDeliveryError,
  type BridgeStatus,
  type ChannelBridge,
  type ChannelReadinessState,
  type ChannelSurface,
  type GuildReadiness,
  type ReconcileReason,
} from '@bakin/core/delivery'
import { SECRET_SLOT } from '@bakin/core/secrets'
import { createLogger } from '@/core/logger'
import type { DiscordIntegrationSettings } from '@/core/settings'
import { isDiscordConfigured, readDiscordConfig } from './config'
import { auditDelivery } from './audit'
import type { DiscordTransport, TransportEvent } from './discord/client'
import type { ChannelCache } from './discord/channel-cache'
import type { SendSurface } from './discord/send'
import type { ApprovalSurface } from './discord/approvals'

const log = createLogger('delivery')

type IdleReason = 'native' | 'disabled' | 'missing_token' | 'missing_guild' | 'stopped' | 'runtime_unknown'

interface DesiredConfig {
  settings: DiscordIntegrationSettings
  token: string | null
  deliveryMode: CapabilityMode | null
}

interface Applied {
  generation: number
  transport: DiscordTransport
  cache: ChannelCache
  send: SendSurface
  approvals: ApprovalSurface
  snapshotKey: string
  unsubscribeTransport(): void
}

/** The modules an attempt needs — loaded once, lazily (never on CLI paths). */
export interface DiscordModules {
  createDiscordTransport: typeof import('./discord/client').createDiscordTransport
  sendApiFromTransport: typeof import('./discord/client').sendApiFromTransport
  approvalApiFromTransport: typeof import('./discord/client').approvalApiFromTransport
  subscribeInteractions: typeof import('./discord/client').subscribeInteractions
  subscribeMessages: typeof import('./discord/client').subscribeMessages
  downloadAttachment: typeof import('./discord/client').downloadAttachment
  registerGlobalCommands: typeof import('./discord/client').registerGlobalCommands
  createChannelCache: typeof import('./discord/channel-cache').createChannelCache
  createSendSurface: typeof import('./discord/send').createSendSurface
  createChannelIdResolver: typeof import('./discord/send').createChannelIdResolver
  createApprovalSurface: typeof import('./discord/approvals').createApprovalSurface
  createInboundSurface: typeof import('./discord/inbound').createInboundSurface
  NEW_CHAT_COMMAND: string
}

let modulesPromise: Promise<DiscordModules> | null = null

/** D15: a controllable fake transport for deterministic server-level tests. */
export const FAKE_TRANSPORT_ENV = 'BAKIN_DELIVERY_TRANSPORT'

function useFakeTransport(): boolean {
  return process.env[FAKE_TRANSPORT_ENV] === 'fake'
}

async function loadDiscordModules(): Promise<DiscordModules> {
  if (modulesPromise) return modulesPromise
  const loading = (async () => {
      const fake = useFakeTransport()
      if (fake) {
        log.warn(`${FAKE_TRANSPORT_ENV}=fake — the Discord transport is a FAKE (no sockets, no sends). Never run production this way.`)
      }
      const [client, cache, send, approvals, inbound] = await Promise.all([
        fake ? import('./discord/fake-transport') : import('./discord/client'),
        import('./discord/channel-cache'),
        import('./discord/send'),
        import('./discord/approvals'),
        import('./discord/inbound'),
      ])
      return {
        createDiscordTransport: client.createDiscordTransport,
        sendApiFromTransport: client.sendApiFromTransport,
        approvalApiFromTransport: client.approvalApiFromTransport,
        subscribeInteractions: client.subscribeInteractions,
        subscribeMessages: client.subscribeMessages,
        downloadAttachment: client.downloadAttachment,
        registerGlobalCommands: client.registerGlobalCommands,
        createChannelCache: cache.createChannelCache,
        createSendSurface: send.createSendSurface,
        createChannelIdResolver: send.createChannelIdResolver,
        createApprovalSurface: approvals.createApprovalSurface,
        createInboundSurface: inbound.createInboundSurface,
        NEW_CHAT_COMMAND: inbound.NEW_CHAT_COMMAND,
      }
    })().catch((err) => {
      modulesPromise = null
      throw err
    })
  modulesPromise = loading
  return loading
}

// ── module state ──────────────────────────────────────────────────────────

/**
 * Approval-response and inbound-message handlers registered by consumers
 * (workflows / chat wire these at plugin activation). Kept OUTSIDE attempt
 * state so subscribing is always safe — a configured-but-unconnected
 * bridge must never crash a plugin's activate(); events simply never fire
 * until a transport is applied.
 */
const approvalHandlers = new Set<(event: ApprovalResolveEvent) => void>()
const inboundHandlers = new Set<(message: InboundChannelMessage) => void>()

let desiredGeneration = 0
let appliedGeneration = 0
let stopped = false
let armed = false
let disarm: (() => void) | null = null
let runtimeDeliveryMode: CapabilityMode | null = null
let idleReason: IdleReason = 'runtime_unknown'
let current: Applied | null = null
let inFlight: { generation: number; abort: AbortController } | null = null
let loop: Promise<BridgeStatus> | null = null
let pendingReasons: ReconcileReason[] = []
let lastSeenSnapshotKey: string | null = null
const commandsRegisteredFor = new Set<string>()
const subscribers = new Set<(status: BridgeStatus) => void>()

let status: BridgeStatus = {
  state: 'idle',
  since: new Date().toISOString(),
  lastError: null,
  joinedGuildIds: [],
  guildResults: [],
  generation: 0,
}

function now(): string {
  return new Date().toISOString()
}

function publish(next: Partial<BridgeStatus> & { attempt?: BridgeStatus['attempt'] | undefined }): void {
  const prev = status
  const stateChanged = next.state !== undefined && next.state !== prev.state
  const merged: BridgeStatus = { ...prev, ...next, since: stateChanged ? now() : prev.since }
  if (!('attempt' in next)) merged.attempt = prev.attempt
  else if (next.attempt === undefined) delete merged.attempt
  status = merged
  for (const listener of subscribers) {
    try {
      listener(status)
    } catch (err) {
      log.error('Delivery bridge status listener failed', err)
    }
  }
}

function readDesired(): DesiredConfig {
  const { settings, token } = readDiscordConfig()
  return { settings, token, deliveryMode: runtimeDeliveryMode }
}

/** Settings block + token HASH + delivery mode: what an attempt was built from. */
function snapshotKey(cfg: DesiredConfig): string {
  const tokenHash = cfg.token ? createHash('sha256').update(cfg.token).digest('hex').slice(0, 16) : 'none'
  return `${JSON.stringify(cfg.settings)}|${tokenHash}|${cfg.deliveryMode ?? 'unknown'}`
}

/** Precedence: stopped > runtime unknown > native > disabled > token > guild (D14). */
function shouldRun(cfg: DesiredConfig): { run: true } | { run: false; reason: IdleReason } {
  if (stopped) return { run: false, reason: 'stopped' }
  if (cfg.deliveryMode === null) return { run: false, reason: 'runtime_unknown' }
  if (cfg.deliveryMode === 'native') return { run: false, reason: 'native' }
  if (!cfg.settings.enabled) return { run: false, reason: 'disabled' }
  if (!cfg.token) return { run: false, reason: 'missing_token' }
  if (cfg.settings.guildIds.length === 0) return { run: false, reason: 'missing_guild' }
  return { run: true }
}

function readinessStateForThrow(): ChannelReadinessState {
  if (current) return status.state === 'degraded' ? 'degraded' : 'connected'
  if (status.state === 'idle') {
    switch (idleReason) {
      case 'native': return 'native'
      case 'disabled': return 'disabled'
      case 'missing_token': return 'missing_token'
      case 'missing_guild': return 'missing_guild'
      default: return 'failed'
    }
  }
  return status.state
}

function requireApplied(): Applied {
  if (current) return current
  const state = readinessStateForThrow()
  const kind = state === 'native' || state === 'disabled' || state === 'missing_token' || state === 'missing_guild'
    ? 'not_configured'
    : 'not_connected'
  throw new DeliveryError(kind, `Discord delivery bridge is ${state.replace('_', ' ')}`, { state })
}

// ── the channel surface (always present; delivering members throw typed) ──

const channels: ChannelSurface = {
  list: async () => requireApplied().cache.list(),
  sendNotification: async (args) => requireApplied().send.sendNotification(args),
  sendMessage: async (args) => requireApplied().send.sendMessage(args),
  deliverContent: async (args) => requireApplied().send.deliverContent(args),
  createApproval: async (args) => requireApplied().approvals.createApproval(args),
  editApproval: async (args) => requireApplied().approvals.editApproval(args),
  cancelApproval: async (args) => requireApplied().approvals.cancelApproval(args),
  resolveApproval: async (args) => requireApplied().approvals.resolveApproval(args),
  subscribeApprovalResponses: (handler) => {
    approvalHandlers.add(handler)
    return () => approvalHandlers.delete(handler)
  },
  subscribeInboundMessages: (handler) => {
    inboundHandlers.add(handler)
    return () => inboundHandlers.delete(handler)
  },
  createThread: async (args) => requireApplied().send.createThread(args),
  editMessage: async (args) => requireApplied().send.editMessage(args),
  sendTyping: async (args) => requireApplied().send.sendTyping(args),
}

// ── reconciliation ────────────────────────────────────────────────────────

function bump(reason: ReconcileReason): void {
  desiredGeneration += 1
  pendingReasons.push(reason)
  inFlight?.abort.abort()
}

/**
 * Arm the change subscriptions ONCE, on the first server-driven reconcile.
 * A CLI process writing settings must never start a loop of its own, so
 * arming is tied to boot, not to module evaluation — and the subscription
 * modules are loaded here, lazily, so the bridge's static import footprint
 * stays as small as before (#669) for every path that only threads the
 * handle.
 */
async function arm(): Promise<void> {
  if (armed) return
  armed = true
  const [{ subscribeSettingsChanged }, { subscribeSecretChanged }] = await Promise.all([
    import('@/core/settings'),
    import('@bakin/core/media'),
  ])
  const offSettings = subscribeSettingsChanged(() => {
    const key = snapshotKey(readDesired())
    if (key === lastSeenSnapshotKey) return
    void reconcile('settings')
  })
  const offSecret = subscribeSecretChanged((change) => {
    const slot = SECRET_SLOT.discordBotToken
    if (change.provider !== slot.provider || change.name !== slot.name) return
    void reconcile('secret')
  })
  disarm = () => {
    offSettings()
    offSecret()
    armed = false
    disarm = null
  }
}

async function reconcile(reason: ReconcileReason): Promise<BridgeStatus> {
  if (reason === 'boot') {
    stopped = false
    await arm()
  }
  // JOIN: an operator request while a loop runs never discards the in-flight
  // attempt — it settles for whatever generation that loop converges on.
  if (reason === 'operator' && loop) {
    pendingReasons.push(reason)
    return loop
  }
  bump(reason)
  if (!loop) {
    loop = runLoop().finally(() => { loop = null })
  }
  return loop
}

async function runLoop(): Promise<BridgeStatus> {
  while (!stopped && appliedGeneration !== desiredGeneration) {
    const generation = desiredGeneration
    const reasons = pendingReasons.splice(0)
    const cfg = readDesired()
    const gate = shouldRun(cfg)
    if (!gate.run) {
      await teardown(generation, gate.reason)
      continue
    }
    const key = snapshotKey(cfg)
    const forced = reasons.some((r) => r === 'operator' || r === 'boot' || r === 'runtime')
    const healthy = status.state === 'connected' || status.state === 'degraded'
    if (current && current.snapshotKey === key && healthy && !forced) {
      // Unrelated write, identical configuration: nothing to reconnect.
      appliedGeneration = generation
      lastSeenSnapshotKey = key
      publish({ generation })
      continue
    }
    auditDelivery('delivery.reconciling', { reasons, generation })
    await attempt(generation, cfg, key)
  }
  if (stopped) await teardown(desiredGeneration, 'stopped')
  return status
}

async function teardown(generation: number, reason: IdleReason): Promise<void> {
  const closing = current
  current = null
  if (closing) {
    closing.unsubscribeTransport()
    await closing.transport.destroy()
    auditDelivery('delivery.disconnected', { reason, generation })
  }
  appliedGeneration = generation
  idleReason = reason
  lastSeenSnapshotKey = snapshotKey(readDesired())
  // The ONE boot/non-run line: the server log always says why Discord did
  // not start (the silent boot gate was part of the #908 incident).
  log.info('Delivery bridge idle', { reason, generation })
  publish({
    state: 'idle',
    generation,
    attempt: undefined,
    lastError: null,
    botUser: undefined,
    joinedGuildIds: [],
    guildResults: [],
  })
}

function mergeGuildResults(
  configured: string[],
  joined: string[],
  results: ReturnType<ChannelCache['guildResults']>,
): GuildReadiness[] {
  const joinedSet = new Set(joined)
  return configured.map((id) => {
    const result = results.find((entry) => entry.guildId === id)
    return {
      id,
      joined: joinedSet.has(id),
      channelCount: result?.channelCount ?? null,
      ...(result?.error ? { error: result.error } : {}),
    }
  })
}

function settledState(guilds: GuildReadiness[]): 'connected' | 'degraded' {
  return guilds.every((guild) => guild.joined === true && guild.channelCount !== null && !guild.error) ? 'connected' : 'degraded'
}

function unknownGuilds(configured: string[]): GuildReadiness[] {
  return configured.map((id) => ({ id, joined: null, channelCount: null }))
}

async function attempt(generation: number, cfg: DesiredConfig, key: string): Promise<void> {
  const abort = new AbortController()
  inFlight = { generation, abort }
  const isCurrent = () => !stopped && desiredGeneration === generation
  publish({ state: 'connecting', attempt: { generation, startedAt: now() } })
  let transport: DiscordTransport | null = null
  try {
    const mods = await loadDiscordModules()
    if (!isCurrent()) return
    transport = mods.createDiscordTransport(cfg.token!)
    const unsubscribeTransport = transport.subscribe(onTransportEvent(transport))
    await transport.connect({ signal: abort.signal })
    if (!isCurrent()) return
    const cache = mods.createChannelCache({
      guildIds: cfg.settings.guildIds,
      fetchGuildChannels: transport.fetchGuildChannels,
    })
    try {
      await cache.refresh()
    } catch (err) {
      // Per-guild failures are recorded on the cache; a total failure is
      // degraded, not fatal — the gateway is up.
      log.warn('Discord channel enumeration failed at apply', err)
    }
    if (!isCurrent()) return
    const applied = buildApplied(mods, transport, cache, generation, key, unsubscribeTransport)
    const replaced = current
    current = applied
    appliedGeneration = generation
    lastSeenSnapshotKey = key
    if (replaced) {
      // The old generation dies only AFTER the new one is live: no send gap.
      replaced.unsubscribeTransport()
      void replaced.transport.destroy()
    }
    const ts = transport.status()
    const guildResults = mergeGuildResults(cfg.settings.guildIds, ts.readyGuildIds, cache.guildResults())
    const state = settledState(guildResults)
    publish({
      state,
      generation,
      attempt: undefined,
      lastError: null,
      botUser: ts.botUser ?? undefined,
      joinedGuildIds: ts.readyGuildIds,
      guildResults,
    })
    auditDelivery('delivery.connected', { generation, guilds: cfg.settings.guildIds.length, degraded: state === 'degraded' })
    void registerCommandsOnce(mods, transport, cfg.settings.guildIds)
  } catch (err) {
    if (!isCurrent()) return
    const failure = err instanceof DeliveryError ? err : new DeliveryError('transport', err instanceof Error ? err.message : String(err))
    appliedGeneration = generation
    lastSeenSnapshotKey = key
    publish({
      state: 'failed',
      generation,
      attempt: undefined,
      lastError: summarizeDeliveryError(failure),
      joinedGuildIds: [],
      guildResults: unknownGuilds(cfg.settings.guildIds),
    })
    auditDelivery('delivery.connect_failed', { generation, kind: failure.kind, error: failure.message })
    log.warn('Discord delivery bridge connect failed', failure, { kind: failure.kind, generation })
  } finally {
    inFlight = null
    // Stale or failed: never leak a manager.
    if (transport && current?.transport !== transport) await transport.destroy()
  }
}

function buildApplied(
  mods: DiscordModules,
  transport: DiscordTransport,
  cache: ChannelCache,
  generation: number,
  snapshotKeyValue: string,
  unsubscribeTransport: () => void,
): Applied {
  const sendApi = mods.sendApiFromTransport(transport)
  const approvalApi = mods.approvalApiFromTransport(transport)
  const send = mods.createSendSurface({ api: sendApi })
  const approvals = mods.createApprovalSurface({
    api: approvalApi,
    sendApi,
    // Live read: approver edits take effect without a reconnect.
    approvers: () => readDiscordConfig().settings.approvers,
    resolveChannelId: mods.createChannelIdResolver(sendApi),
  })
  // Fan-out is guarded by transport identity so a doomed (stale) transport's
  // events never reach plugin handlers.
  const isLive = () => current?.transport === transport
  approvals.subscribe((event) => {
    if (!isLive()) return
    for (const handler of approvalHandlers) {
      try {
        handler(event)
      } catch (err) {
        log.error('Approval response handler failed', err, { approvalId: event.approvalId })
      }
    }
  })
  const inbound = mods.createInboundSurface({
    botUserId: transport.botUserId,
    // Live view — enabled/allowlist edits apply without a reconnect (the
    // surface itself re-checks enabled + inbound.enabled per message).
    settings: () => readDiscordConfig().settings,
    download: mods.downloadAttachment,
    replyEphemeral: approvalApi.replyEphemeral,
  })
  inbound.subscribe((message) => {
    if (!isLive()) return
    for (const handler of inboundHandlers) {
      try {
        handler(message)
      } catch (err) {
        log.error('Inbound message handler failed', err, { channel: message.channelRef })
      }
    }
  })
  mods.subscribeInteractions(transport, (raw) => {
    if (!isLive()) return
    // Live master-switch guard: flipping integrations.discord.enabled off
    // stops decisions immediately (reconciliation tears the transport down
    // right after).
    if (!readDiscordConfig().settings.enabled) return
    // 2 = APPLICATION_COMMAND (slash commands) → inbound; buttons/modals → approvals.
    if ((raw as { type?: number }).type === 2) {
      void inbound.handleCommandInteraction(raw as never).catch((err) => {
        log.error('Discord command handling failed', err)
      })
      return
    }
    void approvals.handleInteraction(raw).catch((err) => {
      log.error('Discord interaction handling failed', err)
    })
  })
  mods.subscribeMessages(transport, (raw) => {
    if (!isLive()) return
    void inbound.handleMessage(raw).catch((err) => {
      log.error('Discord inbound handling failed', err)
    })
  })
  return { generation, transport, cache, send, approvals, snapshotKey: snapshotKeyValue, unsubscribeTransport }
}

/** Slash-command registration: once per process per (application, guild set); post-apply, non-fatal. */
async function registerCommandsOnce(mods: DiscordModules, transport: DiscordTransport, guildIds: string[]): Promise<void> {
  const applicationId = transport.applicationId()
  const key = `${applicationId ?? 'unknown'}|${[...guildIds].sort().join(',')}`
  if (commandsRegisteredFor.has(key)) return
  if (current?.transport !== transport) return
  try {
    await mods.registerGlobalCommands(transport, guildIds, [
      { name: mods.NEW_CHAT_COMMAND, description: 'Start a fresh Bakin chat for this channel (the old one stays in Bakin)' },
    ])
    commandsRegisteredFor.add(key)
  } catch (err) {
    log.warn('Slash-command registration failed', err)
  }
}

function onTransportEvent(transport: DiscordTransport): (event: TransportEvent) => void {
  return (event) => {
    // Only the APPLIED transport may move the bridge status; a stale or
    // in-flight transport's events are ignored (and it is being destroyed).
    if (current?.transport !== transport) return
    switch (event.type) {
      case 'closed':
        if (event.fatal) return // the matching 'error' event carries the typed cause
        publish({
          state: 'disconnected',
          lastError: { kind: 'transport', message: `Discord gateway closed (code ${event.code})`, at: now() },
        })
        return
      case 'resumed':
        publish({ state: settledState(status.guildResults), lastError: null })
        return
      case 'ready': {
        const joined = new Set(event.guildIds)
        const guildResults = status.guildResults.map((guild) => ({ ...guild, joined: joined.has(guild.id) }))
        publish({ state: settledState(guildResults), guildResults, joinedGuildIds: event.guildIds, botUser: event.botUser, lastError: null })
        return
      }
      case 'error': {
        const dead = current
        current = null
        dead?.unsubscribeTransport()
        void dead?.transport.destroy()
        publish({ state: 'failed', lastError: summarizeDeliveryError(event.error) })
        auditDelivery('delivery.connect_failed', { generation: status.generation, kind: event.error.kind, error: event.error.message })
        return
      }
    }
  }
}

async function shutdown(): Promise<void> {
  stopped = true
  disarm?.()
  inFlight?.abort.abort()
  if (loop) {
    await loop.catch(() => {})
  } else if (current || status.state !== 'idle') {
    await teardown(desiredGeneration, 'stopped')
  }
  auditDelivery('delivery.disconnected', { reason: 'shutdown' })
}

// ── public surface ────────────────────────────────────────────────────────

const bridge: ChannelBridge = {
  isConfigured: () => isDiscordConfigured(),
  status: () => status,
  reconcile,
  subscribe(listener) {
    subscribers.add(listener)
    return () => { subscribers.delete(listener) }
  },
  shutdown,
  channels,
}

export function getDeliveryBridge(): ChannelBridge {
  return bridge
}

/** The applied transport's cached channel list, synchronously (null when not applied / never enumerated). */
export function getAppliedChannels(): ChannelInfo[] | null {
  return current?.cache.peek() ?? null
}

/** Permission bits the Verify probe checks at guild level (channel overrides are NOT computed). */
export const VERIFY_GUILD_PERMISSION_BITS = {
  viewChannels: BigInt(1) << BigInt(10),
  sendMessages: BigInt(1) << BigInt(11),
} as const

export interface ProbeItem {
  key: string
  status: 'pass' | 'fail' | 'skipped'
  summary: string
  detail?: string
  setting?: string
}

/**
 * Read-only live probe of the APPLIED transport (spec §4.5, items 1–3):
 * gateway identity, per-guild membership + guild-level permission bits via
 * GET /users/@me/guilds, and a channel re-enumeration that also refreshes
 * the cache. Never sends. Returns the items; the bridge status is updated
 * from the fresh guild facts.
 */
export async function probeDeliveryBridge(): Promise<ProbeItem[]> {
  const applied = current
  const items: ProbeItem[] = []
  if (!applied) {
    items.push({ key: 'gateway', status: 'fail', summary: 'Discord gateway is not connected.' })
    return items
  }
  const ts = applied.transport.status()
  items.push(ts.phase === 'ready'
    ? { key: 'gateway', status: 'pass', summary: `Gateway connected as ${ts.botUser?.name ?? 'the bot'}.`, detail: ts.botUser ? `Bot user id ${ts.botUser.id}` : undefined }
    : { key: 'gateway', status: 'fail', summary: `Gateway is ${ts.phase}.`, detail: ts.lastError?.message })

  const configured = readDiscordConfig().settings.guildIds
  let liveGuilds: Map<string, { name: string; permissions: bigint }> | null = null
  try {
    const guilds = await applied.transport.api.users.getGuilds()
    liveGuilds = new Map(guilds.map((guild) => [guild.id, { name: guild.name, permissions: BigInt(guild.permissions) }]))
  } catch (err) {
    items.push({ key: 'guilds', status: 'fail', summary: 'Could not list the servers the bot belongs to.', detail: err instanceof Error ? err.message : String(err) })
  }
  if (liveGuilds) {
    for (const id of configured) {
      const guild = liveGuilds.get(id)
      if (!guild) {
        items.push({ key: `guild:${id}`, status: 'fail', summary: `Bot is not a member of server ${id}.`, detail: 'Invite the bot to this server or remove the ID.', setting: 'integrations.discord.guildIds' })
        continue
      }
      const missing: string[] = []
      if ((guild.permissions & VERIFY_GUILD_PERMISSION_BITS.viewChannels) === BigInt(0)) missing.push('View Channels')
      if ((guild.permissions & VERIFY_GUILD_PERMISSION_BITS.sendMessages) === BigInt(0)) missing.push('Send Messages')
      items.push(missing.length === 0
        ? { key: `guild:${id}`, status: 'pass', summary: `Member of ${guild.name} with guild-level View Channels + Send Messages.`, detail: 'Guild-level permissions only — channel overrides are not checked.' }
        : { key: `guild:${id}`, status: 'fail', summary: `Member of ${guild.name} but missing guild-level ${missing.join(' + ')}.`, detail: 'Guild-level permissions only — channel overrides are not checked.', setting: 'integrations.discord.guildIds' })
    }
  }

  try {
    await applied.cache.refresh()
  } catch (err) {
    log.warn('Channel re-enumeration failed during verify', err)
  }
  for (const result of applied.cache.guildResults()) {
    items.push(result.channelCount === null
      ? { key: `channels:${result.guildId}`, status: 'fail', summary: `Could not list channels in server ${result.guildId}.`, detail: result.error?.message, setting: 'integrations.discord.guildIds' }
      : { key: `channels:${result.guildId}`, status: 'pass', summary: `${result.channelCount} text channel${result.channelCount === 1 ? '' : 's'} in server ${result.guildId}.` })
  }
  if (current === applied) {
    const joined = liveGuilds ? [...liveGuilds.keys()].filter((id) => configured.includes(id)) : status.joinedGuildIds
    const guildResults = mergeGuildResults(configured, joined, applied.cache.guildResults())
    publish({ state: settledState(guildResults), guildResults, joinedGuildIds: joined })
  }
  return items
}

export function getBridgeStatus(): BridgeStatus {
  return status
}

/** The idle reason behind `status.state === 'idle'` (readiness collector + tests). */
export function getBridgeIdleReason(): IdleReason {
  return idleReason
}

/** The delivery mode the loop currently believes the active runtime has. */
export function getBridgeRuntimeDeliveryMode(): CapabilityMode | null {
  return runtimeDeliveryMode
}

/**
 * D11: the bridge serves runtimes WITHOUT native delivery. The runtime's
 * delivery mode is read ONCE here (Pi's capabilities() probes models —
 * never per settings write) and cached for the loop. Callers: server boot,
 * runtime switch (real path + restore). Resolves — never throws — on a
 * connect failure; the status carries it.
 */
export async function reconcileDeliveryBridge(
  runtime: { capabilities(): Promise<{ delivery: { mode: CapabilityMode } }> },
  reason: 'boot' | 'runtime',
): Promise<BridgeStatus> {
  runtimeDeliveryMode = (await runtime.capabilities()).delivery.mode
  return bridge.reconcile(reason)
}

export async function shutdownDeliveryBridge(): Promise<void> {
  await bridge.shutdown()
}

/** Test seam: forget every module-level fact (never used in production). */
export function resetDeliveryBridgeForTests(): void {
  disarm?.()
  desiredGeneration = 0
  appliedGeneration = 0
  stopped = false
  armed = false
  runtimeDeliveryMode = null
  idleReason = 'runtime_unknown'
  current = null
  inFlight = null
  loop = null
  pendingReasons = []
  lastSeenSnapshotKey = null
  commandsRegisteredFor.clear()
  subscribers.clear()
  approvalHandlers.clear()
  inboundHandlers.clear()
  modulesPromise = null
  status = { state: 'idle', since: now(), lastError: null, joinedGuildIds: [], guildResults: [], generation: 0 }
}
