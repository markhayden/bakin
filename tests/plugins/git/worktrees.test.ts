import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createTestContext, findTool, callTool } from '../test-helpers'
import { gitAvailable, runGit } from '../../fixtures/plugins/hermetic-git'
import gitPlugin from '../../../plugins/git'

const rootDir = join(tmpdir(), `bakin-test-git-plugin-${Date.now()}-${randomUUID()}`)
const bakinHome = join(rootDir, 'bakin-home')
const reposRoot = join(rootDir, 'repos')
const worktreeRoot = join(bakinHome, 'git-worktrees')

const maybeIt = gitAvailable() ? it : it.skip

beforeEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
  mkdirSync(reposRoot, { recursive: true })
  mkdirSync(bakinHome, { recursive: true })
  process.env.BAKIN_HOME = bakinHome
})

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

function seedRepo(name = 'app'): string {
  const repoPath = join(reposRoot, name)
  mkdirSync(repoPath, { recursive: true })
  runGit(['init', '-b', 'main'], repoPath)
  runGit(['config', 'user.email', 'test@bakin.local'], repoPath)
  runGit(['config', 'user.name', 'Bakin Test'], repoPath)
  writeFileSync(join(repoPath, 'README.md'), '# Test repo\n', 'utf-8')
  runGit(['add', '-A'], repoPath)
  runGit(['commit', '-m', 'initial'], repoPath, {
    GIT_AUTHOR_NAME: 'Bakin Test',
    GIT_AUTHOR_EMAIL: 'test@bakin.local',
    GIT_COMMITTER_NAME: 'Bakin Test',
    GIT_COMMITTER_EMAIL: 'test@bakin.local',
  })
  return repoPath
}

async function activateGitPlugin() {
  const activated = createTestContext('git', bakinHome)
  activated.ctx.getSettings = (<T = Record<string, unknown>>() => ({
    allowedRepoRoots: [{ path: reposRoot }],
    worktreeRoot,
  }) as T) as typeof activated.ctx.getSettings
  await gitPlugin.activate(activated.ctx)
  return activated
}

describe('git plugin worktree tools', () => {
  maybeIt('creates and reuses an isolated worktree for a task', async () => {
    const repoPath = seedRepo()
    const activated = await activateGitPlugin()
    const prepare = findTool(activated.execTools, 'bakin_exec_git_prepare_worktree')
    expect(prepare).toBeDefined()

    const first = await callTool(prepare!, {
      repoPath,
      taskId: '36',
      branch: 'bakin/36-test-agent',
      baseRef: 'HEAD',
    }, 'patch')

    expect(first.ok).toBe(true)
    expect(first.repoPath).toBe(realpathSync(repoPath))
    expect(first.branch).toBe('bakin/36-test-agent')
    expect(typeof first.worktreePath).toBe('string')
    expect(String(first.worktreePath).startsWith(worktreeRoot)).toBe(true)
    expect(existsSync(String(first.worktreePath))).toBe(true)
    expect(runGit(['rev-parse', '--show-toplevel'], String(first.worktreePath))).toBe(realpathSync(String(first.worktreePath)))

    const second = await callTool(prepare!, {
      repoPath,
      taskId: '36',
      branch: 'bakin/36-test-agent',
    }, 'patch')

    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.worktreePath).toBe(first.worktreePath)
  })

  maybeIt('reports dirty status and refuses release without force', async () => {
    const repoPath = seedRepo()
    const activated = await activateGitPlugin()
    const prepare = findTool(activated.execTools, 'bakin_exec_git_prepare_worktree')!
    const status = findTool(activated.execTools, 'bakin_exec_git_status')!
    const release = findTool(activated.execTools, 'bakin_exec_git_release_worktree')!

    const prepared = await callTool(prepare, {
      repoPath,
      taskId: '36',
      branch: 'bakin/36-dirty',
    }, 'patch')
    expect(prepared.ok).toBe(true)

    const worktreePath = String(prepared.worktreePath)
    writeFileSync(join(worktreePath, 'scratch.txt'), 'dirty\n', 'utf-8')

    const current = await callTool(status, { repoPath, taskId: '36' }, 'patch')
    expect(current.ok).toBe(true)
    expect(Array.isArray(current.worktrees)).toBe(true)
    expect((current.worktrees as Array<Record<string, unknown>>)[0].dirty).toBe(true)
    expect(String((current.worktrees as Array<Record<string, unknown>>)[0].status)).toContain('scratch.txt')

    const refused = await callTool(release, { worktreePath }, 'patch')
    expect(refused.ok).toBe(false)
    expect(String(refused.error)).toContain('dirty')
    expect(existsSync(worktreePath)).toBe(true)

    const forced = await callTool(release, { worktreePath, force: true }, 'patch')
    expect(forced.ok).toBe(true)
    expect(existsSync(worktreePath)).toBe(false)
  })

  maybeIt('rejects repositories outside configured allowed roots', async () => {
    const outsideRoot = join(rootDir, 'outside')
    mkdirSync(outsideRoot, { recursive: true })
    const repoPath = seedRepo('inside')
    const outsideRepo = join(outsideRoot, 'repo')
    mkdirSync(outsideRepo, { recursive: true })
    runGit(['init', '-b', 'main'], outsideRepo)

    const activated = await activateGitPlugin()
    const prepare = findTool(activated.execTools, 'bakin_exec_git_prepare_worktree')!

    const accepted = await callTool(prepare, { repoPath, taskId: '36' }, 'patch')
    expect(accepted.ok).toBe(true)

    const rejected = await callTool(prepare, { repoPath: outsideRepo, taskId: '37' }, 'patch')
    expect(rejected.ok).toBe(false)
    expect(String(rejected.error)).toContain('allowed repo roots')
  })
})
