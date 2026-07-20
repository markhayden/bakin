/**
 * Core git-worktree machinery (same-agent-concurrency D6) against REAL git
 * repos in a temp dir: branch-per-run add, --force removal with untracked
 * artifacts present (plain remove refuses — the audited blocker), branch
 * survival, repo-gone fallback, namespace, advisory count.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-git-wt-test-'))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { addRunWorktree, countRunBranches, removeRunWorktree, runBranchName, isGitRepo } from '../../src/core/git-worktree'

const repo = join(testDir, 'repo')

function git(args: string[], cwd = repo): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', repo])
  git(['config', 'user.email', 'test@bakin.local'])
  git(['config', 'user.name', 'Bakin Test'])
  writeFileSync(join(repo, 'README.md'), 'hello')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init'])
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('git-worktree', () => {
  it('runBranchName maps threadIds into the reserved bakin/run/ namespace', () => {
    expect(runBranchName('task:abc:d2')).toBe('bakin/run/task-abc-d2')
  })

  it('materializes a worktree on a fresh branch; removal is --force-safe with untracked artifacts; branch survives', async () => {
    const runDir = join(testDir, 'run-1')
    mkdirSync(runDir, { recursive: true })
    const { checkoutDir, branch } = await addRunWorktree(repo, runDir, 'task:wt1:d1')

    expect(existsSync(join(checkoutDir, 'README.md'))).toBe(true)
    expect(git(['branch', '--show-current'], checkoutDir)).toBe('bakin/run/task-wt1-d1')

    // Agent work: a commit on the run branch + untracked build artifacts
    // (which make a PLAIN `worktree remove` fail — the audited blocker).
    writeFileSync(join(checkoutDir, 'feature.ts'), 'export const x = 1')
    git(['add', 'feature.ts'], checkoutDir)
    git(['commit', '-q', '-m', 'work'], checkoutDir)
    writeFileSync(join(checkoutDir, 'untracked-artifact.log'), 'build noise')

    expect(await removeRunWorktree(repo, checkoutDir)).toBe(true)
    expect(existsSync(checkoutDir)).toBe(false)
    // The branch IS the deliverable — it survives removal, commit intact.
    expect(git(['rev-parse', '--verify', branch])).toBeTruthy()
    expect(git(['log', '-1', '--format=%s', branch])).toBe('work')
  })

  it('concurrent add + remove on ONE repo serialize through the global mutex without corrupting it', async () => {
    const runA = join(testDir, 'run-a'); mkdirSync(runA, { recursive: true })
    const runB = join(testDir, 'run-b'); mkdirSync(runB, { recursive: true })
    const a = await addRunWorktree(repo, runA, 'task:mux:d1')
    // Interleave: remove A while adding B — the mutex orders them.
    const [removed, b] = await Promise.all([
      removeRunWorktree(repo, a.checkoutDir),
      addRunWorktree(repo, runB, 'task:mux:d2'),
    ])
    expect(removed).toBe(true)
    expect(existsSync(join(b.checkoutDir, 'README.md'))).toBe(true)
    expect(git(['worktree', 'list'])).toContain('run-b')
    expect(await removeRunWorktree(repo, b.checkoutDir)).toBe(true)
  })

  it('bound repo deleted/moved: falls back to plain recursive delete of the checkout', async () => {
    const ghostRepo = join(testDir, 'ghost-repo')
    const orphanCheckout = join(testDir, 'orphan-checkout')
    mkdirSync(orphanCheckout, { recursive: true })
    writeFileSync(join(orphanCheckout, 'stale.txt'), 'x')
    expect(isGitRepo(ghostRepo)).toBe(false)
    expect(await removeRunWorktree(ghostRepo, orphanCheckout)).toBe(true)
    expect(existsSync(orphanCheckout)).toBe(false)
  })

  it('countRunBranches counts only the bakin/run/* namespace (doctor advisory)', async () => {
    git(['branch', 'bakin/some-task-agent'])
    expect(await countRunBranches(repo)).toBeGreaterThanOrEqual(2) // wt1 + mux branches
    const before = await countRunBranches(repo)
    git(['branch', 'unrelated-branch'])
    expect(await countRunBranches(repo)).toBe(before)
  })
})
