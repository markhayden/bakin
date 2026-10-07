/**
 * Channel readiness collector (channel-readiness spec §4.1, D3): the ONE
 * snapshot every surface projects from — the Channels tab, the Discord
 * health check, the post tool, onboarding, the switch report, and the CLI.
 *
 * The classifier is pure (packages/core). This module gathers the facts:
 * settings, token presence (never the value), the bridge's live status, the
 * runtime's adapter + delivery mode, the channel list (bridge cache or, on a
 * native runtime, the runtime's own list under a 2 s budget with
 * stale-beats-broken), and routing resolution. It publishes on every bridge
 * transition and relevant settings/secret write, keeps `since` stable across
 * refreshes, and pushes `channels.readiness` over SSE.
 */
import type { ChannelInfo } from '@bakin/core/adapters/runtime'
import { SECRET_SLOT, resolveSecretSlotStatus } from '@bakin/core/secrets'
import {
  DELIVERABLE_STATES,
  classifyChannelReadiness,
  readinessOwner,
  remediationForState,
  summarizeDeliveryError,
  DeliveryError,
  type ChannelReadiness,
  type ChannelReadinessState,
  type DeliveryErrorSummary,
  type GuildReadiness,
  type RoutingTarget,
} from '@bakin/core/delivery'
import { maybeGetAppServices } from '@/core/app-services-store'
import { createLogger } from '@/core/logger'
import { getSettings } from '@/core/settings'
import { readConfiguredChannelAliases, resolveChannelRef } from '@/core/channel-aliases'
import {
  getAppliedChannels,
  getBridgeIdleReason,
  getBridgeRuntimeDeliveryMode,
  getBridgeStatus,
  getDeliveryBridge,
  probeDeliveryBridge,
  type ProbeItem,
} from './index'

const log = createLogger('delivery-readiness')

/** Health checks that project this snapshot — rerun targeted on every transition. */
export const CHANNEL_HEALTH_CHECK_IDS = ['health.delivery-discord', 'health.channel-aliases', 'health.channel-approvals'] as const

export const NATIVE_LIST_BUDGET_MS = 2_000

export interface ReadinessChange {
  previous: ChannelReadiness | null
  next: ChannelReadiness
  stateChanged: boolean
  routingChanged: boolean
}

type Listener = (change: ReadinessChange) => void

interface NativeChannels {
  items: ChannelInfo[]
  collectedAt: string | null
  error?: DeliveryErrorSummary
}

let snapshot: ChannelReadiness | null = null
let nativeChannels: NativeChannels = { items: [], collectedAt: null }
let started = false
let disarm: (() => void) | null = null
let refreshInFlight: Promise<ChannelReadiness> | null = null
let refreshToken: object | null = null
let refreshQueued = false
const listeners = new Set<Listener>()

// ── facts ────────────────────────────────────────────────────────────────

function runtimeFacts(): { adapter: string; deliveryMode: 'native' | 'shimmed' | 'unavailable' } {
  const services = maybeGetAppServices()
  const settings = getSettings()
  const deliveryMode = getBridgeRuntimeDeliveryMode()
    ?? (settings.runtime.adapter === 'openclaw' ? 'native' : 'unavailable')
  return {
    adapter: services?.runtime.name ?? settings.runtime.adapter,
    deliveryMode,
  }
}

function routingTarget(setting: string, value: string, knownIds: Set<string> | null, aliases: Record<string, string>): RoutingTarget {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'none') return { setting, value: null, resolved: 'unset' }
  if (knownIds === null) return { setting, value: trimmed, resolved: 'unverifiable' }
  try {
    const { resolved } = resolveChannelRef(trimmed, { aliases, knownChannelIds: knownIds })
    // A native runtime may list a provider-level id ('discord') that stands
    // for every target under it; a bridge list is fully qualified, so only a
    // bare provider id in the known set grants the prefix match.
    const provider = resolved.split(':')[0]
    const known = knownIds.has(resolved) || (provider !== resolved && knownIds.has(provider))
    return known
      ? { setting, value: trimmed, resolved: 'ok', channelId: resolved }
      : { setting, value: trimmed, resolved: 'unknown_channel', channelId: resolved }
  } catch {
    return { setting, value: trimmed, resolved: 'unknown_channel' }
  }
}

function buildSnapshot(previous: ChannelReadiness | null): ChannelReadiness {
  const settings = getSettings()
  const discord = settings.integrations.discord
  const token = resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)
  const runtime = runtimeFacts()
  const bridge = getBridgeStatus()
  // The server always threads a bridge handle, so delivery is owned by the
  // runtime (native) or by the bridge — never by nobody. Whether the ACTIVE
  // adapter exposes `runtime.channels` is the adapter's claim (T7 makes it
  // permanent on Pi), not a readiness fact.
  const owner = readinessOwner(runtime.deliveryMode, true)

  const state: ChannelReadinessState = classifyChannelReadiness({
    deliveryMode: runtime.deliveryMode,
    enabled: discord.enabled,
    tokenPresent: token.present,
    guildCount: discord.guildIds.length,
    bridge,
  })

  const channels = owner === 'runtime'
    ? { items: nativeChannels.items, source: 'runtime' as const, collectedAt: nativeChannels.collectedAt, ...(nativeChannels.error ? { error: nativeChannels.error } : {}) }
    : owner === 'bridge' && DELIVERABLE_STATES.includes(state)
      ? { items: getAppliedChannels() ?? [], source: 'bridge' as const, collectedAt: bridge.since }
      : { items: [], source: 'none' as const, collectedAt: null }

  const knownIds = channels.source === 'none' || (channels.source === 'runtime' && channels.collectedAt === null)
    ? null
    : new Set(channels.items.map((channel) => channel.id))
  const aliases = readConfiguredChannelAliases()
  const routing = {
    alertChannel: routingTarget('notifications.channel', settings.notifications.channel, knownIds, aliases),
    approvalsChannel: routingTarget('approvals.channel', settings.approvals.channel, knownIds, aliases),
    approvalsEnabled: settings.approvals.channelAlerts,
    aliases: Object.entries(settings.notifications.channelAliases ?? {}).map(([name, target]) =>
      routingTarget(`notifications.channelAliases.${name}`, target, knownIds, aliases)),
  }

  const configurationGap = state === 'native' || state === 'disabled' || state === 'missing_token' || state === 'missing_guild'
  const guilds: GuildReadiness[] = !configurationGap && bridge.guildResults.length > 0
    ? bridge.guildResults
    : discord.guildIds.map((id) => ({ id, joined: null, channelCount: null }))

  const generatedAt = new Date().toISOString()
  const neverReconciled = state === 'failed' && bridge.state === 'idle' && getBridgeIdleReason() === 'runtime_unknown'
  const lastError: DeliveryErrorSummary | null = bridge.lastError
    ?? (neverReconciled
      ? summarizeDeliveryError(new DeliveryError('not_connected', 'Discord delivery bridge was never reconciled for this runtime'), generatedAt)
      : null)

  return {
    runtime: { adapter: runtime.adapter, deliveryMode: runtime.deliveryMode },
    owner,
    enabled: discord.enabled,
    token,
    guilds,
    connection: {
      state,
      since: previous && previous.connection.state === state ? previous.connection.since : generatedAt,
      lastError,
      ...(bridge.botUser ? { botUser: bridge.botUser } : {}),
      ...(bridge.attempt ? { attempt: bridge.attempt } : {}),
    },
    channels,
    routing,
    remediation: remediationForState(state, lastError),
    generatedAt,
  }
}

// ── publish ──────────────────────────────────────────────────────────────

function routingKey(readiness: ChannelReadiness): string {
  return JSON.stringify(readiness.routing)
}

function publish(next: ChannelReadiness): ChannelReadiness {
  const previous = snapshot
  snapshot = next
  const change: ReadinessChange = {
    previous,
    next,
    stateChanged: previous?.connection.state !== next.connection.state,
    routingChanged: previous ? routingKey(previous) !== routingKey(next) : true,
  }
  for (const listener of listeners) {
    try {
      listener(change)
    } catch (err) {
      log.error('Channel readiness listener failed', err)
    }
  }
  void broadcastReadiness(next)
  return next
}

async function broadcastReadiness(readiness: ChannelReadiness): Promise<void> {
  try {
    const { broadcast } = await import('@/core/sse')
    broadcast({ type: 'plugin-event', event: 'channels.readiness', readiness, timestamp: readiness.generatedAt })
  } catch (err) {
    log.warn('Channel readiness SSE broadcast failed', err)
  }
}

/** Rebuild from current facts synchronously (no native fetch) and publish. */
export function rebuildChannelReadiness(): ChannelReadiness {
  return publish(buildSnapshot(snapshot))
}

/** The cached snapshot — always available; before the first collection it is the classifier over current facts. */
export function getChannelReadiness(): ChannelReadiness {
  return snapshot ?? (snapshot = buildSnapshot(null))
}

async function collectNativeChannels(): Promise<void> {
  const runtime = maybeGetAppServices()?.runtime
  if (!runtime?.channels) {
    nativeChannels = { items: [], collectedAt: null }
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeliveryError('timeout', `runtime channel list exceeded ${NATIVE_LIST_BUDGET_MS}ms`)), NATIVE_LIST_BUDGET_MS)
  })
  try {
    const items = await Promise.race([runtime.channels.list(), budget])
    nativeChannels = { items, collectedAt: new Date().toISOString() }
  } catch (err) {
    const typed = err instanceof DeliveryError ? err : new DeliveryError('transport', err instanceof Error ? err.message : String(err))
    // Stale beats broken: keep the previous items and their collectedAt.
    nativeChannels = { ...nativeChannels, error: summarizeDeliveryError(typed) }
    log.warn('Runtime channel list failed during readiness refresh', typed, { kind: typed.kind })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Recollect the async facts (native runtime list) then rebuild + publish.
 * Coalesced: one in flight, one queued.
 */
export function refreshChannelReadiness(reason: string): Promise<ChannelReadiness> {
  if (refreshInFlight) {
    refreshQueued = true
    return refreshInFlight
  }
  // The body may complete synchronously (no native fetch), in which case the
  // `finally` runs BEFORE the assignment below — so completion is tracked
  // with a flag and the promise is only stored while it is still pending.
  let settled = false
  const token = {}
  const run = (async () => {
    try {
      do {
        refreshQueued = false
        if (runtimeFacts().deliveryMode === 'native') await collectNativeChannels()
        publish(buildSnapshot(snapshot))
      } while (refreshQueued)
      log.debug('Channel readiness refreshed', { reason })
      return snapshot as ChannelReadiness
    } finally {
      settled = true
      if (refreshToken === token) {
        refreshToken = null
        refreshInFlight = null
      }
    }
  })()
  if (!settled) {
    refreshToken = token
    refreshInFlight = run
  }
  return run
}

export function subscribeChannelReadiness(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Server boot: follow the bridge, settings writes touching routing /
 * integrations / runtime, and the Discord token slot; collect once.
 */
export async function startChannelReadiness(): Promise<void> {
  if (started) return
  started = true
  const offBridge = getDeliveryBridge().subscribe(() => { rebuildChannelReadiness() })
  let offSettings = () => {}
  let offSecret = () => {}
  disarm = () => {
    offBridge()
    offSettings()
    offSecret()
  }
  const [{ subscribeSettingsChanged }, { subscribeSecretChanged }] = await Promise.all([
    import('@/core/settings'),
    import('@bakin/core/media'),
  ])
  if (!started) return
  offSettings = subscribeSettingsChanged((change) => {
    if (!change.keys.some((key) => key === 'notifications' || key === 'approvals' || key === 'integrations' || key === 'runtime')) return
    void refreshChannelReadiness('settings')
  })
  offSecret = subscribeSecretChanged((change) => {
    if (change.provider !== SECRET_SLOT.discordBotToken.provider || change.name !== SECRET_SLOT.discordBotToken.name) return
    rebuildChannelReadiness()
  })
  await refreshChannelReadiness('boot')
}

export function stopChannelReadiness(): void {
  started = false
  disarm?.()
  disarm = null
}

/** Test seam. */
export function resetChannelReadinessForTests(): void {
  stopChannelReadiness()
  snapshot = null
  nativeChannels = { items: [], collectedAt: null }
  refreshInFlight = null
  refreshToken = null
  refreshQueued = false
  listeners.clear()
}

// ── targeted health rerun ────────────────────────────────────────────────

/** Rerun the three channel health checks and apply the results (unregistered ids are skipped). */
export async function rerunChannelHealthChecks(): Promise<{ status: 'pass' | 'fail' | 'skipped'; summary: string }> {
  try {
    const { runTargetedDiagnostics } = await import('@/core/doctor-execution')
    const report = await runTargetedDiagnostics(CHANNEL_HEALTH_CHECK_IDS)
    const check = report.checks.find((entry) => entry.checkId === 'health.delivery-discord')
    if (!check?.latestValidSnapshot) return { status: 'skipped', summary: 'The Discord delivery health check is not registered.' }
    const observations = check.latestValidSnapshot.observations
    const unhealthy = observations.find((observation) => observation.status !== 'healthy')
    return unhealthy
      ? { status: 'fail', summary: `Health check reports ${unhealthy.status}: ${unhealthy.summary}` }
      : { status: 'pass', summary: observations[0]?.summary ?? 'Health check passed.' }
  } catch (err) {
    log.warn('Targeted channel health rerun failed', err)
    return { status: 'fail', summary: `Health rerun failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// ── verify ───────────────────────────────────────────────────────────────

export interface VerifyResult {
  items: ProbeItem[]
  readiness: ChannelReadiness
}

function routingItems(readiness: ChannelReadiness, skippedReason: string | null): ProbeItem[] {
  const targets: Array<{ target: RoutingTarget; skipWhen?: string }> = [
    { target: readiness.routing.alertChannel },
    { target: readiness.routing.approvalsChannel, skipWhen: readiness.routing.approvalsEnabled ? undefined : 'Approval alerts are disabled.' },
    ...readiness.routing.aliases.map((target) => ({ target })),
  ]
  return targets.map(({ target, skipWhen }): ProbeItem => {
    const key = `routing:${target.setting}`
    if (skippedReason) return { key, status: 'skipped', summary: skippedReason, setting: target.setting }
    if (skipWhen) return { key, status: 'skipped', summary: skipWhen, setting: target.setting }
    switch (target.resolved) {
      case 'unset': return { key, status: 'skipped', summary: 'Not configured.', setting: target.setting }
      case 'unverifiable': return { key, status: 'skipped', summary: `${target.value} could not be checked — no channel list is available.`, setting: target.setting }
      case 'unknown_channel': return { key, status: 'fail', summary: `${target.value} does not resolve to a known channel.`, detail: target.channelId ? `Resolved to ${target.channelId}.` : undefined, setting: target.setting }
      case 'ok': return { key, status: 'pass', summary: `${target.value} → ${target.channelId}.`, setting: target.setting }
    }
  })
}

/**
 * The read-only Verify probe (spec §4.5): never sends. Bridge-owned and
 * deliverable → live gateway/guild/channel probe + routing; native → the
 * runtime's list + routing; every other state → every item skipped with the
 * state's remediation. Ends with a targeted health rerun and a refresh.
 */
export async function verifyChannels(): Promise<VerifyResult> {
  const before = getChannelReadiness()
  const items: ProbeItem[] = []
  const state = before.connection.state
  if (before.owner === 'runtime') {
    items.push({ key: 'gateway', status: 'skipped', summary: 'Owned by the runtime — it keeps its own connection.' })
    for (const guild of before.guilds) items.push({ key: `guild:${guild.id}`, status: 'skipped', summary: 'Owned by the runtime.' })
    await refreshChannelReadiness('verify')
    const listed = getChannelReadiness()
    items.push(listed.channels.error
      ? { key: 'channels:runtime', status: 'fail', summary: 'The runtime could not list its channels.', detail: listed.channels.error.message }
      : { key: 'channels:runtime', status: 'pass', summary: `${listed.channels.items.length} runtime channel${listed.channels.items.length === 1 ? '' : 's'} listed.` })
    items.push(...routingItems(listed, null))
  } else if (DELIVERABLE_STATES.includes(state)) {
    items.push(...await probeDeliveryBridge())
    const refreshed = rebuildChannelReadiness()
    items.push(...routingItems(refreshed, null))
  } else {
    const reason = before.remediation ? `${before.remediation.summary} ${before.remediation.nextStep}` : `Delivery is ${state}.`
    items.push({ key: 'gateway', status: 'skipped', summary: reason })
    for (const guild of before.guilds) items.push({ key: `guild:${guild.id}`, status: 'skipped', summary: reason, setting: 'integrations.discord.guildIds' })
    items.push(...routingItems(before, reason))
  }
  const health = await rerunChannelHealthChecks()
  items.push({ key: 'health', status: health.status, summary: health.summary })
  const readiness = await refreshChannelReadiness('verify')
  return { items, readiness }
}
