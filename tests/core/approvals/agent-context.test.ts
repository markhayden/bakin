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
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => ({
    runtime: {
      agents: {
        list: async () => Object.keys(workspaces).map((id) => ({ id, name: id })),
        ...(withWorkspaces ? { workspacePath: async (id: string) => workspaces[id] ?? null } : {}),
      },
    },
  }),
}))

import { agentContextForPath } from '../../../src/core/approvals/agent-context'

const home = join(testDir, 'home')
beforeEach(() => {
  withWorkspaces = true
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

  it('a runtime without workspacePath answers none for workspaces (run dirs still count)', async () => {
    withWorkspaces = false
    expect(await agentContextForPath(join(workspaces.writer, 'notes'))).toBeNull()
    expect(await agentContextForPath(join(testDir, 'run-workspaces', 'researcher'))).toBe('researcher')
  })
})
