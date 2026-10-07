import { describe, it, expect } from 'bun:test'
import {
  SYSTEM_SETTINGS_SCHEMA,
  flattenSystemSettings,
  unflattenSystemSettings,
} from '@/components/system-settings'

describe('system settings — channel routing lives on Settings → Channels (#908 D10)', () => {
  it('no longer declares the Discord bridge fields or the channel routing targets', () => {
    const keys = SYSTEM_SETTINGS_SCHEMA.fields.map(f => f.key)
    for (const key of [
      'integrations.discord.enabled',
      'integrations.discord.guildIds',
      'integrations.discord.approvers',
      'integrations.discord.inbound.enabled',
      'integrations.discord.inbound.agentId',
      'integrations.discord.inbound.requireMention',
      'integrations.discord.inbound.allowFrom',
      'notifications.channel',
      'approvals.channelAlerts',
      'approvals.channel',
    ]) {
      expect(keys).not.toContain(key)
    }
  })

  it('keeps the approval policy bit (requireRejectReason) here', () => {
    expect(SYSTEM_SETTINGS_SCHEMA.fields.map(f => f.key)).toContain('approvals.requireRejectReason')
  })

  it('flattens only schema keys and never invents channel keys', () => {
    const flat = flattenSystemSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } }, approvals: { requireRejectReason: false } })
    expect(Object.keys(flat).some(key => key.startsWith('integrations.discord'))).toBe(false)
    expect(flat['approvals.requireRejectReason']).toBe(false)
  })
})
