import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { getSettings, updateSettings, resetSettingsCache } from '../../src/core/settings'

const TEST_CONTENT_DIR = path.join(process.cwd(), 'test-content-settings')
const SETTINGS_FILE = path.join(TEST_CONTENT_DIR, 'settings.json')

describe('Settings', () => {
  beforeEach(() => {
    resetSettingsCache()
    process.env.BAKIN_HOME = TEST_CONTENT_DIR
    delete process.env.CONTENT_DIR
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
    expect(settings.antfly.enabled).toBe(true)
  })

  it('returns doctor defaults including requireOnboard', () => {
    const settings = getSettings()
    expect(settings.doctor.intervalMs).toBe(30 * 60 * 1000)
    expect(settings.doctor.autoFixSkill).toBe(true)
    // First-run onboarding gate — default true so new users get walked
    // through `bakin onboard` before doctor runs its full check suite.
    expect(settings.doctor.requireOnboard).toBe(true)
  })

  it('allows disabling doctor.requireOnboard via override', () => {
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      doctor: { requireOnboard: false },
    }))

    const settings = getSettings()
    expect(settings.doctor.requireOnboard).toBe(false)
    // Other doctor defaults preserved
    expect(settings.doctor.intervalMs).toBe(30 * 60 * 1000)
    expect(settings.doctor.autoFixSkill).toBe(true)
  })

  it('returns antfly search defaults', () => {
    const settings = getSettings()
    expect(settings.antfly.search.strategy).toBe('rrf')
    expect(settings.antfly.search.defaultLimit).toBe(20)
    expect(settings.antfly.search.reranker.enabled).toBe(true)
    expect(settings.antfly.search.reranker.provider).toBe('termite')
    expect(settings.antfly.search.reranker.model).toBe('mixedbread-ai/mxbai-rerank-base-v1')
    expect(settings.antfly.embedders.default.provider).toBe('termite')
    expect(settings.antfly.embedders.default.model).toBe('BAAI/bge-small-en-v1.5')
    expect(settings.antfly.embedders.visual.provider).toBe('termite')
    expect(settings.antfly.embedders.visual.model).toBe('openai/clip-vit-base-patch32')
    expect(settings.antfly.chunking.defaultTargetTokens).toBe(200)
    expect(settings.antfly.chunking.defaultOverlapTokens).toBe(25)
    expect(settings.antfly.auditTtl).toBe('90d')
    expect(settings.antfly.cleanupInterval).toBe('7d')
  })

  it('merges partial antfly overrides preserving nested defaults', () => {
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      antfly: { enabled: true, search: { defaultLimit: 50 } },
    }))

    const settings = getSettings()
    expect(settings.antfly.enabled).toBe(true)
    expect(settings.antfly.url).toBe('http://localhost:8080/api/v1') // default preserved
    expect(settings.antfly.search.defaultLimit).toBe(50) // overridden
    expect(settings.antfly.search.strategy).toBe('rrf') // default preserved
    expect(settings.antfly.embedders.default.provider).toBe('termite') // default preserved
    expect(settings.antfly.auditTtl).toBe('90d') // default preserved
  })

  it('merges partial overrides with defaults', () => {
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      dispatch: { intervalMs: 60000 },
    }))

    const settings = getSettings()
    expect(settings.dispatch.intervalMs).toBe(60000)
    expect(settings.dispatch.failureCooldownMs).toBe(1800000) // default preserved
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
