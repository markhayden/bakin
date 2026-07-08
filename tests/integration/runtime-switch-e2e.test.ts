/**
 * Runtime switch e2e round-trip (P3.4 — checkpoint γ): OpenClaw ↔ Pi over
 * REAL adapters, the REAL drift scanner, and the REAL projector in an
 * isolated env. The load-bearing assertion: each agent's composed AGENTS.md
 * tool-access section genuinely FLIPS with the runtime — native-MCP wording
 * on OpenClaw, direct-call wording on Pi — re-projected drift-gated on every
 * leg, with tool-access re-provisioned and the capability report correct
 * each way. Reversibility is pinned by the P3.1 restore test.
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-switch-e2e-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.PI_HOME = pathJoin(testDir, 'pi')

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

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
import { createAppServices } from '../../src/core/app-services'
import { closeDb } from '../../packages/core/src/storage/db'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

const openclawConfigPath = pathJoin(testDir, 'openclaw', 'openclaw.json')

function seedHomes(): void {
  // OpenClaw: main agent with an explicit workspace under its home.
  mkdirSync(pathJoin(testDir, 'openclaw', 'workspace'), { recursive: true })
  writeFileSync(openclawConfigPath, JSON.stringify({
    agents: {
      defaults: { workspace: pathJoin(testDir, 'openclaw', 'workspace') },
      list: [{ id: 'main', identity: { name: 'Main' } }],
    },
  }, null, 2))
  resetOpenClawConfigCache()

  // Pi: auth + models fixtures so the adapter's registry resolves.
  const agentDir = pathJoin(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(pathJoin(agentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'k' } }))
  writeFileSync(pathJoin(agentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-codex': {
        name: 'Codex', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions',
        models: [
          { id: 'gpt-test-text', name: 'Text', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        ],
      },
    },
  }))
}

async function readAgentsMd(agentId: string): Promise<string> {
  const { getAppServices } = await import('../../src/core/app-services')
  const file = await getAppServices().runtime.agents.readWorkspaceFile(agentId, 'AGENTS.md')
  return file?.content ?? ''
}

beforeAll(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  seedHomes()
  resetPiHome()
  resetModelRegistry()
  // Search disabled: no OS-service inspection from a test process.
  updateSettings({ runtime: { adapter: 'openclaw' }, search: { settings: { enabled: false } } })
  resetSettingsCache()
  await createAppServices()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('runtime switch e2e round-trip (γ)', () => {
  it('OpenClaw → Pi: re-projects AGENTS.md to the in-process tool-access section', async () => {
    const result = await switchRuntime('pi')
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)

    // The REAL scanner found drift (the tool-access section for the new
    // runtime) and the REAL projector wrote the composed block.
    expect(result.sync!.drifted).toBe(true)
    expect(result.sync!.syncedAgents).toBeGreaterThan(0)

    const agentsMd = await readAgentsMd('main')
    expect(agentsMd).toContain('<!-- bakin-section: tool-access -->')
    expect(agentsMd).toContain('call them like any other tool')
    expect(agentsMd).not.toContain('native MCP tools')
    expect(agentsMd).not.toContain('bakin-main')

    // Capability report correct for Pi.
    expect(result.capabilities!.toolCalling.access.style).toBe('in-process')
    expect(result.toolAccess!.ok).toBe(true)
    expect(getSettings().runtime.adapter).toBe('pi')
  })

  it('Pi → OpenClaw: the section flips to native MCP and provisioning returns', async () => {
    const result = await switchRuntime('openclaw')
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)

    expect(result.sync!.drifted).toBe(true)

    const agentsMd = await readAgentsMd('main')
    expect(agentsMd).toContain('<!-- bakin-section: tool-access -->')
    expect(agentsMd).toContain('native MCP tools under the `bakin-main` server')
    expect(agentsMd).not.toContain('call them like any other tool')

    // Tool-access provisioning rebuilt the per-agent MCP entries.
    const ocConfig = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
    expect(ocConfig.mcp.servers['bakin-main'].url).toContain('/mcp?agent=main')
    expect(result.capabilities!.toolCalling.access.style).toBe('mcp')
    expect(result.toolAccess!.ok).toBe(true)
    expect(getSettings().runtime.adapter).toBe('openclaw')
  })

  it('a repeat leg with no runtime change would be drift-gated (round-trip is stable)', async () => {
    // Going back to Pi AGAIN: the Pi workspace still carries the in-process
    // section from the first leg, so this second Pi projection is a no-op —
    // proving the drift gate (projections rewrite only when the section
    // genuinely changed, not on every switch).
    const result = await switchRuntime('pi')
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.sync!.drifted).toBe(false)
    expect(result.sync!.syncedAgents).toBe(0)

    const agentsMd = await readAgentsMd('main')
    expect(agentsMd).toContain('call them like any other tool')
  })
})
