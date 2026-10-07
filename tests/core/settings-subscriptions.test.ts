/**
 * Change subscriptions on core settings and the secret store (spec D11), and
 * replace semantics for map-valued settings (spec D10): deepMerge keeps
 * omitted keys, so alias deletion needs an explicit replace path.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-settings-subs-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  getSettings,
  updateSettings,
  replaceSettingsValue,
  resetSettingsCache,
  subscribeSettingsChanged,
} from '../../packages/core/src/settings'
import {
  setStoredSecret,
  unsetStoredSecret,
  subscribeSecretChanged,
} from '../../packages/core/src/media/secret-store'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetSettingsCache()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('subscribeSettingsChanged', () => {
  it('notifies with the top-level keys of an updateSettings write and stops after unsubscribe', () => {
    const seen: string[][] = []
    const off = subscribeSettingsChanged((change) => { seen.push(change.keys) })
    updateSettings({ integrations: { discord: { enabled: true } }, notifications: { channel: 'x' } })
    expect(seen).toEqual([['integrations', 'notifications']])
    off()
    updateSettings({ integrations: { discord: { enabled: false } } })
    expect(seen).toHaveLength(1)
  })

  it('isolates a throwing listener from the others and from the write', () => {
    const seen: number[] = []
    const offA = subscribeSettingsChanged(() => { throw new Error('boom') })
    const offB = subscribeSettingsChanged(() => { seen.push(1) })
    expect(() => updateSettings({ notifications: { channel: 'y' } })).not.toThrow()
    expect(seen).toEqual([1])
    offA(); offB()
  })
})

describe('replaceSettingsValue', () => {
  it('replaces a map wholesale so omitted keys are deleted (deepMerge would keep them)', () => {
    updateSettings({ notifications: { channelAliases: { alerts: 'discord:channel:1', daily: 'discord:channel:2' } } })
    expect(getSettings().notifications.channelAliases).toEqual({ alerts: 'discord:channel:1', daily: 'discord:channel:2' })

    // Control: the merge path keeps the omitted key.
    updateSettings({ notifications: { channelAliases: { alerts: 'discord:channel:9' } } })
    expect(getSettings().notifications.channelAliases).toEqual({ alerts: 'discord:channel:9', daily: 'discord:channel:2' })

    const seen: string[][] = []
    const off = subscribeSettingsChanged((change) => { seen.push(change.keys) })
    replaceSettingsValue('notifications.channelAliases', { alerts: 'discord:channel:9' })
    off()
    expect(getSettings().notifications.channelAliases).toEqual({ alerts: 'discord:channel:9' })
    expect(seen).toEqual([['notifications']])

    const onDisk = JSON.parse(readFileSync(join(testDir, 'settings.json'), 'utf-8'))
    expect(onDisk.notifications.channelAliases).toEqual({ alerts: 'discord:channel:9' })
  })

  it('creates intermediate objects and the file when nothing exists yet', () => {
    expect(existsSync(join(testDir, 'settings.json'))).toBe(false)
    replaceSettingsValue('notifications.channelAliases', { a: 'discord:channel:1' })
    expect(getSettings().notifications.channelAliases).toEqual({ a: 'discord:channel:1' })
  })

  it('rejects an empty path', () => {
    expect(() => replaceSettingsValue('', {})).toThrow()
  })
})

describe('subscribeSecretChanged', () => {
  it('notifies on set and unset with provider + name + action, and stops after unsubscribe', () => {
    const seen: Array<{ provider: string; name: string; action: string }> = []
    const off = subscribeSecretChanged((change) => { seen.push(change) })
    setStoredSecret('discord', 'botToken', 'tok')
    expect(unsetStoredSecret('discord', 'botToken')).toBe(true)
    expect(unsetStoredSecret('discord', 'botToken')).toBe(false)
    off()
    setStoredSecret('discord', 'botToken', 'tok2')
    expect(seen).toEqual([
      { provider: 'discord', name: 'botToken', action: 'set' },
      { provider: 'discord', name: 'botToken', action: 'unset' },
    ])
  })
})
