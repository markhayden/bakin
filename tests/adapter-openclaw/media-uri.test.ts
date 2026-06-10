import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// The adapter's home module reads OPENCLAW_HOME on resolution — set BOTH env
// vars before any app imports so nothing can touch ~/.openclaw or ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-media-uri-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'

describe('OpenClaw media:// URI resolution', () => {
  const mediaRoot = join(testDir, 'openclaw', 'media')
  mkdirSync(join(mediaRoot, 'inbound'), { recursive: true })
  const attachment = join(mediaRoot, 'inbound', 'cat-reference.png')
  writeFileSync(attachment, 'cat-bytes')
  const runtime = createOpenClawRuntimeAdapter({ settings: {} })

  afterAll(() => rmSync(testDir, { recursive: true, force: true }))

  it('resolves media://inbound/<file> to the absolute path under the media root', async () => {
    await expect(runtime.media!.resolveUri('media://inbound/cat-reference.png')).resolves.toBe(attachment)
  })

  it('returns null for a missing file', async () => {
    await expect(runtime.media!.resolveUri('media://inbound/nope.png')).resolves.toBeNull()
  })

  it('returns null for other URI schemes', async () => {
    await expect(runtime.media!.resolveUri('https://example.com/x.png')).resolves.toBeNull()
    await expect(runtime.media!.resolveUri('/etc/passwd')).resolves.toBeNull()
  })

  it('rejects traversal out of the media root', async () => {
    // A real file outside the media root must not be reachable.
    writeFileSync(join(testDir, 'openclaw', 'secret.txt'), 'secret')
    await expect(runtime.media!.resolveUri('media://../secret.txt')).resolves.toBeNull()
    await expect(runtime.media!.resolveUri('media://inbound/../../secret.txt')).resolves.toBeNull()
  })
})
