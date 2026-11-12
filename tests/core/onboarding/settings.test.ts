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
import { installInOperation } from '../../helpers/operation-harness'

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
    autoApprove: true,
    allowServiceClaim: false
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

    it('a file that is not JSON is an error the operator has to fix, never something to reseed', async () => {
      fs.writeFileSync(SETTINGS_FILE, 'not json at all {{{', 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('error')
      expect(result.message).toContain('not valid JSON')
      expect(result.remediation).toContain('will not write over it')
    })

    it.each([
      ['an array', '[]'],
      ['a bare string', '"settings"'],
      ['null', 'null'],
    ])('a file that is JSON but not an object (%s) is an error', async (_label, content) => {
      fs.writeFileSync(SETTINGS_FILE, content, 'utf-8')
      expect((await settingsComponent.check()).status).toBe('error')
    })

    it('a stored runtime Bakin does not support is an error that names it', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ runtime: { adapter: 'bogus' } }), 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('error')
      expect(result.message).toContain('"bogus"')
      expect(result.details?.why).toBe('unsupported_runtime')
    })

    it('reports the stored runtime when there is one', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ runtime: { adapter: 'pi' } }), 'utf-8')
      const result = await settingsComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.runtimeAdapter).toBe('pi')
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
      const result = await installInOperation(settingsComponent, opts)
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
      await installInOperation(settingsComponent, opts)
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
      // install() uses updateSettings({}) which deep-merges {} onto the
      // existing override — so our 42 value must survive.
      expect(onDisk.dispatch?.intervalMs).toBe(42)
    })

    it('post-install check reports ok', async () => {
      await installInOperation(settingsComponent, opts)
      const result = await settingsComponent.check()
      expect(result.status).toBe('ok')
    })
  })

  describe('install() never writes over a file it cannot trust', () => {
    it.each([
      ['not JSON', '{ "runtime": '],
      ['not an object', '[1, 2]'],
      ['an unsupported stored runtime', JSON.stringify({ runtime: { adapter: 'bogus' }, dispatch: { intervalMs: 7 } })],
    ])('%s: fails with settings_untrustworthy and leaves the bytes alone', async (_label, content) => {
      fs.writeFileSync(SETTINGS_FILE, content, 'utf-8')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('failed')
      expect(result.code).toBe('settings_untrustworthy')
      expect(fs.readFileSync(SETTINGS_FILE, 'utf-8')).toBe(content)
    })

    it('a zero-byte file holds nothing to lose and is reseeded', async () => {
      fs.writeFileSync(SETTINGS_FILE, '', 'utf-8')
      const result = await installInOperation(settingsComponent, opts)
      expect(result.status).toBe('installed')
      expect(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))).toEqual({})
    })
  })

  describe('install() commits a first-run runtime choice', () => {
    const stored = () => (JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as { runtime?: { adapter?: string } }).runtime?.adapter

    it('owns install-state: the choice has one writer at a time', () => {
      expect(settingsComponent.resources).toEqual(['install-state'])
    })

    it.each([
      ['no file', null],
      ['an empty object', '{}'],
      ['zero bytes', ''],
      ['other settings but no runtime', JSON.stringify({ dispatch: { intervalMs: 42 } })],
    ])('%s: undecided, so the proposal is stored', async (_label, content) => {
      if (content !== null) fs.writeFileSync(SETTINGS_FILE, content, 'utf-8')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('installed')
      expect(stored()).toBe('pi')
    })

    it('keeps everything else in the file', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ dispatch: { intervalMs: 42 }, runtime: { settings: { gatewayPort: 1234 } } }), 'utf-8')
      await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'openclaw' })
      expect(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))).toEqual({ dispatch: { intervalMs: 42 }, runtime: { settings: { gatewayPort: 1234 }, adapter: 'openclaw' } })
    })

    it('a stored runtime equal to the proposal is already the answer', async () => {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ runtime: { adapter: 'pi' } }), 'utf-8')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('installed')
      expect(stored()).toBe('pi')
    })

    it('a DIFFERENT stored runtime fails runtime_already_set and is never switched', async () => {
      const content = JSON.stringify({ runtime: { adapter: 'openclaw' } })
      fs.writeFileSync(SETTINGS_FILE, content, 'utf-8')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('failed')
      expect(result.code).toBe('runtime_already_set')
      expect(result.message).toContain('bakin runtime use pi')
      expect(fs.readFileSync(SETTINGS_FILE, 'utf-8')).toBe(content)
    })

    it('two proposals in a row: the first wins, the second is refused', async () => {
      const first = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      const second = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'openclaw' })
      expect([first.status, second.status, second.code]).toEqual(['installed', 'failed', 'runtime_already_set'])
      expect(stored()).toBe('pi')
    })

    it('a proposal Bakin does not support is refused and nothing is stored', async () => {
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'bogus' })
      expect(result.status).toBe('failed')
      expect(result.code).toBe('invalid_runtime')
      expect(fs.existsSync(SETTINGS_FILE)).toBe(false)
    })

    it('without a proposal nothing about the runtime is written', async () => {
      await installInOperation(settingsComponent, opts)
      expect(stored()).toBeUndefined()
    })
  })

  describe('install() inside a running server', () => {
    const SERVER_LOCK = path.join(TEST_CONTENT_DIR, 'server.lock')
    const stored = () => (JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as { runtime?: { adapter?: string } }).runtime?.adapter
    /** This process is the server for the home, bound to `adapter` at boot. */
    async function actAsServerOn(adapter: string): Promise<void> {
      fs.writeFileSync(SERVER_LOCK, JSON.stringify({ pid: process.pid, port: 3999, startedAt: Date.now(), bootId: 'test-boot' }))
      const { setAppServices } = await import('../../../src/core/app-services-store')
      setAppServices({ runtime: { name: adapter } } as never)
    }

    afterEach(async () => {
      const { setAppServices } = await import('../../../src/core/app-services-store')
      setAppServices(null as never)
    })

    it('a server on a different runtime refuses the proposal: it cannot follow a new adapter until it restarts', async () => {
      await actAsServerOn('openclaw')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('failed')
      expect(result.code).toBe('server_running_other_runtime')
      expect(fs.existsSync(SETTINGS_FILE)).toBe(false)
    })

    it('a server on the same runtime stores it', async () => {
      await actAsServerOn('pi')
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('installed')
      expect(stored()).toBe('pi')
    })

    it("another process's server lock is not this process's server", async () => {
      await actAsServerOn('openclaw')
      // A live pid that is not ours: this process is a CLI beside a server.
      fs.writeFileSync(SERVER_LOCK, JSON.stringify({ pid: process.ppid, port: 3999, startedAt: Date.now(), bootId: 'test-boot' }))
      const result = await installInOperation(settingsComponent, { ...opts, runtimeAdapter: 'pi' })
      expect(result.status).toBe('installed')
    })
  })
})
