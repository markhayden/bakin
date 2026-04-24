/**
 * Tests for the mkdir onboarding component.
 *
 * Uses a real temp directory rather than mocking fs — the whole component is
 * a thin wrapper around `initBakinHome`, which in turn is essentially mkdirs
 * against the filesystem. Mocking fs here would just re-implement the
 * function under test. Content-dir is mocked so the temp dir stands in for
 * ~/.bakin/. Logger is stubbed to silence output.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, rmdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

mock.module('../../../src/core/content-dir', async () => {
  const actual = await import('../../../src/core/content-dir')
  return {
    ...actual,
    getContentDir: () => testDir,
    getBakinPaths: () => {
      const home = testDir
      const assets = join(home, 'assets')
      return {
        home,
        memoryLog: join(home, 'MEMORY-LOG.md'),
        messaging: join(home, 'messaging.json'),
        audit: join(home, 'audit.jsonl'),
        assets,
        'assets.store': join(assets, 'store'),
        'assets.inbox': join(assets, 'inbox'),
        'assets.trash': join(assets, '.trash'),
        agents: join(home, 'agents'),
        personas: join(home, 'team', 'personas'),
        team: join(home, 'team'),
        heartbeats: join(home, 'heartbeats'),
        inbox: join(home, 'inbox'),
        projects: join(home, 'projects'),
        workflows: join(home, 'workflows'),
        settings: join(home, 'settings.json'),
      }
    },
  }
})

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('onboarding mkdir component', () => {
  let mkdirComponent: typeof import('../../../src/core/onboarding/mkdir').mkdirComponent

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-onboarding-mkdir-'))
    // Create the outer dir but delete it so the component sees a missing home
    rmSync(testDir, { recursive: true, force: true })
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/mkdir')
    mkdirComponent = mod.mkdirComponent
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('check()', () => {
    it('reports missing when the home directory does not exist', async () => {
      const result = await mkdirComponent.check()
      expect(result.status).toBe('missing')
      expect(result.name).toBe('mkdir')
      expect(result.remediation).toContain('bakin mkdir')
      expect(result.details?.missing).toBeDefined()
      expect(Array.isArray(result.details!.missing)).toBe(true)
    })

    it('reports ok after install completes', async () => {
      await mkdirComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      const result = await mkdirComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain(testDir)
    })

    it('reports missing when a single required subdirectory is removed', async () => {
      await mkdirComponent.install({
        interactive: false,
        autoApprove: true,
        json: false,
        checkOnly: false,
        force: false,
      })
      // Delete one required subdirectory
      rmdirSync(join(testDir, 'heartbeats'))
      const result = await mkdirComponent.check()
      expect(result.status).toBe('missing')
      expect((result.details!.missing as string[]).some((d) => d.endsWith('heartbeats'))).toBe(true)
    })
  })

  describe('install()', () => {
    const opts = {
      interactive: false,
      autoApprove: true,
      json: false,
      checkOnly: false,
      force: false,
    }

    it('creates the full directory tree on first run', async () => {
      const result = await mkdirComponent.install(opts)
      expect(result.status).toBe('installed')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(existsSync(join(testDir, 'assets', 'store'))).toBe(true)
      expect(existsSync(join(testDir, 'assets', 'inbox'))).toBe(true)
      expect(existsSync(join(testDir, 'agents'))).toBe(true)
      expect(existsSync(join(testDir, 'heartbeats'))).toBe(true)
      expect(existsSync(join(testDir, 'settings.json'))).toBe(true)
    })

    it('is idempotent — second install is a noop', async () => {
      await mkdirComponent.install(opts)
      const second = await mkdirComponent.install(opts)
      expect(second.status).toBe('noop')
      expect(second.message).toContain('Already initialized')
    })

    it('re-creates only the missing pieces on partial wipe', async () => {
      await mkdirComponent.install(opts)
      rmSync(join(testDir, 'projects'), { recursive: true, force: true })
      const second = await mkdirComponent.install(opts)
      // Not a noop — something was missing
      expect(second.status).toBe('installed')
      expect(existsSync(join(testDir, 'projects'))).toBe(true)
    })
  })
})
