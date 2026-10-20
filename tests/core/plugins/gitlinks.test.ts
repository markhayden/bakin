/** The gitlink scan reads a listing file in fixed chunks, retaining only a count and five paths (#1007 review r11 #2, r13 #1). */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

import { scanGitlinkListing } from '../../../src/core/plugins/upgrade-github'

const BLOB = (n: number) => `100644 blob ${'a'.repeat(40)}\tsrc/deeply/nested/directory/with/a/long/path/component/file-${n}.ts\n`
const GITLINK = (path: string) => `160000 commit ${'b'.repeat(40)}\t${path}\n`

describe('scanGitlinkListing', () => {
  it('a gitlink-free listing far larger than the read window is scanned chunk by chunk with nothing retained', () => {
    const path = join(testDir, 'large.listing')
    const parts: string[] = []
    let n = 0
    let bytes = 0
    while (bytes < 12 * 1024 * 1024) { const line = BLOB(n++); parts.push(line); bytes += line.length }
    writeFileSync(path, parts.join(''))
    const { total, paths } = scanGitlinkListing(path, { chunkBytes: 4096 })
    expect(total).toBe(0)
    expect(paths).toEqual([])
    expect(n).toBeGreaterThan(100_000)
  })

  it('gitlinks split across chunk boundaries are counted in full and named up to the limit; a last line without a newline still counts', () => {
    const path = join(testDir, 'links.listing')
    writeFileSync(path, BLOB(1) + GITLINK('vendor/one') + BLOB(2) + GITLINK('vendor/two') + GITLINK('vendor/three') + BLOB(3) + GITLINK('tail').trimEnd())
    for (const chunkBytes of [1, 7, 64, 100_000]) {
      const { total, paths } = scanGitlinkListing(path, { limit: 2, chunkBytes })
      expect(total).toBe(4)
      expect(paths).toEqual(['vendor/one', 'vendor/two'])
    }
    expect(scanGitlinkListing(path).paths).toEqual(['vendor/one', 'vendor/two', 'vendor/three', 'tail'])
  })
})
