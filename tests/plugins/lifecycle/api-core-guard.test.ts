/**
 * API endpoint core-plugin guard coverage (commit C18).
 *
 * The core-plugin-guard.test.ts file already covers the lockfile mutator
 * defense-in-depth layer. This file covers the OUTER layer: both API
 * endpoints (/api/plugins/remove and /api/plugins/upgrade) must return
 * 400 with `{ core: true }` for any core id, BEFORE any registry sweep
 * or git interaction runs.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-api-core-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// Pretend "tasks" is a core plugin. Both endpoints check this predicate
// before any other work, so we don't need a real registry init.
mock.module('../../../src/lib/plugin-registry', () => ({
  isCorePlugin: (id: string) => id === 'tasks',
  pluginRegistry: { getPlugin: () => undefined, getPluginContext: () => undefined, deletePlugin: () => false },
  getHookRegistry: () => ({ unregisterByPlugin: () => 0 }),
}))

import { post as removePOST } from '../../../packages/host/src/api/plugins/remove'
import { post as upgradePOST } from '../../../packages/host/src/api/plugins/upgrade'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/plugins/remove core guard', () => {
  it('returns 400 with core:true for a core id', async () => {
    const req = makeRequest('/api/plugins/remove', { pluginId: 'tasks' })
    const res = await removePOST(req, new URL(req.url))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.core).toBe(true)
    expect(body.error).toMatch(/cannot remove core plugin/i)
  })

  it('does NOT return 400 for a user-id (different reason — 404 since not installed)', async () => {
    const req = makeRequest('/api/plugins/remove', { pluginId: 'not-tasks' })
    const res = await removePOST(req, new URL(req.url))
    // Either 404 (no lockfile entry, no plugin dir) or 200 — but never
    // the core-guard 400 path.
    const body = await res.json()
    expect(body.core).toBeUndefined()
  })
})

describe('/api/plugins/upgrade core guard', () => {
  it('returns 400 with core:true for a core id', async () => {
    const req = makeRequest('/api/plugins/upgrade', { pluginId: 'tasks' })
    const res = await upgradePOST(req, new URL(req.url))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.core).toBe(true)
    expect(body.error).toMatch(/cannot upgrade core plugin/i)
  })
})
