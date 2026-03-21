import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getSettings, updateSettings, resetSettingsCache } from '../../src/core/settings'

const TEST_CONTENT_DIR = path.join(process.cwd(), 'test-content-settings')
const SETTINGS_DIR = path.join(TEST_CONTENT_DIR, '.beacon')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

describe('Settings', () => {
  beforeEach(() => {
    resetSettingsCache()
    process.env.CONTENT_DIR = TEST_CONTENT_DIR
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    delete process.env.CONTENT_DIR
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true })
    }
  })

  it('returns defaults when no settings file exists', () => {
    const settings = getSettings()
    expect(settings.dispatch.intervalMs).toBe(300000)
    expect(settings.sse.maxClients).toBe(50)
    expect(settings.agents).toContain('main-operator')
    expect(settings.agents).toContain('patch')
    expect(settings.antfly.enabled).toBe(false)
  })

  it('merges partial overrides with defaults', () => {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      dispatch: { intervalMs: 60000 },
      agents: ['main-operator', 'patch'],
    }))

    const settings = getSettings()
    expect(settings.dispatch.intervalMs).toBe(60000)
    expect(settings.dispatch.failureCooldownMs).toBe(1800000) // default preserved
    expect(settings.agents).toEqual(['main-operator', 'patch'])
  })

  it('caches settings on subsequent calls', () => {
    const s1 = getSettings()
    const s2 = getSettings()
    expect(s1).toBe(s2) // same reference
  })

  it('updateSettings writes and invalidates cache', () => {
    const updated = updateSettings({ sse: { maxClients: 100 } })
    expect(updated.sse.maxClients).toBe(100)
    expect(updated.dispatch.intervalMs).toBe(300000) // defaults preserved

    // File should exist
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true)
    const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    expect(onDisk.sse.maxClients).toBe(100)
  })

  it('resetSettingsCache forces re-read', () => {
    const s1 = getSettings()
    resetSettingsCache()
    const s2 = getSettings()
    expect(s1).not.toBe(s2) // different reference
    expect(s1).toEqual(s2) // same values
  })
})
