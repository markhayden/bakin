/** The gitlink scan streams `git ls-tree -r` with bounded retained output (#1007 review r11 #2). */
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

import { collectGitlinks } from '../../../src/core/plugins/upgrade-github'

const BLOB = (n: number) => `100644 blob ${'a'.repeat(40)}\tsrc/deeply/nested/directory/with/a/long/path/component/file-${n}.ts\n`
const GITLINK = (path: string) => `160000 commit ${'b'.repeat(40)}\t${path}\n`

/** A listing streamed in chunks that split lines at arbitrary byte offsets. */
function stream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
      offset += chunkSize
    },
  })
}

describe('collectGitlinks', () => {
  it('a gitlink-free listing well past the 10 MiB exec buffer streams through with nothing retained', async () => {
    let listing = ''
    let n = 0
    while (listing.length < 11 * 1024 * 1024) listing += BLOB(n++)
    const { paths, total } = await collectGitlinks(stream(listing, 64 * 1024))
    expect(total).toBe(0)
    expect(paths).toEqual([])
    expect(n).toBeGreaterThan(90_000)
  })

  it('gitlinks are found across chunk boundaries, counted in full and named up to the limit', async () => {
    const listing = BLOB(1) + GITLINK('vendor/one') + BLOB(2) + GITLINK('vendor/two') + GITLINK('vendor/three') + BLOB(3) + GITLINK('tail')
    for (const chunkSize of [1, 7, 64, 100_000]) {
      const { paths, total } = await collectGitlinks(stream(listing, chunkSize), 2)
      expect(total).toBe(4)
      expect(paths).toEqual(['vendor/one', 'vendor/two'])
    }
    // A listing without a trailing newline still yields its last line.
    expect((await collectGitlinks(stream(GITLINK('last').trimEnd(), 5))).paths).toEqual(['last'])
  })
})
