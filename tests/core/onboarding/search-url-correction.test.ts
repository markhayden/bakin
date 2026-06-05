/**
 * Tests for the legacy settings-URL auto-correction in the search component.
 *
 * Real settings module under a temp BAKIN_HOME; the search-adapter factory is
 * stubbed so install() succeeds without touching the network or a binary.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-search-url-${Date.now()}`)
const settingsFile = join(testDir, 'settings.json')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly'), settings: settingsFile }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly'), settings: settingsFile }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/search-adapter-factory', () => ({
  getSearchAdapterSetup: () => ({
    dependency: {
      name: 'antfly',
      check: async () => ({ name: 'antfly', status: 'ok', message: 'stub' }),
      install: async () => ({ name: 'antfly', status: 'installed', message: 'stub install', durationMs: 1 }),
    },
  }),
}))

// Dynamic imports AFTER mock.module registration: search.ts captures the
// factory at module top level, so a hoisted static import would evaluate it
// against the real factory before the mocks exist.
const { searchComponent } = await import('../../../src/core/onboarding/search')
const { resetSettingsCache } = await import('../../../src/core/settings')

const optsAutoYes = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
}

function writeSettings(overrides: Record<string, unknown>): void {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(settingsFile, JSON.stringify(overrides, null, 2))
  resetSettingsCache()
}

function readSettingsFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsFile, 'utf-8')) as Record<string, unknown>
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetSettingsCache()
})

afterEach(() => {
  resetSettingsCache()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('search component legacy URL correction', () => {
  it('rewrites a known pre-0.2 default URL after a successful install', async () => {
    writeSettings({
      search: { settings: { url: 'http://localhost:8080/api/v1' } },
    })

    const result = await searchComponent.install(optsAutoYes)

    expect(result.status).toBe('installed')
    expect(result.message).toContain('Updated settings.json search URL')
    const written = readSettingsFile() as { search: { settings: { url: string } } }
    expect(written.search.settings.url).toBe('http://localhost:3738')
  })

  it('never rewrites a deliberate non-default URL', async () => {
    writeSettings({
      search: { settings: { url: 'http://search.internal:8080' } },
    })

    const result = await searchComponent.install(optsAutoYes)

    expect(result.status).toBe('installed')
    expect(result.message).not.toContain('Updated settings.json')
    const written = readSettingsFile() as { search: { settings: { url: string } } }
    expect(written.search.settings.url).toBe('http://search.internal:8080')
  })

  it('does nothing when settings carry no explicit URL override', async () => {
    writeSettings({})

    const result = await searchComponent.install(optsAutoYes)

    expect(result.status).toBe('installed')
    expect(result.message).not.toContain('Updated settings.json')
  })
})
