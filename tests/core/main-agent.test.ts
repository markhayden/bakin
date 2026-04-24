import { describe, it, expect, beforeEach, mock, type Mock } from 'bun:test'
import { join } from 'path'

const testHome = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const home = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclaw = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = openclaw
  return { home, openclaw }
})()

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome.home,
  getBakinPaths: () => ({
    home: testHome.home,
    memoryLog: join(testHome.home, 'MEMORY-LOG.md'),
    messaging: join(testHome.home, 'messaging.json'),
    audit: join(testHome.home, 'audit.jsonl'),
    assets: join(testHome.home, 'assets'),
    'assets.store': join(testHome.home, 'assets', 'store'),
    'assets.inbox': join(testHome.home, 'assets', 'inbox'),
    'assets.trash': join(testHome.home, 'assets', '.trash'),
    agents: join(testHome.home, 'agents'),
    personas: join(testHome.home, 'team', 'personas'),
    team: join(testHome.home, 'team'),
    heartbeats: join(testHome.home, 'heartbeats'),
    inbox: join(testHome.home, 'inbox'),
    projects: join(testHome.home, 'projects'),
    workflows: join(testHome.home, 'workflows'),
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

// Unmock main-agent — global setup replaces it with a constant-returning stub,
// but this test suite exercises the real resolution logic.
vi.unmock('../../packages/core/src/main-agent')
vi.unmock('@bakin/core/main-agent')

vi.mock('fs', async (importOriginal: <T = any>() => Promise<T>) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: mock(), statSync: mock() }
})

import { readFileSync, statSync } from 'fs'

let getMainAgentId: typeof import('../../packages/core/src/main-agent').getMainAgentId
let tryGetMainAgentId: typeof import('../../packages/core/src/main-agent').tryGetMainAgentId
let getMainAgentName: typeof import('../../packages/core/src/main-agent').getMainAgentName

function openclawConfig(list: Array<Record<string, unknown>>): string {
  return JSON.stringify({ agents: { list } })
}

function mockOpenclawFile(mtimeMs: number, content: string): void {
  vi.mocked(statSync).mockReturnValue({ mtimeMs } as any)
  vi.mocked(readFileSync).mockReturnValue(content)
}

describe('main-agent', () => {
  beforeEach(async () => {
    vi.resetModules()
    mock.clearAllMocks()
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })

    const mod = await import('../../packages/core/src/main-agent')
    getMainAgentId = mod.getMainAgentId
    tryGetMainAgentId = mod.tryGetMainAgentId
    getMainAgentName = mod.getMainAgentName
  })

  describe('getMainAgentId', () => {
    it('returns "main" when openclaw.json has an agent with id "main"', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: 'Roscoe' } },
        { id: 'patch', workspace: '/tmp/ws/patch' },
      ]))
      expect(getMainAgentId()).toBe('main')
    })

    it('throws a clear error when openclaw.json has no "main" entry', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'pixel', workspace: '/tmp/ws/pixel' },
        { id: 'patch', workspace: '/tmp/ws/patch' },
      ]))
      expect(() => getMainAgentId()).toThrow(/openclaw\.json has no agent with id 'main'/)
      expect(() => getMainAgentId()).toThrow(/bakin check openclaw/)
    })

    it('throws when openclaw.json is missing entirely', () => {
      expect(() => getMainAgentId()).toThrow(/openclaw\.json has no agent with id 'main'/)
    })
  })

  describe('tryGetMainAgentId', () => {
    it('returns "main" in the happy case', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: 'Roscoe' } },
      ]))
      expect(tryGetMainAgentId()).toBe('main')
    })

    it('returns null when openclaw.json has no "main" entry', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'pixel', workspace: '/tmp/ws/pixel' },
      ]))
      expect(tryGetMainAgentId()).toBeNull()
    })

    it('returns null when openclaw.json is missing', () => {
      expect(tryGetMainAgentId()).toBeNull()
    })
  })

  describe('getMainAgentName', () => {
    it('returns identity.name when set on the main entry', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: 'Roscoe' } },
      ]))
      expect(getMainAgentName()).toBe('Roscoe')
    })

    it('returns "Main" when identity.name is absent', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main' },
      ]))
      expect(getMainAgentName()).toBe('Main')
    })

    it('returns "Main" when identity.name is a blank string', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: '   ' } },
      ]))
      expect(getMainAgentName()).toBe('Main')
    })

    it('returns "Main" when openclaw.json has no main entry', () => {
      // getMainAgentName degrades gracefully rather than throwing — it has no
      // agent to pull a name from, so the static fallback applies.
      mockOpenclawFile(1000, openclawConfig([
        { id: 'pixel', workspace: '/tmp/ws/pixel' },
      ]))
      expect(getMainAgentName()).toBe('Main')
    })
  })

  describe('live openclaw.json edits', () => {
    it('picks up a rename of identity.name without a restart (mtime change)', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: 'Roscoe' } },
      ]))
      expect(getMainAgentName()).toBe('Roscoe')

      mockOpenclawFile(2000, openclawConfig([
        { id: 'main', identity: { name: 'Captain' } },
      ]))
      expect(getMainAgentName()).toBe('Captain')
    })

    it('picks up a removal of the "main" entry (mtime change)', () => {
      mockOpenclawFile(1000, openclawConfig([
        { id: 'main', identity: { name: 'Roscoe' } },
      ]))
      expect(getMainAgentId()).toBe('main')

      mockOpenclawFile(2000, openclawConfig([
        { id: 'pixel', workspace: '/tmp/ws/pixel' },
      ]))
      expect(() => getMainAgentId()).toThrow(/openclaw\.json has no agent with id 'main'/)
    })
  })
})
