import { describe, expect, it } from 'bun:test'

import { buildConfigCommands } from '../../../scripts/instance/openclaw-config'

describe('buildConfigCommands — brave-search (default)', () => {
  it('registers brave-search via `mcp set` with the resolved key inline in env', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'brave-xyz' })
    expect(cmds).toHaveLength(1)
    const [verb, sub, name, json] = cmds[0]
    expect([verb, sub, name]).toEqual(['mcp', 'set', 'brave-search'])
    expect(JSON.parse(json)).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: 'brave-xyz' },
    })
  })

  it('keeps brave-search first so it is always registered', () => {
    const cmds = buildConfigCommands({
      braveApiKey: 'k',
      discord: { tokenEnvId: 'DISCORD_BOT_TOKEN' },
    })
    expect(cmds[0][0]).toBe('mcp')
  })
})

describe('buildConfigCommands — discord (optional, D5 keep)', () => {
  it('wires the token as a SecretRef to a container env var, then enables the channel', () => {
    const cmds = buildConfigCommands({
      braveApiKey: 'k',
      discord: { tokenEnvId: 'DISCORD_BOT_TOKEN' },
    })
    expect(cmds).toContainEqual([
      'config', 'set', 'channels.discord.token',
      '--ref-provider', 'default', '--ref-source', 'env', '--ref-id', 'DISCORD_BOT_TOKEN',
    ])
    expect(cmds).toContainEqual(['config', 'set', 'channels.discord.enabled', 'true', '--strict-json'])
  })

  it('does not store the literal token anywhere in the commands', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'k', discord: { tokenEnvId: 'DISCORD_BOT_TOKEN' } })
    // SecretRef points at the env id, never the secret value itself.
    expect(JSON.stringify(cmds)).not.toContain('secret')
  })

  it('adds a guild allowlist when a guild id is given', () => {
    const cmds = buildConfigCommands({
      braveApiKey: 'k',
      discord: { tokenEnvId: 'DISCORD_BOT_TOKEN', guildId: '111', userId: '222' },
    })
    expect(cmds).toContainEqual(['config', 'set', 'channels.discord.groupPolicy', '"allowlist"', '--strict-json'])
    const guildCmd = cmds.find((c) => c[2] === 'channels.discord.guilds.111')
    expect(guildCmd).toBeDefined()
    expect(JSON.parse(guildCmd![3])).toEqual({ requireMention: false, users: ['222'] })
  })

  it('omits discord entirely when not requested', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'k' })
    expect(cmds.some((c) => c.join(' ').includes('discord'))).toBe(false)
  })
})
