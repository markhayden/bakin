/**
 * POST /api/packages/install — bare-name catalog resolution + capability
 * readiness in the response (T2.4). The installer and readiness engine are
 * mocked; this pins the HANDLER contract (resolution, 404, passthrough,
 * response shape). End-to-end install is covered by the installer suite and
 * the P2 rig validation.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-api-pkg-resolve-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const installedSources: string[] = []
mock.module('@/core/agent-packages/installer', () => ({
  installPackage: async (opts: { source: string }) => {
    installedSources.push(opts.source)
    return { packageId: 'web-search-brave', kind: 'skill-pack', version: '1.0.0', dependencies: [] }
  },
}))
mock.module('@/core/agent-packages/capability-readiness', () => ({
  listCapabilities: async () => [{
    capability: 'web-search',
    packageId: 'web-search-brave',
    version: '1.0.0',
    name: 'Web Search (Brave)',
    skills: [{ name: 'bx-search', status: 'ok' }],
    bins: [{ name: 'bx', status: 'ok' }],
    secrets: [{ name: 'BRAVE_SEARCH_API_KEY', required: true, secretSlot: 'brave.apiKey', status: 'missing' }],
    ready: false,
    missing: ['BRAVE_SEARCH_API_KEY is not configured'],
  }],
}))
mock.module('@/core/curated-catalog/load', () => ({
  loadUnifiedCatalog: async () => ({
    version: 2,
    updatedAt: '2026-07-12',
    entries: [{
      id: 'web-search-brave',
      kind: 'skill-pack',
      name: 'Web Search (Brave)',
      description: 'x',
      category: 'capability',
      tags: [], useCases: [], dependencies: [], screenshots: [],
      trust: 'official',
      builtin: false,
      defaultSelected: false,
      ref: 'abc123',
      runtimes: ['*'],
      source: 'github:markhayden/bakin-bits-official#packs/web-search-brave',
    }],
  }),
}))

import { post } from '../../packages/host/src/api/packages/install'

const url = new URL('http://localhost/api/packages/install')
const req = (body: unknown) => new Request(url, { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/packages/install — name resolution', () => {
  it('resolves a bare catalog name to its ref-pinned source and returns capability readiness', async () => {
    const res = await post(req({ source: 'web-search-brave' }), url)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.resolvedSource).toBe('github:markhayden/bakin-bits-official@abc123#packs/web-search-brave')
    expect(installedSources.at(-1)).toBe('github:markhayden/bakin-bits-official@abc123#packs/web-search-brave')
    expect(body.capability.ready).toBe(false)
    expect(body.capability.secrets[0].secretSlot).toBe('brave.apiKey')
  })

  it('404s on an unknown bare name with a helpful message', async () => {
    const res = await post(req({ source: 'no-such-pack' }), url)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('curated catalog')
  })

  it('passes explicit github: sources through untouched', async () => {
    const res = await post(req({ source: 'github:someone/some-pack' }), url)
    expect((await res.json()).ok).toBe(true)
    expect(installedSources.at(-1)).toBe('github:someone/some-pack')
  })
})
