import { describe, expect, it } from 'bun:test'

import { buildConfigCommands } from '../../../scripts/instance/openclaw-config'

describe('buildConfigCommands — brave-search (default)', () => {
  it('registers brave-search via `mcp set` with the resolved key inline in env', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'brave-xyz' })
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
      discord: { token: 'bot-token' },
    })
    expect(cmds[0][0]).toBe('mcp')
  })
})

describe('buildConfigCommands — codex provider (the LLM, always)', () => {
  it('allowlists + enables codex even with no discord (else "No provider plugins found")', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'k' })
    expect(cmds).toContainEqual(['config', 'set', 'plugins.allow', '["codex"]', '--strict-json'])
    expect(cmds).toContainEqual(['plugins', 'enable', 'codex'])
  })

  it('allowlist must be set before codex is enabled (enable is blocked otherwise)', () => {
    const cmds = buildConfigCommands({ braveApiKey: 'k' })
    const allowIdx = cmds.findIndex((c) => c[2] === 'plugins.allow')
    const enableIdx = cmds.findIndex((c) => c[1] === 'enable' && c[2] === 'codex')
    expect(allowIdx).toBeGreaterThanOrEqual(0)
    expect(allowIdx).toBeLessThan(enableIdx)
  })
})

describe('buildConfigCommands — discord (optional, D5 keep)', () => {
  it('installs the discord plugin, sets the resolved token inline, and enables the channel', () => {
    const cmds = buildConfigCommands({
      braveApiKey: 'k',
      discord: { token: 'bot-token' },
    })
    expect(cmds).toContainEqual(['plugins', 'install', '@openclaw/discord', '--force'])
    expect(cmds).toContainEqual(['config', 'set', 'plugins.allow', '["codex","discord"]', '--strict-json'])
    expect(cmds).toContainEqual(['config', 'set', 'channels.discord.token', 'bot-token'])
    expect(cmds).toContainEqual(['config', 'set', 'channels.discord.enabled', 'true', '--strict-json'])
    // plugin install must precede enabling the channel
    expect(cmds.findIndex((c) => c[1] === 'install')).toBeLessThan(
      cmds.findIndex((c) => c[2] === 'channels.discord.enabled'),
    )
  })

  it('adds a guild allowlist when a guild id is given', () => {
    const cmds = buildConfigCommands({
      braveApiKey: 'k',
      discord: { token: 'bot-token', guildId: '111', userId: '222' },
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
