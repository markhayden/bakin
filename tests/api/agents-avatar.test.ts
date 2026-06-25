/**
 * Tests for GET /api/agents/avatar — agent id validation.
 *
 * The `id` query param lands in a filesystem join; anything shaped like a
 * path (separators, `..`, absolute) must be rejected with 400 before the
 * join, never resolved. Audit finding: sec-traversal.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-avatar-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const agentsDir = pathJoin(testDir, 'agents')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ agents: agentsDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ agents: agentsDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { get as avatarGet } from '../../packages/host/src/api/agents/avatar'

function request(id: string | null): Promise<Response> {
  const url = new URL('http://localhost:3737/api/agents/avatar')
  if (id !== null) url.searchParams.set('id', id)
  return avatarGet(new Request(url, { method: 'GET' }), url)
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

beforeAll(() => {
  mkdirSync(pathJoin(agentsDir, 'main'), { recursive: true })
  writeFileSync(pathJoin(agentsDir, 'main', 'avatar.jpg'), JPEG_BYTES)
  // A file OUTSIDE the agents root that a traversal-shaped id could reach.
  mkdirSync(pathJoin(testDir, 'outside'), { recursive: true })
  writeFileSync(pathJoin(testDir, 'outside', 'avatar.jpg'), JPEG_BYTES)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/agents/avatar', () => {
  it('serves the avatar for a valid agent id', async () => {
    const res = await request('main')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body).toEqual(JPEG_BYTES)
  })

  it('404s for a valid id with no avatar on disk', async () => {
    const res = await request('no-such-agent')
    expect(res.status).toBe(404)
  })

  it('400s when id is missing', async () => {
    const res = await request(null)
    expect(res.status).toBe(400)
  })

  it('rejects traversal-shaped ids without touching the filesystem', async () => {
    // join(agents, '../outside', 'avatar.jpg') resolves to the outside file —
    // the route must 400 on the id shape, not serve it.
    const res = await request('../outside')
    expect(res.status).toBe(400)
  })

  it('rejects ids containing separators or absolute paths', async () => {
    for (const id of ['a/b', 'a\\b', '/etc', '..', '.', 'a/../b']) {
      const res = await request(id)
      expect(res.status).toBe(400)
    }
  })
})
