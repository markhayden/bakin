/**
 * OpenClaw agents.workspaces() (#898 review r3): every agent's workspace,
 * read STRICTLY — an unreadable openclaw.json throws instead of answering an
 * empty roster (which read as "no agent" and let `--as human` through).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const root = mkdtempSync(join(tmpdir(), 'bakin-test-oc-workspaces-'))
const testHome = join(root, 'openclaw')
mkdirSync(testHome, { recursive: true })
mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
const contentDirMock = () => ({
  getContentDir: () => join(testHome, 'bakin'),
  getBakinPaths: () => ({ home: join(testHome, 'bakin'), db: join(testHome, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createOpenClawRuntimeAdapter } from '../../packages/adapter-openclaw/src/index'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

const configPath = join(testHome, 'openclaw.json')
const runtime = createOpenClawRuntimeAdapter()

beforeEach(() => resetOpenClawConfigCache())
afterAll(() => {
  chmodSync(testHome, 0o755)
  rmSync(root, { recursive: true, force: true })
})

describe('OpenClaw agents.workspaces', () => {
  it('lists every agent with its workspace', async () => {
    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: { workspace: join(testHome, 'workspace') },
        entries: { main: {}, writer: { workspace: join(testHome, 'workspace-writer') } },
      },
    }))
    resetOpenClawConfigCache()
    const workspaces = await runtime.agents.workspaces!()
    expect(workspaces).toEqual(expect.arrayContaining([
      { agentId: 'writer', path: join(testHome, 'workspace-writer') },
    ]))
    expect(workspaces.map((w) => w.agentId)).toContain('main')
  })

  it('registryLocation names openclaw.json and the entry key: the legacy list by position, the keyed map by id (Health row 106)', async () => {
    writeFileSync(configPath, JSON.stringify({ agents: { list: [{ id: 'main' }, { name: 'nameless' }] } }))
    resetOpenClawConfigCache()
    const legacy = await runtime.agents.registryLocation!()
    expect(legacy).toEqual({ path: configPath, entryKey: expect.any(Function) })
    expect(legacy!.entryKey(1)).toBe('agents.list[1]')
    writeFileSync(configPath, JSON.stringify({ agents: { entries: { main: {} } } }))
    resetOpenClawConfigCache()
    const keyed = await runtime.agents.registryLocation!()
    expect(keyed!.path).toBe(configPath)
    expect(keyed!.entryKey(0)).toBe('agents.entries[<id>] (entry 1)')
  })

  it('an unreadable config throws — never an empty list', async () => {
    writeFileSync(configPath, '{ not json')
    resetOpenClawConfigCache()
    await expect(runtime.agents.workspaces!()).rejects.toThrow()
  })

  it('a config that exists but cannot be read (EACCES) throws — only a missing file is absent (review r4)', async () => {
    writeFileSync(configPath, JSON.stringify({ agents: { entries: { main: {} } } }))
    chmodSync(testHome, 0o000)
    resetOpenClawConfigCache()
    try {
      await expect(runtime.agents.workspaces!()).rejects.toThrow()
    } finally {
      chmodSync(testHome, 0o755)
    }
  })

  it('a missing config is not a failure: it answers the default roster', async () => {
    rmSync(configPath, { force: true })
    resetOpenClawConfigCache()
    const workspaces = await runtime.agents.workspaces!()
    expect(workspaces.map((w) => w.agentId)).toEqual(['main'])
  })
})
