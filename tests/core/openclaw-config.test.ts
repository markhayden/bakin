import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'path'

const testHome = vi.hoisted(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const home = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclaw = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = openclaw
  return { home, openclaw }
})

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testHome.home,
  getBakinPaths: () => ({
    home: testHome.home,
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn(), statSync: vi.fn() }
})

import { readFileSync, statSync } from 'fs'

let readOpenClawConfig: typeof import('../../packages/core/src/openclaw-config').readOpenClawConfig
let getAgentList: typeof import('../../packages/core/src/openclaw-config').getAgentList
let getAgentIds: typeof import('../../packages/core/src/openclaw-config').getAgentIds
let findAgentById: typeof import('../../packages/core/src/openclaw-config').findAgentById
let resetOpenClawConfigCache: typeof import('../../packages/core/src/openclaw-config').resetOpenClawConfigCache

function configBody(list: Array<Record<string, unknown>>, defaults: Record<string, unknown> = {}): string {
  return JSON.stringify({ agents: { defaults, list } })
}

function mockFile(mtimeMs: number, content: string): void {
  vi.mocked(statSync).mockReturnValue({ mtimeMs } as any)
  vi.mocked(readFileSync).mockReturnValue(content)
}

describe('openclaw-config', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })

    const mod = await import('../../packages/core/src/openclaw-config')
    readOpenClawConfig = mod.readOpenClawConfig
    getAgentList = mod.getAgentList
    getAgentIds = mod.getAgentIds
    findAgentById = mod.findAgentById
    resetOpenClawConfigCache = mod.resetOpenClawConfigCache
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
