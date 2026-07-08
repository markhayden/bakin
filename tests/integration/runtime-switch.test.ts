/**
 * Runtime switch orchestrator (P3.1) — isolated end-to-end over REAL adapters
 * and temp homes: OpenClaw (config-file backed) → Pi (registry backed).
 *
 * Covers: backup, deprovision (OpenClaw bakin-* MCP entries pruned), flip,
 * target init + provision, roster carry with model mapping (unique bare-model
 * match) + honest unmapped report, drift-gated sync skip, capability report,
 * and failure-path restore of the original adapter.
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-runtime-switch-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const contentDirFactory = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    db: pathJoin(testDir, 'bakin.db'),
    settings: pathJoin(testDir, 'settings.json'),
    tasks: pathJoin(testDir, 'tasks'),
    logs: pathJoin(testDir, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
})
mock.module('../../src/core/content-dir', contentDirFactory)
mock.module('../../packages/core/src/content-dir', contentDirFactory)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@bakin/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/watcher', () => ({ startWatcher: () => {}, stopWatcher: () => {} }))

// Drift scan is exercised as a controllable seam: default = no drift (skip);
// one test makes it throw to prove the restore path.
let scanShouldThrow = false
mock.module('../../src/core/agent-packages/sync-scanner', () => ({
  scanAgentSync: async () => {
    if (scanShouldThrow) throw new Error('forced scan failure')
    return { findings: [], agentsScanned: 0, blocksOk: 0, projectionsOk: 0 }
  },
}))

import { switchRuntime } from '../../src/core/runtime-switch'
import { getSettings, resetSettingsCache, updateSettings } from '../../src/core/settings'
import { closeDb } from '../../packages/core/src/storage/db'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

const openclawConfigPath = pathJoin(testDir, 'openclaw', 'openclaw.json')

function seedOpenClawHome(): void {
  mkdirSync(pathJoin(testDir, 'openclaw'), { recursive: true })
  writeFileSync(openclawConfigPath, JSON.stringify({
    agents: {
      defaults: { model: { primary: 'openai/gpt-test-text' } },
      list: [
        { id: 'main', identity: { name: 'Main', emoji: '🐾' } },
        // Maps by unique bare-model match onto Pi's openai-codex catalog:
        { id: 'pixel', identity: { name: 'Pixel', emoji: '🖼️' }, model: { primary: 'openai/gpt-test-vision' } },
        // No Pi equivalent — must be REPORTED unmapped, carried modelless:
        { id: 'rolo', identity: { name: 'Rolo' }, model: { primary: 'anthropic/claude-nope' } },
      ],
    },
    mcp: {
      servers: {
        'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
        keepers: { url: 'http://localhost:9000/mcp' },
      },
    },
  }, null, 2))
  resetOpenClawConfigCache()
}

function seedPiHome(): void {
  const agentDir = pathJoin(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(pathJoin(agentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'k' } }))
  writeFileSync(pathJoin(agentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-codex': {
        name: 'Codex', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions',
        models: [
          { id: 'gpt-test-text', name: 'Text', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
          { id: 'gpt-test-vision', name: 'Vision', input: ['text', 'image'], reasoning: true, contextWindow: 2000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  }))
}

beforeAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  seedOpenClawHome()
  seedPiHome()
  resetPiHome()
  resetModelRegistry()
  // Search stays DISABLED so createAppServices never inspects the real OS
  // service (launchd) from a test process.
  updateSettings({ runtime: { adapter: 'openclaw' }, search: { settings: { enabled: false } } })
  resetSettingsCache()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('switchRuntime — validation', () => {
  it('rejects an unknown adapter without touching anything', async () => {
    const result = await switchRuntime('hermes')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown runtime adapter')
    expect(getSettings().runtime.adapter).toBe('openclaw')
  })

  it('rejects a switch to the already-active adapter', async () => {
    const result = await switchRuntime('openclaw')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('already active')
  })
})

describe('switchRuntime — OpenClaw → Pi', () => {
  it('runs the full lifecycle with an honest carry report', async () => {
    const phases: string[] = []
    const result = await switchRuntime('pi', {
      onProgress: (e) => { if (e.status !== 'start') phases.push(`${e.phase}:${e.status}`) },
    })

    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.from).toBe('openclaw')
    expect(result.to).toBe('pi')
    expect(result.restartRequired).toBe(true)

    // Settings flipped + backup exists.
    expect(getSettings().runtime.adapter).toBe('pi')
    expect(result.backupPath).toBeTruthy()
    expect(existsSync(result.backupPath!)).toBe(true)
    expect(JSON.parse(readFileSync(result.backupPath!, 'utf-8')).runtime.adapter).toBe('openclaw')

    // Deprovision pruned OpenClaw's Bakin-owned MCP entries; foreign kept.
    const ocConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    expect(ocConfig.mcp.servers['bakin-main']).toBeUndefined()
    expect(ocConfig.mcp.servers.keepers).toBeDefined()

    // Roster carry: Pi seeds its own 'main' (existing); pixel maps by unique
    // bare-model match; rolo carries modelless + is reported unmapped.
    expect(result.roster!.existing).toContain('main')
    const pixel = result.roster!.carried.find((c) => c.agentId === 'pixel')!
    expect(pixel.model).toBe('openai-codex/gpt-test-vision')
    expect(pixel.mappedFrom).toBe('openai/gpt-test-vision')
    const rolo = result.roster!.carried.find((c) => c.agentId === 'rolo')!
    expect(rolo.model).toBeUndefined()
    expect(result.roster!.unmappedModels).toEqual([{ agentId: 'rolo', sourceModel: 'anthropic/claude-nope' }])
    expect(result.roster!.failed).toEqual([])

    // Drift-gated projection skipped (no drift), capabilities + access honest.
    expect(phases).toContain('sync-agents:skip')
    expect(result.sync).toEqual({ drifted: false, findings: 0, syncedAgents: 0 })
    expect(result.capabilities!.toolCalling.access.style).toBe('in-process')
    expect(result.capabilities!.delivery.mode).toBe('unavailable')
    expect(result.toolAccess).toEqual({ style: 'in-process', ok: true, issues: [] })

    // The carried agents genuinely exist on Pi.
    const registry = JSON.parse(readFileSync(pathJoin(testDir, 'pi', 'agent', 'bakin-agents.json'), 'utf-8')) as { agents: Array<{ id: string; model?: string }> }
    const ids = registry.agents.map((a) => a.id).sort()
    expect(ids).toEqual(['main', 'pixel', 'rolo'])
    expect(registry.agents.find((a) => a.id === 'pixel')?.model).toBe('openai-codex/gpt-test-vision')
  })

  it('round-trip back: OpenClaw roster untouched while inactive (existing, not re-created)', async () => {
    const result = await switchRuntime('openclaw')
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(getSettings().runtime.adapter).toBe('openclaw')

    // Every source agent already exists on OpenClaw — nothing re-created,
    // pixel's original OpenClaw model assignment preserved by construction.
    expect(result.roster!.carried).toEqual([])
    expect(result.roster!.existing.sort()).toEqual(['main', 'pixel', 'rolo'])
    const ocConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    const pixel = ocConfig.agents.list.find((a: { id: string }) => a.id === 'pixel')
    expect(pixel.model.primary).toBe('openai/gpt-test-vision')

    // Provisioning rebuilt the per-agent MCP entries on the way back in.
    expect(ocConfig.mcp.servers['bakin-main']).toBeDefined()
    expect(result.capabilities!.toolCalling.access.style).toBe('mcp')
  })
})

describe('switchRuntime — failure restores the original adapter', () => {
  it('a mid-step failure restores settings + services to the source runtime', async () => {
    expect(getSettings().runtime.adapter).toBe('openclaw')
    scanShouldThrow = true
    try {
      const result = await switchRuntime('pi')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('forced scan failure')
      expect(result.restored).toBe(true)
      expect(getSettings().runtime.adapter).toBe('openclaw')
    } finally {
      scanShouldThrow = false
    }
  })
})
