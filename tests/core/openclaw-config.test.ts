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
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

mock.module('fs', () => {
  const actual = require('fs') as typeof import('fs')
  return { ...actual, readFileSync: mock(), statSync: mock() }
})

import { readFileSync, statSync } from 'fs'

let readOpenClawConfig: typeof import('../../packages/adapter-openclaw/src/config').readOpenClawConfig
let getAgentList: typeof import('../../packages/adapter-openclaw/src/config').getAgentList
let getAgentIds: typeof import('../../packages/adapter-openclaw/src/config').getAgentIds
let findAgentById: typeof import('../../packages/adapter-openclaw/src/config').findAgentById
let materializeImplicitMainAgent: typeof import('../../packages/adapter-openclaw/src/config').materializeImplicitMainAgent
let resetOpenClawConfigCache: typeof import('../../packages/adapter-openclaw/src/config').resetOpenClawConfigCache

function configBody(list: Array<Record<string, unknown>>, defaults: Record<string, unknown> = {}): string {
  return JSON.stringify({ agents: { defaults, list } })
}

function mockFile(mtimeMs: number, content: string): void {
  vi.mocked(statSync).mockReturnValue({ mtimeMs } as any)
  vi.mocked(readFileSync).mockReturnValue(content)
}

describe('openclaw-config', () => {
  beforeEach(async () => {
    mock.clearAllMocks()
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })

    const mod = await import('../../packages/adapter-openclaw/src/config')
    readOpenClawConfig = mod.readOpenClawConfig
    getAgentList = mod.getAgentList
    getAgentIds = mod.getAgentIds
    findAgentById = mod.findAgentById
    materializeImplicitMainAgent = mod.materializeImplicitMainAgent
    resetOpenClawConfigCache = mod.resetOpenClawConfigCache
    // bun:test has no vi.resetModules equivalent; use the module's own cache reset
    resetOpenClawConfigCache()
  })

  describe('readOpenClawConfig', () => {
    it('returns null when openclaw.json is missing', () => {
      expect(readOpenClawConfig()).toBeNull()
    })

    it('returns parsed config when file exists and is valid JSON', () => {
      mockFile(1000, configBody([{ id: 'main', workspace: '/tmp/ws' }]))
      const config = readOpenClawConfig()
      expect(config?.agents?.list).toHaveLength(1)
      expect(config?.agents?.list?.[0].id).toBe('main')
    })

    it('returns null when file content is malformed JSON', () => {
      mockFile(1000, '{ not valid json')
      expect(readOpenClawConfig()).toBeNull()
    })

    it('caches parsed config across calls with unchanged mtime', () => {
      mockFile(1000, configBody([{ id: 'boss', workspace: '/tmp/ws' }]))
      readOpenClawConfig()
      readOpenClawConfig()
      readOpenClawConfig()
      expect(readFileSync).toHaveBeenCalledTimes(1)
      expect(statSync).toHaveBeenCalledTimes(3)
    })

    it('re-parses when mtime changes (live edit recovery)', () => {
      mockFile(1000, configBody([{ id: 'old', workspace: '/tmp/ws' }]))
      expect(readOpenClawConfig()?.agents?.list?.[0].id).toBe('old')

      mockFile(2000, configBody([{ id: 'new', workspace: '/tmp/ws' }]))
      expect(readOpenClawConfig()?.agents?.list?.[0].id).toBe('new')
      expect(readFileSync).toHaveBeenCalledTimes(2)
    })

    it('recovers when openclaw.json becomes available after being missing', () => {
      expect(readOpenClawConfig()).toBeNull()

      mockFile(1000, configBody([{ id: 'boss', workspace: '/tmp/ws' }]))
      expect(readOpenClawConfig()?.agents?.list?.[0].id).toBe('boss')
    })
  })

  describe('getAgentList / getAgentIds / findAgentById', () => {
    it('returns empty list when config is missing', () => {
      expect(getAgentList()).toEqual([])
      expect(getAgentIds()).toEqual([])
      expect(findAgentById('main')).toBeNull()
    })

    it('extracts agents from a well-formed config', () => {
      mockFile(1000, configBody([
        { id: 'main', identity: { name: 'Main Operator' }, workspace: '/tmp/ws' },
        { id: 'patch', workspace: '/tmp/ws/patch' },
      ]))
      expect(getAgentIds()).toEqual(['main', 'patch'])
      expect(findAgentById('main')?.identity?.name).toBe('Main Operator')
      expect(findAgentById('ghost')).toBeNull()
    })

    it('synthesizes OpenClaw implicit main when agents.list is missing', () => {
      mockFile(1000, JSON.stringify({
        agents: {
          defaults: {
            workspace: '/tmp/openclaw/workspace',
            model: { primary: 'openai-codex/gpt-5.5' },
          },
        },
      }))

      expect(getAgentIds()).toEqual(['main'])
      expect(findAgentById('main')).toEqual(expect.objectContaining({
        id: 'main',
        name: 'Main',
        workspace: '/tmp/openclaw/workspace',
        agentDir: expect.stringContaining('agents/main/agent'),
        model: { primary: 'openai-codex/gpt-5.5' },
      }))
    })

    it('materializes implicit main into ENTRIES for write paths without losing defaults (#873)', () => {
      const config: import('../../packages/adapter-openclaw/src/config').OpenClawConfig = {
        agents: {
          defaults: {
            workspace: '/tmp/openclaw/workspace',
            model: { primary: 'openai-codex/gpt-5.5' },
          },
        },
      }

      const agent = materializeImplicitMainAgent(config)

      expect(agent).not.toBeNull()
      // Lands in the canonical keyed registry — never the legacy list.
      expect(config.agents!.list).toBeUndefined()
      expect(config.agents!.entries!.main).toEqual(expect.objectContaining({
        workspace: '/tmp/openclaw/workspace',
        model: { primary: 'openai-codex/gpt-5.5' },
      }))
      expect(config.agents!.defaults!.workspace).toBe('/tmp/openclaw/workspace')
      // The returned object is the LIVE entry — mutations round-trip.
      agent!.identity = { name: 'Roscoe' }
      expect(config.agents!.entries!.main!.identity?.name).toBe('Roscoe')
    })

    it('materialize refuses to invent main inside an authoritative registry (#873 D2)', () => {
      const config: import('../../packages/adapter-openclaw/src/config').OpenClawConfig = {
        agents: { entries: { pixel: { workspace: '/w' } } },
      }
      expect(materializeImplicitMainAgent(config)).toBeNull()
      expect(config.agents!.entries!.main).toBeUndefined()
    })

    it('materialize on a legacy list config upgrades it to entries and returns live main', () => {
      const config: import('../../packages/adapter-openclaw/src/config').OpenClawConfig = {
        agents: { list: [{ id: 'main', workspace: '/mw' }, { id: 'pixel', workspace: '/pw' }] },
      }
      const agent = materializeImplicitMainAgent(config)
      expect(agent?.workspace).toBe('/mw')
      expect(config.agents!.list).toBeUndefined()
      expect(Object.keys(config.agents!.entries!).sort()).toEqual(['main', 'pixel'])
    })

    it('shares a cache across helper calls — only one parse', () => {
      mockFile(1000, configBody([{ id: 'boss', workspace: '/tmp/ws' }]))
      getAgentList()
      getAgentIds()
      findAgentById('boss')
      readOpenClawConfig()
      expect(readFileSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('resetOpenClawConfigCache', () => {
    it('forces a re-parse on the next call even when mtime is unchanged', () => {
      mockFile(1000, configBody([{ id: 'boss', workspace: '/tmp/ws' }]))
      readOpenClawConfig()
      expect(readFileSync).toHaveBeenCalledTimes(1)

      resetOpenClawConfigCache()
      readOpenClawConfig()
      expect(readFileSync).toHaveBeenCalledTimes(2)
    })
  })
})
