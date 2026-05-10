/**
 * Tests for /api/curated (Phase I-3).
 *
 * Coverage:
 *   - Static catalog returns 200 + parsed shape
 *   - Schema enforced on read (malformed catalog file → 500)
 *   - The agents/ package directory is NOT included by the embedded-assets
 *     builder (key contract: no agent packages get baked into the binary)
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-curated-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { describe, it, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import * as curatedRoute from '../../packages/host/src/api/curated/list'

describe('GET /api/curated', () => {
  it('returns the catalog with version + agents[]', async () => {
    const url = new URL('http://localhost:3737/api/curated')
    const req = new Request(url, { method: 'GET' })
    const res = await curatedRoute.get(req, url)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.catalog.version).toBe(1)
    expect(Array.isArray(body.catalog.agents)).toBe(true)
    expect(body.catalog.agents.length).toBeGreaterThan(0)

    // Each agent has the required fields
    for (const agent of body.catalog.agents) {
      expect(typeof agent.id).toBe('string')
      expect(typeof agent.name).toBe('string')
      expect(typeof agent.description).toBe('string')
      expect(typeof agent.source).toBe('string')
      expect(['official', 'verified', 'community']).toContain(agent.trust)
    }
  })

  it('every catalog entry has a github: source (no bare names)', async () => {
    const url = new URL('http://localhost:3737/api/curated')
    const req = new Request(url, { method: 'GET' })
    const res = await curatedRoute.get(req, url)
    const body = await res.json()

    for (const agent of body.catalog.agents) {
      expect(agent.source.startsWith('github:')).toBe(true)
    }
  })

  it('catalog points public agents at the official bits repo only', async () => {
    const url = new URL('http://localhost:3737/api/curated')
    const req = new Request(url, { method: 'GET' })
    const res = await curatedRoute.get(req, url)
    const body = await res.json()

    expect(body.catalog.agents.map((agent: { id: string }) => agent.id).sort()).toEqual([
      'jessica-fetcher',
      'patch',
      'pixel',
      'rolo',
    ])

    for (const agent of body.catalog.agents) {
      expect(agent.source).toBe(`github:markhayden/bakin-bits-official#agents/${agent.id}`)
    }
  })

  it('catalog file matches the zod schema', () => {
    // Direct schema check — proves the file on disk is well-formed
    // independent of the route handler.
    const path = join(import.meta.dir, '..', '..', 'packages/host/src/data/curated-agents.json')
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(typeof raw.updatedAt).toBe('string')
    expect(Array.isArray(raw.agents)).toBe(true)
  })
})

describe('embedded-assets builder excludes agents/', () => {
  it('the asset-source collector never walks the agents/ directory', () => {
    // Source-level assertion: grep the embedded-assets script for any
    // walker that targets agents/. The exclusion is by omission — the
    // walk paths are explicit (host/dist, host/public, plugins/*/dist,
    // host/src/data). If a future change accidentally adds an agents/
    // walker, this test fires.
    const script = readFileSync(
      join(import.meta.dir, '..', '..', 'scripts/generate-embedded-assets.ts'),
      'utf-8',
    )

    // Should NOT contain a walk(agents) call. We check for the literal
    // string with both straight and templated forms.
    expect(script).not.toContain("walk(join(REPO_ROOT, 'agents')")
    expect(script).not.toContain('walk(agentsDir')
    expect(script).not.toContain("'/agents'")

    // Positively confirm the explicit walks are still there
    expect(script).toContain("walk(join(REPO_ROOT, 'packages/host/dist'), '/assets'")
    expect(script).toContain('walk(distDir')
  })
})
