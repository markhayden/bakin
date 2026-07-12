/**
 * Dry-run zero-write TEETH, reverse leg (review I3): Pi → OpenClaw, with a
 * FRESH unauthenticated OpenClaw target and NO pre-warm — exactly the box
 * state where you'd preview before switching.
 *
 * Scope of the guarantee (empirically pinned): BAKIN writes nothing — no
 * config, no roster, no workspaces, no settings flip, no backup. The
 * OpenClaw CLI itself lazily materializes its INTERNAL state on any read
 * (`.openclaw/state/openclaw.sqlite`, `.openclaw/identity/*`) — probing
 * models/credentials shells the CLI, the same lazy init any `bakin check`
 * triggers. That internal-state subtree is the ONLY tolerated delta; a
 * single byte anywhere else fails this test.
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-runtime-switch-dry-rev-${Date.now()}-${randomUUID()}`)
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
const loggerFactory = () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
})
mock.module('../../src/core/logger', loggerFactory)
mock.module('../../packages/core/src/logger', loggerFactory)
mock.module('@bakin/core/logger', loggerFactory)
mock.module('../../src/core/watcher', () => ({ startWatcher: () => {}, stopWatcher: () => {} }))

import { switchRuntime } from '../../src/core/runtime-switch'
import { getSettings, resetSettingsCache, updateSettings } from '../../src/core/settings'
import { closeDb } from '../../packages/core/src/storage/db'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

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

beforeAll(async () => {
  rmSync(testDir, { recursive: true, force: true })
  // Pi is the ACTIVE runtime: credentials + one agent with workspace content.
  const piAgentDir = pathJoin(testDir, 'pi', 'agent')
  mkdirSync(piAgentDir, { recursive: true })
  writeFileSync(pathJoin(piAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'k' } }))
  writeFileSync(pathJoin(piAgentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-codex': {
        name: 'Codex', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions',
        models: [
          { id: 'gpt-test-vision', name: 'V', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  }))
  resetPiHome()
  resetModelRegistry()
  updateSettings({ runtime: { adapter: 'pi' }, search: { settings: { enabled: false } } })
  resetSettingsCache()
  // Seed Pi's roster the sanctioned way (provisioning), then give pixel-like
  // content to the main agent so the preview has something to count.
  const { createAppServices } = await import('../../src/core/app-services')
  const services = await createAppServices()
  await services.runtime.provisionToolAccess()
  await services.runtime.agents.writeWorkspaceFile('main', { path: 'SOUL.md', content: '# Main soul on pi' })
  await services.runtime.agents.writeWorkspaceFile('main', { path: 'memory/notes.md', content: 'pi memories' })
  // The OpenClaw home does NOT exist — the fresh-target case.
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('switchRuntime — dry run pi → openclaw (fresh, unauthenticated target)', () => {
  it('previews the carry with the target home never materialized', async () => {
    const openclawBefore = snapshotTree(pathJoin(testDir, 'openclaw'))
    const piBefore = snapshotTree(pathJoin(testDir, 'pi'))
    const settingsBefore = readFileSync(pathJoin(testDir, 'settings.json'), 'utf-8')

    const result = await switchRuntime('openclaw', { dryRun: true })

    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    // Fresh OpenClaw: empty roster — main would carry with its content.
    expect(result.roster!.existing).toEqual([])
    expect(result.roster!.carried.map((c) => c.agentId)).toEqual(['main'])
    const mainWs = result.workspaces!.carried.find((c) => c.agentId === 'main')!
    expect(mainWs.files).toBe(2)
    expect(result.cantCarry!.map((l) => l.concern)).toContain('sessions')

    // ZERO Bakin writes: every new path under the target home must be the
    // OpenClaw CLI's own internal lazy state — never config, roster, or
    // workspace content.
    const before = new Set(openclawBefore === '<absent>' ? [] : openclawBefore.split('\n'))
    const after = snapshotTree(pathJoin(testDir, 'openclaw'))
    const newPaths = (after === '<absent>' ? [] : after.split('\n'))
      .filter((line) => !before.has(line))
      .map((line) => line.split(' ')[0])
    for (const path of newPaths) {
      expect(path).toMatch(/^\.openclaw\/(state|identity)\//)
    }
    expect(existsSync(pathJoin(testDir, 'openclaw', 'openclaw.json'))).toBe(false)
    expect(existsSync(pathJoin(testDir, 'openclaw', 'workspaces'))).toBe(false)
    expect(existsSync(pathJoin(testDir, 'openclaw', 'workspace'))).toBe(false)
    expect(snapshotTree(pathJoin(testDir, 'pi'))).toBe(piBefore)
    expect(readFileSync(pathJoin(testDir, 'settings.json'), 'utf-8')).toBe(settingsBefore)
    expect(getSettings().runtime.adapter).toBe('pi')
    expect(existsSync(pathJoin(testDir, '.backups'))).toBe(false)
  })
})
