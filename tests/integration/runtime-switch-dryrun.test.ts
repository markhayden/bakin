/**
 * Dry-run zero-write TEETH (runtime-switch-carry spec, D3): a dry-run over
 * REAL adapters must produce the full preview report while leaving every
 * byte on disk untouched — settings unchanged, no backup file, source and
 * target homes tree-identical (content-hashed), no audit trace. This is the
 * acceptance test for the read-only secondary construction path.
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-runtime-switch-dry-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

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

import { switchRuntime } from '../../src/core/runtime-switch'
import { getSettings, resetSettingsCache, updateSettings } from '../../src/core/settings'
import { closeDb } from '../../packages/core/src/storage/db'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

/** Deterministic tree snapshot: sorted relative paths + content hashes. */
function snapshotTree(root: string): string {
  if (!existsSync(root)) return '<absent>'
  const lines: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(pathJoin(dir, entry.name), relPath)
      else lines.push(`${relPath} ${createHash('sha256').update(readFileSync(pathJoin(dir, entry.name))).digest('hex')}`)
    }
  }
  walk(root, '')
  return lines.sort().join('\n')
}

beforeAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(pathJoin(testDir, 'openclaw'), { recursive: true })
  writeFileSync(pathJoin(testDir, 'openclaw', 'openclaw.json'), JSON.stringify({
    agents: {
      list: [
        { id: 'main', identity: { name: 'Main' } },
        { id: 'pixel', identity: { name: 'Pixel' }, model: { primary: 'openai/gpt-test-vision' } },
        { id: 'rolo', identity: { name: 'Rolo' }, model: { primary: 'anthropic/claude-nope' } },
      ],
    },
  }, null, 2))
  const pixelWs = pathJoin(testDir, 'openclaw', 'workspaces', 'pixel')
  mkdirSync(pathJoin(pixelWs, 'memory'), { recursive: true })
  writeFileSync(pathJoin(pixelWs, 'SOUL.md'), '# Pixel soul')
  writeFileSync(pathJoin(pixelWs, 'memory', 'notes.md'), 'remembered')
  mkdirSync(pathJoin(pixelWs, 'skills', 'crafting'), { recursive: true })
  writeFileSync(pathJoin(pixelWs, 'skills', 'crafting', 'SKILL.md'), '# crafting')
  resetOpenClawConfigCache()

  // Pi home: credentials + catalog seeded, NO registry — the dry run must
  // not create one (write-free initialize, no provisioning).
  const piAgentDir = pathJoin(testDir, 'pi', 'agent')
  mkdirSync(piAgentDir, { recursive: true })
  writeFileSync(pathJoin(piAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'k' } }))
  writeFileSync(pathJoin(piAgentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-codex': {
        name: 'Codex', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions',
        models: [
          { id: 'gpt-test-vision', name: 'V', input: ['text', 'image'], reasoning: true, contextWindow: 2000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  }))
  resetPiHome()
  resetModelRegistry()
  updateSettings({ runtime: { adapter: 'openclaw' }, search: { settings: { enabled: false } } })
  resetSettingsCache()
})

// Pre-warm the SOURCE adapter's lazy initialization: OpenClaw creates its
// gateway device identity (.openclaw/identity/device.json) on the first RPC
// of any kind — bakin status does it too. That's read-path lazy init, not a
// dry-run write; warming it once lets the assertions below hold the dry run
// to a true zero-writes standard.
beforeAll(async () => {
  await switchRuntime('pi', { dryRun: true })
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('switchRuntime — dry run is a full preview with ZERO writes', () => {
  it('reports roster + workspace + can\'t-carry + credentials while every home stays byte-identical', async () => {
    const settingsBefore = readFileSync(pathJoin(testDir, 'settings.json'), 'utf-8')
    const openclawBefore = snapshotTree(pathJoin(testDir, 'openclaw'))
    const piBefore = snapshotTree(pathJoin(testDir, 'pi'))

    const phases: string[] = []
    const result = await switchRuntime('pi', {
      dryRun: true,
      onProgress: (e) => { if (e.status !== 'start') phases.push(`${e.phase}:${e.status}`) },
    })

    // The full preview report.
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.restartRequired).toBe(false)
    expect(result.backupPath).toBeNull()
    // Pi has NO seeded main (write-free init) — all three would carry.
    expect(result.roster!.existing).toEqual([])
    expect(result.roster!.carried.map((c) => c.agentId).sort()).toEqual(['main', 'pixel', 'rolo'])
    expect(result.roster!.carried.find((c) => c.agentId === 'pixel')!.model).toBe('openai-codex/gpt-test-vision')
    expect(result.roster!.unmappedModels).toEqual([{ agentId: 'rolo', sourceModel: 'anthropic/claude-nope', field: 'model' }])
    const pixelWs = result.workspaces!.carried.find((c) => c.agentId === 'pixel')!
    expect(pixelWs.files).toBe(2) // SOUL.md + memory/notes.md; the skill rides the skills report
    expect(result.workspaces!.skills).toEqual([{ agentId: 'pixel', carried: 1, skippedPackageManaged: 0 }])
    expect(result.cantCarry!.map((l) => l.concern)).toContain('sessions')
    expect(result.credentials!.llmProviders).toEqual(['openai-codex'])
    expect(result.capabilities!.toolCalling.access.style).toBe('in-process')
    expect(phases).toContain('reconcile-roster:ok')
    expect(phases).toContain('carry-workspaces:ok')

    // ZERO writes anywhere.
    expect(getSettings().runtime.adapter).toBe('openclaw')
    expect(readFileSync(pathJoin(testDir, 'settings.json'), 'utf-8')).toBe(settingsBefore)
    expect(existsSync(pathJoin(testDir, '.backups'))).toBe(false)
    expect(existsSync(pathJoin(testDir, 'audit.jsonl'))).toBe(false)
    expect(snapshotTree(pathJoin(testDir, 'openclaw'))).toBe(openclawBefore)
    expect(snapshotTree(pathJoin(testDir, 'pi'))).toBe(piBefore)
    expect(existsSync(pathJoin(testDir, 'pi', 'agent', 'bakin-agents.json'))).toBe(false)
  })

  it('a dry run against the already-active adapter is rejected like a real switch', async () => {
    const result = await switchRuntime('openclaw', { dryRun: true })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('already active')
  })
})
