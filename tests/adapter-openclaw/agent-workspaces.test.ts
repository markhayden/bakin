/**
 * OpenClaw agents.workspaces() (#898 review r3): every agent's workspace,
 * read STRICTLY — an unreadable openclaw.json throws instead of answering an
 * empty roster (which read as "no agent" and let `--as human` through).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-oc-workspaces-'))
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
afterAll(() => rmSync(testHome, { recursive: true, force: true }))

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

  it('an unreadable config throws — never an empty list', async () => {
    writeFileSync(configPath, '{ not json')
    resetOpenClawConfigCache()
    await expect(runtime.agents.workspaces!()).rejects.toThrow()
  })
})
