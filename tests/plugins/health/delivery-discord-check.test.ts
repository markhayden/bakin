/**
 * delivery.discord doctor check as a projection of the readiness snapshot
 * (#908 §4.7): native first, one incident per non-ready state with a stable
 * key and a navigate resolution into Settings → Channels, and the two
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
    incident?: { key: string; disposition: string; class?: string; resolution?: { type: string; href?: string } }
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

  const expectIncident = async (state: ChannelReadinessState, key: string) => {
    current = snapshot(state)
    const result = await checkDeliveryDiscord() as ObservedLike
    const incident = result.observations?.[0]?.incident
    expect(incident?.key).toBe(key)
    expect(incident?.disposition).toBe('action_required')
    expect(incident?.class).toBe('service_failure')
    expect(incident?.resolution).toMatchObject({ type: 'navigate', href: '/settings?tab=channels' })
    expect(result.observations).toHaveLength(1)
  }

  it('missing token → missing-token', () => expectIncident('missing_token', 'missing-token'))
  it('missing guild → missing-guild', () => expectIncident('missing_guild', 'missing-guild'))
  it('failed → bridge-failed with the classified cause', async () => {
    await expectIncident('failed', 'bridge-failed')
    expect(((await checkDeliveryDiscord()) as ObservedLike).observations?.[0]?.summary).toContain('auth_failed')
  })
  it('disconnected → bridge-disconnected', () => expectIncident('disconnected', 'bridge-disconnected'))
  it('degraded → guild-unjoined naming the guild', async () => {
    await expectIncident('degraded', 'guild-unjoined')
    expect(((await checkDeliveryDiscord()) as ObservedLike).observations?.[0]?.summary).toContain('g1')
  })

  it('connecting is a watch (never action_required) with a rerun resolution', async () => {
    current = snapshot('connecting')
    const result = await checkDeliveryDiscord() as ObservedLike
    expect(result.observations?.[0]?.status).toBe('warning')
    expect(result.observations?.[0]?.incident).toMatchObject({ key: 'connecting', disposition: 'watch', resolution: { type: 'rerun' } })
  })

  it('connected with empty allowlists warns fail-closed with Channels-tab links', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: [], inbound: { enabled: true, allowFrom: [] } })
    current = snapshot('connected')
    const result = await checkDeliveryDiscord() as ObservedLike
    const keys = result.observations?.map(r => r.incident?.key)
    expect(keys).toContain('empty-approvers')
    expect(keys).toContain('empty-inbound-allowlist')
    expect(result.observations?.every(r => r.incident?.class === 'policy_denial')).toBe(true)
    const hrefFor = (key: string) => result.observations?.find(r => r.incident?.key === key)?.incident?.resolution
    expect(hrefFor('empty-approvers')).toMatchObject({ type: 'navigate', href: '/settings?tab=channels&field=integrations.discord.approvers' })
    expect(hrefFor('empty-inbound-allowlist')).toMatchObject({ type: 'navigate', href: '/settings?tab=channels&field=integrations.discord.inbound.allowFrom' })
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
