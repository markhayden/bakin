import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    agents: ['main-operator', 'pixel', 'trainer'],
  }),
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

import { execSync } from 'child_process'

describe('mcporter', () => {
  let tempDir: string
  let mcporterHome: string
  let mcporterConfig: string

  // Module exports — dynamically imported after setting HOME
  let serverName: typeof import('../../src/core/mcporter').serverName
  let mcpUrl: typeof import('../../src/core/mcporter').mcpUrl
  let syncConfig: typeof import('../../src/core/mcporter').syncConfig
  let verifyConfig: typeof import('../../src/core/mcporter').verifyConfig
  let isMcporterInstalled: typeof import('../../src/core/mcporter').isMcporterInstalled
  let ensureInstalled: typeof import('../../src/core/mcporter').ensureInstalled
  let setup: typeof import('../../src/core/mcporter').setup

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-mcporter-'))
    mcporterHome = join(tempDir, '.mcporter')
    mcporterConfig = join(mcporterHome, 'mcporter.json')

    // Set HOME before module import so MCPORTER_HOME captures tempDir
    process.env.HOME = tempDir
    vi.resetModules()

    const mod = await import('../../src/core/mcporter')
    serverName = mod.serverName
    mcpUrl = mod.mcpUrl
    syncConfig = mod.syncConfig
    verifyConfig = mod.verifyConfig
    isMcporterInstalled = mod.isMcporterInstalled
    ensureInstalled = mod.ensureInstalled
    setup = mod.setup
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // serverName / mcpUrl
  // -------------------------------------------------------------------------

  describe('serverName', () => {
    it('prefixes agent name with "bakin-"', () => {
      expect(serverName('pixel')).toBe('bakin-pixel')
      expect(serverName('main-operator')).toBe('bakin-main-operator')
    })
  })

  describe('mcpUrl', () => {
    it('builds MCP URL with agent and port', () => {
      expect(mcpUrl('pixel', 3737)).toBe('http://localhost:3737/mcp?agent=pixel')
      expect(mcpUrl('trainer', 4000)).toBe('http://localhost:4000/mcp?agent=trainer')
    })
  })

  // -------------------------------------------------------------------------
  // isMcporterInstalled
  // -------------------------------------------------------------------------

  describe('isMcporterInstalled', () => {
    it('returns true when which and --version succeed', () => {
      vi.mocked(execSync).mockReturnValue('ok')
      expect(isMcporterInstalled()).toBe(true)
    })

    it('returns false when execSync throws', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not found') })
      expect(isMcporterInstalled()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // ensureInstalled
  // -------------------------------------------------------------------------

  describe('ensureInstalled', () => {
    it('returns true if already installed', () => {
      vi.mocked(execSync).mockReturnValue('ok')
      expect(ensureInstalled()).toBe(true)
    })

    it('installs and returns true on success', () => {
      let callCount = 0
      vi.mocked(execSync).mockImplementation(() => {
        callCount++
        // isMcporterInstalled: first call (which) throws → returns false
        // installMcporter: second call (npm install) succeeds
        if (callCount <= 1) throw new Error('not found')
        return 'installed'
      })
      expect(ensureInstalled()).toBe(true)
    })

    it('returns false when install fails', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('fail') })
      expect(ensureInstalled()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // syncConfig
  // -------------------------------------------------------------------------

  describe('syncConfig', () => {
    it('creates entries for all agents when no config exists', () => {
      const changes = syncConfig(3737)
      expect(changes).toHaveLength(3)
      expect(changes).toContain('added bakin-main-operator')
      expect(changes).toContain('added bakin-pixel')
      expect(changes).toContain('added bakin-trainer')

      const config = JSON.parse(readFileSync(mcporterConfig, 'utf-8'))
      expect(config.mcpServers['bakin-main-operator'].url).toBe('http://localhost:3737/mcp?agent=main-operator')
    })

    it('returns empty when config is already up to date', () => {
      syncConfig(3737)
      const changes = syncConfig(3737)
      expect(changes).toHaveLength(0)
    })

    it('updates entries when port changes', () => {
      syncConfig(3737)
      const changes = syncConfig(4000)
      expect(changes).toHaveLength(3)
      expect(changes.every(c => c.startsWith('updated'))).toBe(true)

      const config = JSON.parse(readFileSync(mcporterConfig, 'utf-8'))
      expect(config.mcpServers['bakin-main-operator'].url).toContain('4000')
    })

    it('removes stale entries for agents no longer in settings', () => {
      mkdirSync(mcporterHome, { recursive: true })
      writeFileSync(mcporterConfig, JSON.stringify({
        mcpServers: {
          'bakin-main-operator': { url: 'http://localhost:3737/mcp?agent=main-operator' },
          'bakin-pixel': { url: 'http://localhost:3737/mcp?agent=pixel' },
          'bakin-trainer': { url: 'http://localhost:3737/mcp?agent=trainer' },
          'bakin-oldagent': { url: 'http://localhost:3737/mcp?agent=oldagent' },
        },
      }))

      const changes = syncConfig(3737)
      expect(changes).toContain('removed bakin-oldagent (agent no longer in settings)')

      const config = JSON.parse(readFileSync(mcporterConfig, 'utf-8'))
      expect(config.mcpServers['bakin-oldagent']).toBeUndefined()
    })

    it('preserves non-bakin entries', () => {
      mkdirSync(mcporterHome, { recursive: true })
      writeFileSync(mcporterConfig, JSON.stringify({
        mcpServers: {
          'other-tool': { url: 'http://localhost:9999/mcp' },
        },
      }))

      syncConfig(3737)
      const config = JSON.parse(readFileSync(mcporterConfig, 'utf-8'))
      expect(config.mcpServers['other-tool']).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // verifyConfig
  // -------------------------------------------------------------------------

  describe('verifyConfig', () => {
    it('reports correct entries after sync', () => {
      vi.mocked(execSync).mockReturnValue('ok')
      syncConfig(3737)

      const result = verifyConfig(3737)
      expect(result.installed).toBe(true)
      expect(result.configExists).toBe(true)
      expect(result.agentEntries).toHaveLength(3)
      expect(result.agentEntries.every(e => e.correct)).toBe(true)
      expect(result.staleEntries).toHaveLength(0)
    })

    it('reports incorrect entries when port differs', () => {
      syncConfig(3737)
      vi.mocked(execSync).mockReturnValue('ok')

      const result = verifyConfig(4000)
      expect(result.agentEntries.every(e => !e.correct)).toBe(true)
    })

    it('reports stale entries', () => {
      mkdirSync(mcporterHome, { recursive: true })
      writeFileSync(mcporterConfig, JSON.stringify({
        mcpServers: {
          'bakin-main-operator': { url: 'http://localhost:3737/mcp?agent=main-operator' },
          'bakin-stale': { url: 'http://localhost:3737/mcp?agent=stale' },
        },
      }))
      vi.mocked(execSync).mockReturnValue('ok')

      const result = verifyConfig(3737)
      expect(result.staleEntries).toContain('bakin-stale')
    })
  })

  // -------------------------------------------------------------------------
  // setup
  // -------------------------------------------------------------------------

  describe('setup', () => {
    it('returns true when install succeeds and config syncs', () => {
      vi.mocked(execSync).mockReturnValue('ok')
      expect(setup(3737)).toBe(true)
    })

    it('returns false when mcporter cannot be installed', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('fail') })
      expect(setup(3737)).toBe(false)
    })
  })
})
