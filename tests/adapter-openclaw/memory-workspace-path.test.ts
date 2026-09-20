/**
 * workspacePath host/container divergence (dockerized dev rig).
 *
 * In the rig, the CONTAINER onboards OpenClaw and writes container-absolute
 * workspace paths (`/home/node/.openclaw/workspace`) into openclaw.json, but
 * HOST-side Bakin reads that config. Trusting the absolute config path makes
 * existsSync fail on the host → durable/daily_note/dream tiers index nothing.
 * The adapter must resolve the workspace against THIS process's home instead.
 *
 * Uses a REAL temp openclaw.json (the config module is live — #873 moved the
 * shape lookup into shared configuredWorkspaceFor, so mocking the module
 * would test a copy of the logic instead of the logic).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-test-openclaw-ws-${Date.now()}`)
const CONTAINER_WS = '/home/node/.openclaw/workspace' // absolute, does not exist on host

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../packages/adapter-openclaw/src/main-agent', () => ({
  tryGetMainAgentId: () => 'main',
  getMainAgentId: () => 'main',
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ root: testHome }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ root: testHome }),
}))

import { listOpenClawMemoryEntries, OPENCLAW_MEMORY_TIERS } from '../../packages/adapter-openclaw/src/memory'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

const DURABLE = OPENCLAW_MEMORY_TIERS.durable

function writeConfig(config: unknown): void {
  writeFileSync(join(testHome, 'openclaw.json'), JSON.stringify(config))
  resetOpenClawConfigCache()
}

beforeEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  mkdirSync(join(testHome, 'workspace'), { recursive: true })
  writeFileSync(join(testHome, 'workspace', 'SOUL.md'), '# soul')
  writeFileSync(join(testHome, 'workspace', 'AGENTS.md'), 'use the beacon mcp')
  writeConfig({ agents: { defaults: { workspace: CONTAINER_WS } } })
})
afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('workspacePath — host/container home divergence', () => {
  it('resolves main durable files under the resolved home, not a foreign container path', () => {
    const entries = listOpenClawMemoryEntries(DURABLE, { agentId: 'main' })
    const ids = entries.map((e) => e.id)
    expect(ids).toContain('SOUL.md')
    expect(ids).toContain('AGENTS.md')
    const soul = entries.find((e) => e.id === 'SOUL.md')!
    expect(String(soul.path).startsWith(testHome)).toBe(true)
    expect(String(soul.path)).not.toContain('/home/node/.openclaw')
  })

  it('still honors a configured workspace that actually exists (normal install)', () => {
    const custom = join(testHome, 'custom-ws')
    mkdirSync(custom, { recursive: true })
    writeFileSync(join(custom, 'SOUL.md'), '# soul')
    writeConfig({ agents: { defaults: { workspace: custom } } })
    const entries = listOpenClawMemoryEntries(DURABLE, { agentId: 'main' })
    expect(entries.find((e) => e.id === 'SOUL.md')?.path).toBe(join(custom, 'SOUL.md'))
  })

  it('honors a per-entry workspace under the 2026.9.5 keyed registry (#873)', () => {
    const custom = join(testHome, 'entries-ws')
    mkdirSync(custom, { recursive: true })
    writeFileSync(join(custom, 'SOUL.md'), '# soul')
    writeConfig({
      agents: {
        ownership: 'explicit',
        defaults: { workspace: CONTAINER_WS },
        entries: { main: { workspace: custom } },
      },
    })
    const entries = listOpenClawMemoryEntries(DURABLE, { agentId: 'main' })
    expect(entries.find((e) => e.id === 'SOUL.md')?.path).toBe(join(custom, 'SOUL.md'))
  })
})
