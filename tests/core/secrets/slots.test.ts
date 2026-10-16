/**
 * Declared secret-slot registry (spec §4.4): presence/status is public,
 * the value reader is a separate path never exposed on the root barrel.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-secret-slots-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { SECRET_SLOT, SECRET_SLOTS, resolveSecretSlotStatus, findSecretSlot } from '../../../packages/core/src/secrets/slots'
import { readSecretSlotValue } from '../../../packages/core/src/secrets/slot-value'
import { setStoredSecret, unsetStoredSecret } from '../../../packages/core/src/media/secret-store'
import * as coreRoot from '../../../packages/core/src/index'

beforeEach(() => {
  delete process.env.DISCORD_BOT_TOKEN
  unsetStoredSecret('discord', 'botToken')
})
afterAll(() => {
  delete process.env.DISCORD_BOT_TOKEN
  rmSync(testDir, { recursive: true, force: true })
})

describe('registry', () => {
  it('declares the Discord bot token and the Brave key with their env vars', () => {
    expect(SECRET_SLOT.discordBotToken).toMatchObject({ provider: 'discord', name: 'botToken', envVar: 'DISCORD_BOT_TOKEN', injectEnv: false })
    expect(SECRET_SLOT.braveApiKey).toMatchObject({ provider: 'brave', name: 'apiKey', envVar: 'BRAVE_SEARCH_API_KEY', injectEnv: true })
    expect(SECRET_SLOTS).toContain(SECRET_SLOT.discordBotToken)
    expect(SECRET_SLOT.discordBotToken.owner.href).toBe('/settings?tab=channels')
  })

  it('finds a slot by provider + name', () => {
    expect(findSecretSlot('discord', 'botToken')).toBe(SECRET_SLOT.discordBotToken)
    expect(findSecretSlot('discord', 'nope')).toBeNull()
  })
})

describe('resolveSecretSlotStatus', () => {
  it('reports absent when neither env nor store has it', () => {
    expect(resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)).toEqual({ present: false, source: null })
  })

  it('reports store when only the store has it', () => {
    setStoredSecret('discord', 'botToken', 'tok-store')
    expect(resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)).toEqual({ present: true, source: 'store' })
  })

  it('reports env over store when both are set', () => {
    setStoredSecret('discord', 'botToken', 'tok-store')
    process.env.DISCORD_BOT_TOKEN = 'tok-env'
    expect(resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)).toEqual({ present: true, source: 'env' })
  })

  it('treats a blank env var as unset', () => {
    process.env.DISCORD_BOT_TOKEN = '   '
    expect(resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)).toEqual({ present: false, source: null })
  })
})

describe('readSecretSlotValue (private path)', () => {
  it('returns the env value first, then the store, then null', () => {
    expect(readSecretSlotValue(SECRET_SLOT.discordBotToken)).toBeNull()
    setStoredSecret('discord', 'botToken', 'tok-store')
    expect(readSecretSlotValue(SECRET_SLOT.discordBotToken)).toBe('tok-store')
    process.env.DISCORD_BOT_TOKEN = 'tok-env'
    expect(readSecretSlotValue(SECRET_SLOT.discordBotToken)).toBe('tok-env')
  })

  it('is not exported by the @bakin/core root barrel', () => {
    expect(Object.keys(coreRoot)).not.toContain('readSecretSlotValue')
    expect(Object.keys(coreRoot)).not.toContain('getStoredSecret')
  })
})
