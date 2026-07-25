/**
 * Install-time plugin dependency validation. Missing dependencies should
 * fail before any copied plugin dir is left behind.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-deps-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'

function writePluginSource(id: string, dependencies: string[]): string {
  const dir = join(testDir, 'sources', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    bakin: '*',
    description: `${id} test plugin`,
        dependencies,
    permissions: [],
  }, null, 2))
  writeFileSync(join(dir, 'index.ts'), `export default { id: '${id}', activate() {} }`)
  return dir
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function invoke(body: unknown) {
  const res = await installPOST(makeRequest(body), new URL('http://localhost/api/plugins/install'))
  return { res, body: await res.json() }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('plugin install dependencies', () => {
  it('rejects missing dependencies before leaving an installed plugin dir', async () => {
    const source = writePluginSource('needs-shared', ['shared'])

    const { res, body } = await invoke({ source, type: 'local' })

    expect(res.status).toBe(400)
    expect(body.error).toContain('missing dependencies: shared')
    expect(existsSync(join(testDir, 'plugins', 'needs-shared'))).toBe(false)
  })

  it('allows dependencies satisfied by core plugins', async () => {
    const source = writePluginSource('needs-tasks', ['tasks'])

    const { res, body } = await invoke({ source, type: 'local' })

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(existsSync(join(testDir, 'plugins', 'needs-tasks', 'bakin-plugin.json'))).toBe(true)
  })
})
