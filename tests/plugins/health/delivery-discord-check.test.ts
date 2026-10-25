/**
 * delivery.discord doctor check as a projection of the readiness snapshot
 * (#908 §4.7): native first, one incident per non-ready state with a stable
 * key and a human resolution landing on its Settings → Channels field, and the two
 * fail-closed allowlist notices once connected.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ChannelReadiness, ChannelReadinessState } from '../../../packages/core/src/delivery'
import { remediationForState } from '../../../packages/core/src/delivery/copy'

const testDir = join(tmpdir(), `bakin-test-delivery-check-${Date.now()}`)
let current: ChannelReadiness

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/delivery/readiness', () => ({
  getChannelReadiness: () => current,
  subscribeChannelReadiness: () => () => {},
  CHANNEL_HEALTH_CHECK_IDS: ['health.delivery-discord', 'health.channel-aliases', 'health.channel-approvals'],
}))

import { checkDeliveryDiscord } from '@bakin/health/lib/system-checks/delivery-discord'
import { checkChannelAliases } from '@bakin/health/lib/system-checks/channel-aliases'
import { checkChannelApprovals } from '@bakin/health/lib/system-checks/channel-approvals'
import { resetSettingsCache } from '../../../packages/core/src/settings'

interface ObservedLike {
  observations?: Array<{
    status: string
    key: string
    summary: string
    detail?: string
    incident?: { key: string; declarationId?: string; disposition: string; class?: string; impact?: string; required?: boolean; resolution?: { type: string; href?: string } }
  }>
  reason?: string
}

function writeSettings(discord: Record<string, unknown>): void {
  fs.writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ integrations: { discord } }))
  resetSettingsCache()
}

function snapshot(state: ChannelReadinessState, over: Partial<ChannelReadiness> = {}): ChannelReadiness {
  const lastError = state === 'failed' ? { kind: 'auth_failed' as const, message: 'Discord rejected the bot token (401)', at: 'x' } : null
  return {
    runtime: { adapter: state === 'native' ? 'openclaw' : 'pi', deliveryMode: state === 'native' ? 'native' : 'unavailable' },
    owner: state === 'native' ? 'runtime' : 'bridge',
    enabled: state !== 'disabled',
    token: { present: state !== 'missing_token', source: state !== 'missing_token' ? 'store' : null },
    guilds: state === 'missing_guild' ? [] : [{ id: 'g1', joined: state === 'connected' || state === 'degraded', channelCount: state === 'connected' ? 2 : null }],
    connection: { state, since: '2026-10-06T00:00:00.000Z', lastError },
    channels: { items: [], source: 'none', collectedAt: null },
    routing: {
      alertChannel: { setting: 'notifications.channel', value: null, resolved: 'unset' },
      approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' },
      approvalsEnabled: false,
      aliases: [],
    },
    remediation: remediationForState(state, lastError),
    generatedAt: '2026-10-06T00:00:00.000Z',
    ...over,
  }
}

describe('delivery.discord doctor check (readiness projection)', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: ['u1'] })
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('native runtime is healthy idle even with an enabled, token-less bridge block (D14)', async () => {
    writeSettings({ enabled: true, guildIds: [] })
    current = snapshot('native', { enabled: true, token: { present: false, source: null }, guilds: [] })
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.status).toBe('healthy')
    expect(result.observations?.[0]?.key).toBe('idle')
    expect(result.observations?.[0]?.incident).toBeUndefined()
  })

  it('is not-applicable when disabled', async () => {
    current = snapshot('disabled')
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(JSON.stringify(result)).toContain('not enabled')
  })

  const expectIncident = async (state: ChannelReadinessState, key: string, resolution: Record<string, unknown>, declarationId = key) => {
    current = snapshot(state)
    const result = await checkDeliveryDiscord() as ObservedLike
    const incident = result.observations?.[0]?.incident
    expect(incident?.key).toBe(key)
    expect(incident?.declarationId).toBe(declarationId)
    expect(incident?.disposition).toBe('action_required')
    expect(incident?.class).toBe('service_failure')
    expect(incident?.resolution).toMatchObject(resolution)
    expect(result.observations).toHaveLength(1)
  }
  const reconnect = { type: 'repair', actionId: 'discord-bridge-reconnect' }
  const tokenCredential = { type: 'human', needs: 'credential', field: 'secret-slot-discord-botToken', href: '/settings?tab=channels&field=integrations.discord.botToken' }

  it('missing token → missing-token, a credential on the token field (row 21)', () => expectIncident('missing_token', 'missing-token', tokenCredential))
  it('missing guild → missing-guild, a decision on the servers field (row 22)', () => expectIncident('missing_guild', 'missing-guild', { type: 'human', needs: 'decision', field: 'channels-field-guilds' }))
  it('failed → bridge-failed with the classified cause; a rejected token is the credential family (row 24)', async () => {
    await expectIncident('failed', 'bridge-failed', tokenCredential, 'bridge-failed-credential')
    expect(((await checkDeliveryDiscord()) as ObservedLike).observations?.[0]?.summary).toContain('auth_failed')
  })
  it('failed for a non-credential reason → bridge-failed pointing at the reconnect repair', async () => {
    current = snapshot('failed', { connection: { state: 'failed', since: 'x', lastError: { kind: 'transport', message: 'ECONNRESET', at: 'x' } } })
    const incident = ((await checkDeliveryDiscord()) as ObservedLike).observations?.[0]?.incident
    expect(incident).toMatchObject({ key: 'bridge-failed', resolution: reconnect })
  })
  it('disconnected → bridge-disconnected pointing at the reconnect repair (row 25)', () => expectIncident('disconnected', 'bridge-disconnected', reconnect))
  it('degraded with nothing routed into the unreachable server → guild-unjoined is ADVISORY (required:false), landing on the servers field (row 26)', async () => {
    current = snapshot('degraded')
    const result = await checkDeliveryDiscord() as ObservedLike
    const incident = result.observations?.[0]?.incident as (NonNullable<NonNullable<ObservedLike['observations']>[number]['incident']> & { required?: boolean }) | undefined
    expect(incident).toMatchObject({
      key: 'guild-unjoined', declarationId: 'guild-unjoined', disposition: 'advisory', required: false,
      resolution: { type: 'human', needs: 'decision', field: 'channels-field-guilds', href: '/settings?tab=channels&field=integrations.discord.guildIds', label: 'Invite the bot or remove the server' },
    })
    expect(result.observations?.[0]?.summary).toContain('g1')
    expect((result.observations?.[0] as { evidence?: Record<string, unknown> }).evidence).toMatchObject({ usageKnown: true, configuredTargets: [], placedTargets: [], unresolvedTargets: [] })
  })

  it('degraded with a configured target no reachable server holds → usage UNKNOWN, advisory — a channel ref carries no guild and the bot cannot read an unjoined server (R3-3)', async () => {
    current = snapshot('degraded', {
      channels: { items: [{ id: 'discord:channel:ch-1', platform: 'discord', label: '#alerts', capabilities: ['message'] }], source: 'bridge', collectedAt: 'x' },
      routing: {
        alertChannel: { setting: 'notifications.channel', value: 'alerts', resolved: 'ok', channelId: 'discord:channel:ch-1' },
        approvalsChannel: { setting: 'approvals.channel', value: 'discord:channel:ch-9', resolved: 'unknown_channel', channelId: 'discord:channel:ch-9' },
        approvalsEnabled: true,
        aliases: [{ setting: 'notifications.channelAliases.ops', value: 'ops', resolved: 'unknown_channel', channelId: 'discord:channel:ch-7' }],
      },
    })
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.incident).toMatchObject({ key: 'guild-unjoined', disposition: 'advisory', required: false })
    expect((result.observations?.[0] as { evidence?: Record<string, unknown> }).evidence).toMatchObject({ usageKnown: false, placedTargets: ['notifications.channel'], unresolvedTargets: ['approvals.channel', 'notifications.channelAliases.ops'] })
    expect(result.observations?.[0]?.incident?.impact).toContain('approvals.channel')
    expect(result.observations?.[0]?.incident?.impact).toContain('unknown')
    // Approvals disabled and no aliases: every remaining target is placed → usage known, nothing blocked.
    current = snapshot('degraded', { routing: { ...current.routing, approvalsEnabled: false, aliases: [] } })
    const placed = await checkDeliveryDiscord() as ObservedLike
    expect(placed.observations?.[0]?.incident).toMatchObject({ disposition: 'advisory', required: false })
    expect((placed.observations?.[0] as { evidence?: Record<string, unknown> }).evidence).toMatchObject({ usageKnown: true, unresolvedTargets: [] })
  })

  it('a typo target beside an unrelated unreachable server is never presumed to live there: advisory, usage unknown, the routing check keeps the control (R3-3)', async () => {
    current = snapshot('degraded', {
      guilds: [{ id: 'g1', joined: true, channelCount: 1 }, { id: 'g-unjoined', joined: false, channelCount: null }],
      channels: { items: [{ id: 'discord:channel:ch-1', platform: 'discord', label: '#alerts', capabilities: ['message'] }], source: 'bridge', collectedAt: 'x' },
      routing: {
        alertChannel: { setting: 'notifications.channel', value: 'discord:channel:typo', resolved: 'unknown_channel', channelId: 'discord:channel:typo' },
        approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' },
        approvalsEnabled: false,
        aliases: [],
      },
    })
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.incident).toMatchObject({ key: 'guild-unjoined', disposition: 'advisory', required: false })
    expect((result.observations?.[0] as { evidence?: Record<string, unknown> }).evidence).toMatchObject({ usageKnown: false, unresolvedTargets: ['notifications.channel'] })
    // The invalid target itself is the Channels tab's routing probe finding (`routing:notifications.channel` fails there), never this card's claim.
    expect(result.observations?.[0]?.incident?.impact).toContain('notifications.channel')
  })

  it('degraded with an UNVERIFIABLE routing target (no channel list) is advisory with usageKnown:false — never presumed', async () => {
    current = snapshot('degraded', { routing: { alertChannel: { setting: 'notifications.channel', value: 'alerts', resolved: 'unverifiable' }, approvalsChannel: { setting: 'approvals.channel', value: null, resolved: 'unset' }, approvalsEnabled: false, aliases: [] } })
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.incident).toMatchObject({ disposition: 'advisory', required: false })
    expect((result.observations?.[0] as { evidence?: Record<string, unknown> }).evidence).toMatchObject({ usageKnown: false })
    expect(result.observations?.[0]?.incident?.impact).toContain('unknown')
  })

  it('connecting is a plain observation (row 23) — never a card', async () => {
    current = snapshot('connecting')
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.status).toBe('warning')
    expect(result.observations?.[0]?.key).toBe('connecting')
    expect(result.observations?.[0]?.incident).toBeUndefined()
    expect(result.observations?.[0]?.detail).toContain('READY')
  })

  it('connected with empty allowlists is observed fail-closed, naming the Channels-tab fields (rows 27–28)', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: [], inbound: { enabled: true, allowFrom: [] } })
    current = snapshot('connected')
    const result = await checkDeliveryDiscord() as ObservedLike
    const keys = result.observations?.map(r => r.key)
    expect(keys).toContain('approvers')
    expect(keys).toContain('inbound-allowlist')
    expect(result.observations?.every(r => r.incident === undefined && r.status === 'warning')).toBe(true)
    const detailFor = (key: string) => result.observations?.find(r => r.key === key)?.detail ?? ''
    expect(detailFor('approvers')).toContain('/settings?tab=channels&field=integrations.discord.approvers')
    expect(detailFor('inbound-allowlist')).toContain('/settings?tab=channels&field=integrations.discord.inbound.allowFrom')
  })

  it('connected with allowlists is healthy', async () => {
    current = snapshot('connected')
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.status).toBe('healthy')
    expect(result.observations?.[0]?.summary).toContain('connected')
  })

  it('the reproduction (missing token) yields exactly ONE incident across the three channel checks', async () => {
    current = snapshot('missing_token')
    const results = await Promise.all([checkDeliveryDiscord(), checkChannelAliases(), checkChannelApprovals()]) as ObservedLike[]
    const incidents = results.flatMap((result) => (result.observations ?? []).filter((o) => o.incident).map((o) => o.incident!.key))
    expect(incidents).toEqual(['missing-token'])
    expect(results[1].reason).toMatch(/Channel delivery is unavailable \(missing_token\)/)
    expect(results[2].reason).toMatch(/Channel delivery is unavailable \(missing_token\)/)
  })

  it('recovery (connected) leaves zero incidents across the three checks', async () => {
    current = snapshot('connected', {
      channels: { items: [{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message', 'interactive-approval'] }], source: 'bridge', collectedAt: 'x' },
    })
    const results = await Promise.all([checkDeliveryDiscord(), checkChannelAliases(), checkChannelApprovals()]) as ObservedLike[]
    const incidents = results.flatMap((result) => (result.observations ?? []).filter((o) => o.incident))
    expect(incidents).toEqual([])
  })
})
