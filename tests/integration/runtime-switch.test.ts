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

  // Pixel's workspace content — what makes the agent ITSELF (D2 carry):
  // canonical soul (with self-edits), memory, one agent-authored skill, and
  // one package-managed skill that must be left to `agents sync`.
  const pixelWs = pathJoin(testDir, 'openclaw', 'workspaces', 'pixel')
  mkdirSync(pathJoin(pixelWs, 'memory'), { recursive: true })
  writeFileSync(pathJoin(pixelWs, 'SOUL.md'), PIXEL_SOUL)
  writeFileSync(pathJoin(pixelWs, 'memory', 'notes.md'), PIXEL_MEMORY)
  mkdirSync(pathJoin(pixelWs, 'skills', 'crafting'), { recursive: true })
  writeFileSync(pathJoin(pixelWs, 'skills', 'crafting', 'SKILL.md'), PIXEL_SKILL)
  mkdirSync(pathJoin(pixelWs, 'skills', 'packskill'), { recursive: true })
  writeFileSync(pathJoin(pixelWs, 'skills', 'packskill', 'SKILL.md'), '# projected by a package')
  writeFileSync(pathJoin(pixelWs, 'skills', 'packskill', '.installedBy'), JSON.stringify({ package: 'bits/pack', version: '1.0.0' }))
}

const PIXEL_SOUL = '# Pixel\n\nI collect tiny pixel-art references and prefer terse replies.\n'
const PIXEL_MEMORY = '## 2026-07\n\n- the user likes crab emojis\n'
const PIXEL_SKILL = '# crafting\n\nHow pixel crafts sprite sheets.\n'

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
    expect(result.roster!.unmappedModels).toEqual([{ agentId: 'rolo', sourceModel: 'anthropic/claude-nope', field: 'model' }])
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

    // Workspace content carried for switch-created agents (D2, kind-aware):
    // soul + memory byte-identical on Pi, agent-authored skill at PI's skill
    // location, package-managed skill left to sync, no dead skills/ files.
    expect(phases).toContain('carry-workspaces:ok')
    const piPixelWs = pathJoin(testDir, 'pi', 'agent', 'agents', 'pixel', 'workspace')
    expect(readFileSync(pathJoin(piPixelWs, 'SOUL.md'), 'utf-8')).toBe(PIXEL_SOUL)
    expect(readFileSync(pathJoin(piPixelWs, 'memory', 'notes.md'), 'utf-8')).toBe(PIXEL_MEMORY)
    expect(existsSync(pathJoin(piPixelWs, 'skills'))).toBe(false)
    expect(readFileSync(pathJoin(piPixelWs, '.pi', 'skills', 'crafting', 'SKILL.md'), 'utf-8')).toBe(PIXEL_SKILL)
    expect(existsSync(pathJoin(piPixelWs, '.pi', 'skills', 'packskill'))).toBe(false)

    // Honest can't-carry + credential preflight (D7/D8): channels list as
    // verifiably empty (count 0 — no line); cron.list shells the OpenClaw
    // CLI, dead in this env, so the line emits honestly WITHOUT a count;
    // sessions + provider-config lines are true of every switch; Pi's
    // credential presence comes from the seeded auth.json.
    expect(result.cantCarry!.map((l) => l.concern)).toEqual(['cron', 'sessions', 'provider-config'])
    expect(result.cantCarry!.find((l) => l.concern === 'cron')!.count).toBeUndefined()
    expect(result.credentials!.llmProviders).toEqual(['openai-codex'])

    const pixelCarry = result.workspaces!.carried.find((c) => c.agentId === 'pixel')!
    expect(pixelCarry.files).toBe(2)
    expect(pixelCarry.bytes).toBeGreaterThan(0)
    expect(result.workspaces!.skills).toEqual([{ agentId: 'pixel', carried: 1, skippedPackageManaged: 1 }])
    expect(result.workspaces!.skippedExisting).toEqual([])
    expect(result.workspaces!.failed).toEqual([])
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

    // Pixel exists on OpenClaw — its workspace is NEVER written, only
    // reported skipped (the Pi copy stays behind on Pi).
    expect(result.workspaces!.carried).toEqual([])
    expect(result.workspaces!.skippedExisting).toEqual(['pixel'])
    expect(readFileSync(pathJoin(testDir, 'openclaw', 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')).toBe(PIXEL_SOUL)
  })
})

describe('switchRuntime — copyWorkspaces: false skips the content carry', () => {
  it('carries the roster but writes no workspace content', async () => {
    expect(getSettings().runtime.adapter).toBe('openclaw')
    // A fresh agent with content that would otherwise carry.
    const config = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    config.agents.list.push({ id: 'nova', identity: { name: 'Nova' } })
    writeFileSync(openclawConfigPath, JSON.stringify(config, null, 2))
    resetOpenClawConfigCache()
    const novaWs = pathJoin(testDir, 'openclaw', 'workspaces', 'nova')
    mkdirSync(novaWs, { recursive: true })
    writeFileSync(pathJoin(novaWs, 'SOUL.md'), '# Nova soul')

    const result = await switchRuntime('pi', { copyWorkspaces: false })
    expect(result.ok).toBe(true)
    expect(result.roster!.carried.map((c) => c.agentId)).toEqual(['nova'])
    expect(result.workspaces).toBeNull()
    expect(existsSync(pathJoin(testDir, 'pi', 'agent', 'agents', 'nova', 'workspace', 'SOUL.md'))).toBe(false)

    // Restore state for the failure-path test below.
    const back = await switchRuntime('openclaw')
    expect(back.ok).toBe(true)
  })
})

describe('switchRuntime — failure restores the original adapter', () => {
  it('a mid-step failure restores settings + services to the source runtime, RE-PROVISIONED', async () => {
    expect(getSettings().runtime.adapter).toBe('openclaw')
    scanShouldThrow = true
    try {
      const result = await switchRuntime('pi')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('forced scan failure')
      expect(result.restored).toBe(true)
      expect(getSettings().runtime.adapter).toBe('openclaw')

      // The switch deprovisioned OpenClaw's bakin-* MCP entries before the
      // fallible phases — restore must put them BACK, or every agent
      // silently loses its Bakin tools until the next server boot.
      const ocConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
      expect(ocConfig.mcp.servers['bakin-main']).toBeDefined()

      // Plugins are still bound to the pre-switch (shut-down) adapter
      // instance — even a restored failure needs a restart.
      expect(result.restartRequired).toBe(true)
    } finally {
      scanShouldThrow = false
    }
  })
})
