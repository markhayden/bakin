/**
 * Repo binding resolution + validation (same-agent-concurrency D6): task
 * override wins, project hook feature-detected, allowlist NEVER bypassable
 * (empty = nothing bindable), non-repos refused.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-repo-bind-test-'))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

const hookHandlers = new Map<string, (data: unknown) => Promise<unknown>>()
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    has: (name: string) => hookHandlers.has(name),
    invoke: async (name: string, data: unknown) => hookHandlers.get(name)?.(data),
    register: mock(),
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../packages/core/src/hooks/hook-registry-singleton', hookRegistryMock)

import { resolveRepoBinding, BoundRepoError } from '../../src/core/repo-binding'

const allowedRoot = join(testDir, 'code')
const repo = join(allowedRoot, 'my-repo')
const outsideRepo = join(testDir, 'outside', 'other-repo')

function setAllowedRoots(roots: string[]): void {
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  writeFileSync(join(testDir, 'plugin-settings', 'git.json'), JSON.stringify({ allowedRepoRoots: roots }))
}

beforeAll(() => {
  for (const r of [repo, outsideRepo]) {
    mkdirSync(r, { recursive: true })
    execFileSync('git', ['init', '-q', r])
  }
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('resolveRepoBinding', () => {
  it('unbound task resolves null (no repoPath, no project hook)', async () => {
    hookHandlers.clear()
    setAllowedRoots([allowedRoot])
    expect(await resolveRepoBinding({ id: 't1' })).toBeNull()
    expect(await resolveRepoBinding({ id: 't2', projectId: 'p1' })).toBeNull() // hook absent
  })

  it('task-level repoPath binds when valid', async () => {
    setAllowedRoots([allowedRoot])
    const binding = await resolveRepoBinding({ id: 't3', repoPath: repo })
    expect(binding?.repoPath).toBe(repo)
    expect(binding?.source).toBe('task')
  })

  it('project binding rides the feature-detected projects.getRepo hook', async () => {
    setAllowedRoots([allowedRoot])
    hookHandlers.set('projects.getRepo', async () => repo)
    const binding = await resolveRepoBinding({ id: 't4', projectId: 'p1' })
    expect(binding?.repoPath).toBe(repo)
    expect(binding?.source).toBe('project')
    hookHandlers.clear()
  })

  it('EMPTY allowlist refuses every binding — a task override cannot bypass it', async () => {
    setAllowedRoots([])
    await expect(resolveRepoBinding({ id: 't5', repoPath: repo })).rejects.toThrow(BoundRepoError)
    await expect(resolveRepoBinding({ id: 't5', repoPath: repo })).rejects.toThrow(/allowedRepoRoots is not configured/)
  })

  it('a repo OUTSIDE the allowed roots is refused', async () => {
    setAllowedRoots([allowedRoot])
    await expect(resolveRepoBinding({ id: 't6', repoPath: outsideRepo })).rejects.toThrow(/outside the configured allowedRepoRoots/)
  })

  it('a non-repo path inside the roots is refused', async () => {
    setAllowedRoots([allowedRoot])
    const notARepo = join(allowedRoot, 'plain-dir')
    mkdirSync(notARepo, { recursive: true })
    await expect(resolveRepoBinding({ id: 't7', repoPath: notARepo })).rejects.toThrow(/not a git repository/)
  })
})
