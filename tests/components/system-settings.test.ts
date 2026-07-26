import { describe, it, expect } from 'bun:test'
import {
  SYSTEM_SETTINGS_SCHEMA,
  flattenSystemSettings,
  unflattenSystemSettings,
} from '@/components/system-settings'

describe('system settings — integrations.discord (#669)', () => {
  it('declares the discord fields', () => {
    const keys = SYSTEM_SETTINGS_SCHEMA.fields.map(f => f.key)
    for (const key of [
      'integrations.discord.enabled',
      'integrations.discord.guildIds',
      'integrations.discord.approvers',
      'integrations.discord.inbound.enabled',
      'integrations.discord.inbound.agentId',
      'integrations.discord.inbound.requireMention',
      'integrations.discord.inbound.allowFrom',
    ]) {
      expect(keys).toContain(key)
    }
  })

  it('flattens list settings to comma-separated strings for the renderer', () => {
    const flat = flattenSystemSettings({
      integrations: {
        discord: {
          enabled: true,
          guildIds: ['g1', 'g2'],
          approvers: ['111'],
          inbound: { enabled: true, agentId: 'main', requireMention: true, allowFrom: [] },
        },
      },
    })
    expect(flat['integrations.discord.guildIds']).toBe('g1, g2')
    expect(flat['integrations.discord.approvers']).toBe('111')
    expect(flat['integrations.discord.allowFrom'] ?? flat['integrations.discord.inbound.allowFrom']).toBe('')
    expect(flat['integrations.discord.enabled']).toBe(true)
  })

  it('unflattens comma-separated strings back to arrays', () => {
    const nested = unflattenSystemSettings({
      'integrations.discord.guildIds': ' g1 , g2,,g1',
      'integrations.discord.inbound.allowFrom': '222',
      'integrations.discord.enabled': true,
    }) as { integrations: { discord: { enabled: boolean; guildIds: string[]; inbound: { allowFrom: string[] } } } }
    expect(nested.integrations.discord.guildIds).toEqual(['g1', 'g2'])
    expect(nested.integrations.discord.inbound.allowFrom).toEqual(['222'])
    expect(nested.integrations.discord.enabled).toBe(true)
  })

  it('round-trips: flatten(unflatten(flat)) preserves list values', () => {
    const flat = {
      'integrations.discord.guildIds': 'g1, g2',
      'integrations.discord.approvers': '',
    }
    const nested = unflattenSystemSettings(flat) as Record<string, unknown>
    const back = flattenSystemSettings(nested)
    expect(back['integrations.discord.guildIds']).toBe('g1, g2')
    expect(back['integrations.discord.approvers']).toBe('')
  })
})
