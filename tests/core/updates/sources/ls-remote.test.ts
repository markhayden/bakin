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

import { pickLsRemoteSha } from '../../../../src/core/updates/sources/index'

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

  it('the EXACT ref is picked, never the first suffix match; no rows ⇒ null', () => {
    expect(pickLsRemoteSha(`${OTHER}\trefs/heads/feature/main\n${BRANCH}\trefs/heads/main\n`, 'main')).toBe(BRANCH)
    expect(pickLsRemoteSha('', 'main')).toBeNull()
    expect(pickLsRemoteSha('not a sha\trefs/heads/main\n', 'main')).toBeNull()
  })
})
