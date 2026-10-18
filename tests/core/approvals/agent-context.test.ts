/**
 * agentContextForPath (#898 D-H5 fallback): a cwd inside an agent's run
 * dir or its workspace is that agent's context; anything else is none.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-agent-context-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const workspaces: Record<string, string> = {}
let withWorkspaces = true
let servicesUp = true
let listFails = false
let lookupFails = false
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => (servicesUp ? {
    runtime: {
      agents: {
        ...(withWorkspaces ? {
          workspaces: async () => {
            if (listFails) throw new Error('roster unavailable')
            if (lookupFails) throw new Error('config unreadable')
            return Object.entries(workspaces).map(([agentId, path]) => ({ agentId, path }))
          },
        } : {}),
      },
    },
  } : undefined),
}))

import { AgentContextUnavailableError, agentContextForPath } from '../../../src/core/approvals/agent-context'

const home = join(testDir, 'home')
beforeEach(() => {
  withWorkspaces = true
  servicesUp = true
  listFails = false
  lookupFails = false
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'run-workspaces', 'researcher', 'run-1', 'repo'), { recursive: true })
  workspaces.writer = join(testDir, 'openclaw', 'workspace-writer')
  mkdirSync(join(workspaces.writer, 'notes'), { recursive: true })
  mkdirSync(home, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('agentContextForPath', () => {
  it('a run dir (any depth) belongs to its agent', async () => {
    expect(await agentContextForPath(join(testDir, 'run-workspaces', 'researcher', 'run-1', 'repo'))).toBe('researcher')
  })

  it('an agent workspace (any depth, through a symlink too) belongs to its agent', async () => {
    expect(await agentContextForPath(join(workspaces.writer, 'notes'))).toBe('writer')
    const link = join(home, 'shortcut')
    symlinkSync(workspaces.writer, link)
    expect(await agentContextForPath(link)).toBe('writer')
  })

  it('anything else — including a sibling with a shared prefix and the run-workspaces root itself — is none', async () => {
    mkdirSync(`${workspaces.writer}-old`, { recursive: true })
    expect(await agentContextForPath(`${workspaces.writer}-old`)).toBeNull()
    expect(await agentContextForPath(join(testDir, 'run-workspaces'))).toBeNull()
    expect(await agentContextForPath(home)).toBeNull()
  })

  it('a runtime without file-backed workspaces answers none (run dirs still count)', async () => {
    withWorkspaces = false
    expect(await agentContextForPath(join(workspaces.writer, 'notes'))).toBeNull()
    expect(await agentContextForPath(join(testDir, 'run-workspaces', 'researcher'))).toBe('researcher')
  })

  it('a lookup that cannot answer throws — never "no agent" (review r2)', async () => {
    for (const setup of [() => { servicesUp = false }, () => { listFails = true }, () => { lookupFails = true }]) {
      servicesUp = true
      listFails = false
      lookupFails = false
      setup()
      await expect(agentContextForPath(home)).rejects.toBeInstanceOf(AgentContextUnavailableError)
    }
  })
})
