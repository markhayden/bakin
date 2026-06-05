/**
 * Self-test for the hermetic Whiskin artifact host (P0 fixture helper).
 *
 * No app modules, no ~/.bakin, no network beyond the loopback server this test
 * starts itself — so it needs no content-dir / openclaw mocks.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { get as httpGet } from 'http'

// This test imports no app modules and never touches ~/.bakin/~/.openclaw — it
// only serves a tmp dir over loopback. The mandatory isolation mocks are added
// per the project rule (every FS-touching test mocks both content-dir facades +
// the OpenClaw home) so nothing can ever leak into production homes.
const mockDir = join(tmpdir(), `whiskin-artifact-mock-${Date.now()}-${randomUUID()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  startArtifactServer,
  writeArtifactWithChecksum,
  type ArtifactServer,
} from '../../fixtures/whiskin-artifact-server'

let host: ArtifactServer | null = null
let dir: string | null = null

afterEach(async () => {
  if (host) {
    await host.stop()
    host = null
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

function freshDir(): string {
  const d = join(tmpdir(), `whiskin-artifact-test-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  return d
}

/**
 * GET via node:http rather than the global (happy-dom) `fetch`, which the test
 * runner registers globally and which refuses loopback requests (Same-Origin
 * Policy + a stricter HTTP parser). Phase 6's consumer materializer must
 * likewise avoid the DOM fetch when run under this harness.
 */
function httpGetBuffer(url: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
  })
}

describe('whiskin-artifact-server', () => {
  it('serves a written artifact whose bytes match the checksum sidecar', async () => {
    dir = freshDir()
    const bytes = new TextEncoder().encode('pretend-tarball-bytes')
    const sha = await writeArtifactWithChecksum(dir, 'pkg-0.1.0.tar.zst', bytes)
    expect(sha).toBe(createHash('sha256').update(bytes).digest('hex'))

    host = await startArtifactServer(dir)

    const res = await httpGetBuffer(`${host.origin}/pkg-0.1.0.tar.zst`)
    expect(res.status).toBe(200)
    expect(createHash('sha256').update(res.body).digest('hex')).toBe(sha)

    const checksumLine = readFileSync(join(dir, 'pkg-0.1.0.tar.zst.sha256'), 'utf-8')
    expect(checksumLine).toContain(sha)
  })

  it('returns 404 for a missing file', async () => {
    dir = freshDir()
    host = await startArtifactServer(dir)
    const res = await httpGetBuffer(`${host.origin}/does-not-exist.tar.zst`)
    expect(res.status).toBe(404)
  })

  it('refuses path traversal outside the served root', async () => {
    dir = freshDir()
    host = await startArtifactServer(dir)
    const res = await httpGetBuffer(`${host.origin}/..%2f..%2fetc%2fpasswd`)
    expect([403, 404]).toContain(res.status)
  })

  it('counts requests for download-once assertions', async () => {
    dir = freshDir()
    await writeArtifactWithChecksum(dir, 'a.bin', new Uint8Array([1, 2, 3]))
    host = await startArtifactServer(dir)
    expect(host.requestCount()).toBe(0)
    await httpGetBuffer(`${host.origin}/a.bin`)
    await httpGetBuffer(`${host.origin}/a.bin`)
    expect(host.requestCount()).toBe(2)
  })
})
