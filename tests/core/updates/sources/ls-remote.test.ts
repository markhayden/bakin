/** `git ls-remote` → the commit a clone of that ref checks out: exact refs, annotated tags peeled (#1007 review r5 #3). */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-ls-remote-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { lsRemoteSha, pickLsRemoteSha } from '../../../../src/core/updates/sources/index'
import { createBareRepo, fixturePluginFiles, gitAvailable, runGit } from '../../../fixtures/plugins/hermetic-git'

const TAG = 'a'.repeat(40)
const COMMIT = 'b'.repeat(40)
const BRANCH = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

describe('pickLsRemoteSha', () => {
  it('an annotated tag resolves to its PEELED commit — what the staging clone\'s HEAD is — so an unchanged tag is current and a moved one is a real offer', () => {
    const unchanged = `${TAG}\trefs/tags/v1.2.0\n${COMMIT}\trefs/tags/v1.2.0^{}\n`
    expect(pickLsRemoteSha(unchanged, 'v1.2.0')).toBe(COMMIT)
    const moved = `${OTHER}\trefs/tags/v1.2.0\n${BRANCH}\trefs/tags/v1.2.0^{}\n`
    expect(pickLsRemoteSha(moved, 'v1.2.0')).toBe(BRANCH)
  })

  it('a lightweight tag and a branch are the commit itself; a branch wins over a tag of the same name (clone --branch prefers it)', () => {
    expect(pickLsRemoteSha(`${COMMIT}\trefs/tags/v1.2.0\n`, 'v1.2.0')).toBe(COMMIT)
    expect(pickLsRemoteSha(`${BRANCH}\trefs/heads/main\n`, 'main')).toBe(BRANCH)
    expect(pickLsRemoteSha(`${TAG}\trefs/tags/main\n${COMMIT}\trefs/tags/main^{}\n${BRANCH}\trefs/heads/main\n`, 'main')).toBe(BRANCH)
  })

  it('ONLY the exact ref answers: a suffix match, a remote-tracking row or "the first row" is null — a tracked ref that is gone blocks the subject (r6 #3)', () => {
    expect(pickLsRemoteSha(`${OTHER}\trefs/heads/feature/main\n${BRANCH}\trefs/heads/main\n`, 'main')).toBe(BRANCH)
    expect(pickLsRemoteSha(`${OTHER}\trefs/heads/feature/main\n`, 'main')).toBeNull()
    expect(pickLsRemoteSha(`${OTHER}\trefs/remotes/origin/main\n`, 'main')).toBeNull()
    expect(pickLsRemoteSha(`${OTHER}\trefs/heads/main\n`, 'v1.2.0')).toBeNull()
    expect(pickLsRemoteSha('', 'main')).toBeNull()
    expect(pickLsRemoteSha('not a sha\trefs/heads/main\n', 'main')).toBeNull()
  })

  it('a fully qualified ref is matched verbatim (peeled first)', () => {
    expect(pickLsRemoteSha(`${TAG}\trefs/tags/v1\n${COMMIT}\trefs/tags/v1^{}\n`, 'refs/tags/v1')).toBe(COMMIT)
    expect(pickLsRemoteSha(`${BRANCH}\trefs/heads/main\n`, 'refs/heads/main')).toBe(BRANCH)
    expect(pickLsRemoteSha(`${BRANCH}\trefs/heads/main\n`, 'refs/tags/main')).toBeNull()
  })
})

describe('lsRemoteSha — the command contract against a real repository', () => {
  if (!gitAvailable()) {
    it.skip('git not on PATH — skipping the ls-remote contract', () => {})
    return
  }

  it('an annotated tag resolves to its peeled commit (the probe asks for `<ref>^{}` too), a branch and a lightweight tag to theirs, a missing ref to null (r6 #2)', async () => {
    const repo = createBareRepo(testDir, 'ls-remote-fixture', fixturePluginFiles({ id: 'lsr', version: '1.0.0' }))
    const head = runGit(['rev-parse', 'HEAD'], repo.workingClonePath).toLowerCase()
    const env = { GIT_AUTHOR_NAME: 'Bakin Test', GIT_AUTHOR_EMAIL: 'test@bakin.local', GIT_COMMITTER_NAME: 'Bakin Test', GIT_COMMITTER_EMAIL: 'test@bakin.local' }
    runGit(['tag', '-a', 'v1.0.0', '-m', 'release 1.0.0'], repo.workingClonePath, env)
    runGit(['tag', 'light'], repo.workingClonePath, env)
    runGit(['push', 'origin', 'v1.0.0', 'light'], repo.workingClonePath, env)
    const tagObject = runGit(['rev-parse', 'v1.0.0'], repo.workingClonePath).toLowerCase()
    expect(tagObject).not.toBe(head) // annotated: the tag object is not the commit
    const signal = new AbortController().signal
    expect(await lsRemoteSha(repo.cloneUrl, 'v1.0.0', signal)).toBe(head)
    expect(await lsRemoteSha(repo.cloneUrl, 'refs/tags/v1.0.0', signal)).toBe(head)
    expect(await lsRemoteSha(repo.cloneUrl, 'light', signal)).toBe(head)
    expect(await lsRemoteSha(repo.cloneUrl, 'main', signal)).toBe(head)
    expect(await lsRemoteSha(repo.cloneUrl, 'nope', signal)).toBeNull()
  })
})
