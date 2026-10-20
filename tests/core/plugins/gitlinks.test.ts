/** The gitlink scan reads object MODES alone (bounded by construction) and names paths only to refuse (#1007 review r11 #2, r12 #1). */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-gitlinks-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { countGitlinkModes, gitlinkPathsIn } from '../../../src/core/plugins/upgrade-github'

describe('the gitlink listing parsers', () => {
  it('a mode-only listing of a million entries is ~7 MB and counts its gitlinks exactly', () => {
    const modes = Array.from({ length: 1_000_000 }, (_, i) => (i % 250_000 === 7 ? '160000' : i % 3 === 0 ? '100755' : '100644'))
    const listing = modes.join('\n') + '\n'
    expect(listing.length).toBeLessThan(8 * 1024 * 1024)
    expect(countGitlinkModes(listing)).toBe(4)
    expect(countGitlinkModes('100644\n100644\n')).toBe(0)
    expect(countGitlinkModes('')).toBe(0)
  })

  it('paths are named from a mode+path listing up to the limit, gitlinks only, with or without a trailing newline', () => {
    const listing = '100644 src/index.ts\n160000 vendor/one\n100644 src/x y.ts\n160000 vendor/two\n160000 vendor/three'
    expect(gitlinkPathsIn(listing, 2)).toEqual(['vendor/one', 'vendor/two'])
    expect(gitlinkPathsIn(listing)).toEqual(['vendor/one', 'vendor/two', 'vendor/three'])
    expect(gitlinkPathsIn('100644 a\n')).toEqual([])
  })
})
