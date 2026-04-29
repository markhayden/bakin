/**
 * Tests for the settings onboarding component.
 *
 * Uses BAKIN_HOME env var rather than a vi.mock on content-dir because
 * the component imports `updateSettings` from src/core/settings, which
 * reads its target path through `getContentDir()` at call time. Setting
 * the env var lets the real module cooperate with a temp directory
 * without having to mock two layers of re-exports.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'fs'
import path from 'path'

const TEST_CONTENT_DIR = path.join(process.cwd(), 'test-content-onboarding-settings')
const SETTINGS_FILE = path.join(TEST_CONTENT_DIR, 'settings.json')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding settings component', () => {
  let settingsComponent: typeof import('../../../src/core/onboarding/settings').settingsComponent
  let resetSettingsCache: typeof import('../../../src/core/settings').resetSettingsCache

  beforeEach(async () => {
    process.env.BAKIN_HOME = TEST_CONTENT_DIR
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_CONTENT_DIR, { recursive: true })
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/settings')
    settingsComponent = mod.settingsComponent
    const settingsMod = await import('../../../src/core/settings')
    resetSettingsCache = settingsMod.resetSettingsCache
    resetSettingsCache()
  })

  afterEach(() => {
    delete process.env.BAKIN_HOME
    if (fs.existsSync(TEST_CONTENT_DIR)) {
      fs.rmSync(TEST_CONTENT_DIR, { recursive: true, force: true })
    }
  })

  const opts = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }

  describe('check()', () => {
    it('reports missing when settings.json does not exist', async () => {
      const result = await settingsComponent.check()
      expect(result.status).toBe('missing')
      expect(result.remediation).toContain('bakin settings init')
    })

    it('reports broken when settings.json is zero bytes', async () => {
      fs.writeFileSync(SETTINGS_FILE, '', 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('empty')
    })

    it('reports broken when settings.json is not valid JSON', async () => {
      fs.writeFileSync(SETTINGS_FILE, 'not json at all {{{', 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('not valid JSON')
    })

    it('reports ok when settings.json is present and parses', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ dispatch: { intervalMs: 123 } }), 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('parses')
    })
  })

  describe('install()', () => {
    it('creates settings.json when missing', async () => {
      const result = await settingsComponent.install(opts)
      expect(result.status).toBe('installed')
      expect(fs.existsSync(SETTINGS_FILE)).toBe(true)
      // File must parse and not be empty — updateSettings({}) writes {} or
      // whatever override currently exists.
      const onDisk = fs.readFileSync(SETTINGS_FILE, 'utf-8')
      expect(onDisk.length).toBeGreaterThan(0)
      JSON.parse(onDisk) // throws if invalid
    })

    it('leaves existing overrides intact when called on a populated file', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ dispatch: { intervalMs: 42 } }), 'utf-8')
      resetSettingsCache()
      await settingsComponent.install(opts)
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
      // install() uses updateSettings({}) which deep-merges {} onto the
      // existing override — so our 42 value must survive.
      expect(onDisk.dispatch?.intervalMs).toBe(42)
    })

    it('post-install check reports ok', async () => {
      await settingsComponent.install(opts)
      const result = await settingsComponent.check()
      expect(result.status).toBe('ok')
    })
  })
})
