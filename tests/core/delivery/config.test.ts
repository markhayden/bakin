import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'

const testDir = path.join(tmpdir(), `bakin-test-delivery-config-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { readDiscordConfig, isDiscordConfigured } from '../../../src/core/delivery/config'
import { resetSettingsCache } from '../../../packages/core/src/settings'
import { setStoredSecret } from '../../../packages/core/src/media/secret-store'

function writeSettings(integrations: unknown): void {
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({ integrations }))
  resetSettingsCache()
}

function clearState(): void {
  fs.rmSync(testDir, { recursive: true, force: true })
  fs.mkdirSync(testDir, { recursive: true })
  resetSettingsCache()
  delete process.env.DISCORD_BOT_TOKEN
}

describe('delivery config', () => {
  beforeEach(clearState)
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('is unconfigured by default (no settings, no token)', () => {
    expect(isDiscordConfigured()).toBe(false)
    const cfg = readDiscordConfig()
    expect(cfg.settings.enabled).toBe(false)
    expect(cfg.token).toBeNull()
  })

  it('is unconfigured when enabled but token missing', () => {
    writeSettings({ discord: { enabled: true, guildIds: ['g1'] } })
    expect(isDiscordConfigured()).toBe(false)
  })

  it('is unconfigured when enabled with token but no guilds', () => {
    writeSettings({ discord: { enabled: true, guildIds: [] } })
    setStoredSecret('discord', 'botToken', 'tok-123')
    expect(isDiscordConfigured()).toBe(false)
  })

  it('is configured when enabled + token + guilds all present', () => {
    writeSettings({ discord: { enabled: true, guildIds: ['g1'] } })
    setStoredSecret('discord', 'botToken', 'tok-123')
    expect(isDiscordConfigured()).toBe(true)
    expect(readDiscordConfig().token).toBe('tok-123')
  })

  it('reads the token env-first (DISCORD_BOT_TOKEN wins over the store)', () => {
    writeSettings({ discord: { enabled: true, guildIds: ['g1'] } })
    setStoredSecret('discord', 'botToken', 'stored-tok')
    process.env.DISCORD_BOT_TOKEN = 'env-tok'
    expect(readDiscordConfig().token).toBe('env-tok')
  })

  it('stays disabled when enabled=true but settings.enabled flag is off', () => {
    writeSettings({ discord: { enabled: false, guildIds: ['g1'] } })
    setStoredSecret('discord', 'botToken', 'tok-123')
    expect(isDiscordConfigured()).toBe(false)
  })
})
