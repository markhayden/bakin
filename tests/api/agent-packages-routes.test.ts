/**
 * Integration test for /api/agent-packages and /api/packages routes (Phase F-2).
 *
 * Calls the route handler `post`/`get` functions directly with synthetic
 * Web Request objects rather than spinning up the full HTTP server. This
 * proves the route wiring + zod validation + downstream installer/uninstaller/
 * updater coordination work end-to-end.
 *
 * Setup mirrors tests/agent-packages/installer.test.ts — env-var redirect
 * for OPENCLAW_HOME / BAKIN_HOME so route tests never touch real OpenClaw.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-routes-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

type TestGlobal = typeof globalThis & {
  __bakinFallbackRuntimeAdapter?: ReturnType<typeof createMockRuntimeAdapter>
}

import * as installRoute from '../../packages/host/src/api/agent-packages/install'
import * as listRoute from '../../packages/host/src/api/agent-packages/list'
import * as dynamicRoute from '../../packages/host/src/api/agent-packages/dynamic'
import * as packagesListRoute from '../../packages/host/src/api/packages/list'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  ;(globalThis as TestGlobal).__bakinFallbackRuntimeAdapter = createMockRuntimeAdapter({
    name: 'route-test-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
  })
})

function seedAgentPackage(id = 'pixel'): string {
  const dir = join(testDir, `${id}-pkg`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'agent',
      name: id,
      version: '0.1.0',
      agent: { identity: { name: id } },
      install: { writeWorkspaceFiles: true, enableKnowledge: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        knowledge: ['knowledge/style.md'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul ${id}\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
  )
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.`,
  )
  return dir
}

function makeRequest(method: string, path: string, body?: unknown): { req: Request; url: URL } {
  const url = new URL(`http://localhost:3737${path}`)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return { req: new Request(url, init), url }
}

describe('POST /api/agent-packages/install', () => {
  it('returns 200 + result on success', async () => {
    const src = seedAgentPackage()
    const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
    const res = await installRoute.post(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.packageId).toBe('pixel')
    expect(body.result.kind).toBe('agent')
    expect(body.result.createdAgent).toBe(true)
  })

  it('returns 400 on missing source', async () => {
    const { req, url } = makeRequest('POST', '/api/agent-packages/install', { foo: 'bar' })
    const res = await installRoute.post(req, url)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 409 when agent already managed', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }
    const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
    const res = await installRoute.post(req, url)
    expect(res.status).toBe(409)
  })

  it('returns 400 on bad JSON', async () => {
    const url = new URL('http://localhost:3737/api/agent-packages/install')
    const req = new Request(url, {
      method: 'POST',
      body: '{ this is not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await installRoute.post(req, url)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/agent-packages', () => {
  it('returns the list of all agent states', async () => {
    const src = seedAgentPackage()
    const { req: instReq, url: instUrl } = makeRequest('POST', '/api/agent-packages/install', { source: src })
    await installRoute.post(instReq, instUrl)

    const { req, url } = makeRequest('GET', '/api/agent-packages')
    const res = await listRoute.get(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const pixelEntry = body.agents.find((a: { agentId: string }) => a.agentId === 'pixel')
    expect(pixelEntry?.state).toBe('managed')
  })
})

describe('GET /api/packages', () => {
  it('returns the lockfile snapshot in API shape', async () => {
    const src = seedAgentPackage()
    const { req: instReq, url: instUrl } = makeRequest('POST', '/api/agent-packages/install', { source: src })
    await installRoute.post(instReq, instUrl)

    const { req, url } = makeRequest('GET', '/api/packages')
    const res = await packagesListRoute.get(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.version).toBe(1)
    expect(body.packages.length).toBeGreaterThan(0)
    const pixel = body.packages.find((p: { id: string }) => p.id === 'pixel')
    expect(pixel?.kind).toBe('agent')
    expect(pixel?.state).toBe('managed')
  })
})

describe('agent-packages dynamic — DELETE /api/agent-packages/{agentId}', () => {
  it('removes the package, returns 200', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('DELETE', '/api/agent-packages/pixel', {})
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.removed).toContain('pixel')
  })

  it('returns 404 when agent has no package', async () => {
    const { req, url } = makeRequest('DELETE', '/api/agent-packages/never-installed', {})
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(404)
  })
})

describe('agent-packages dynamic — knowledge endpoints', () => {
  it('GET /knowledge lists lessons with current enabled state', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('GET', '/api/agent-packages/pixel/knowledge')
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const style = body.lessons.find((l: { lessonId: string }) => l.lessonId === 'style')
    expect(style?.enabled).toBe(true) // enableKnowledge: ['style']
  })

  it('POST /knowledge/{lid} { enabled: false } disables a lesson', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/knowledge/style', {
      enabled: false,
    })
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.changed).toBe(true)
    expect(body.result.enabled).toBe(false)

    // Verify via GET that the toggle reflected
    const { req: req2, url: url2 } = makeRequest('GET', '/api/agent-packages/pixel/knowledge')
    const res2 = await dynamicRoute.handler(req2, url2)
    const body2 = await res2.json()
    const style = body2.lessons.find((l: { lessonId: string }) => l.lessonId === 'style')
    expect(style?.enabled).toBe(false)
  })

  it('returns 400 on missing enabled field in toggle body', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/knowledge/style', {})
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(400)
  })
})

describe('agent-packages dynamic — 404 fallthrough', () => {
  it('returns 404 for an unknown verb/path combination', async () => {
    const { req, url } = makeRequest('PATCH', '/api/agent-packages/pixel/something-weird')
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(404)
  })
})
