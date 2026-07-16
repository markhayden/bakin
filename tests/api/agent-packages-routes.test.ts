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
import { mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { WorkspaceFile } from '../../packages/core/src/adapters/runtime'

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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: ReturnType<typeof createMockRuntimeAdapter> }
}

let workspaceReadCalls: string[] = []

function installRuntimeMock(): void {
  const runtime = createMockRuntimeAdapter({
    name: 'route-test-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
  })
  const baseAgents = runtime.agents
  const appRuntime = {
    ...runtime,
    agents: {
      ...baseAgents,
      readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
        workspaceReadCalls.push(`${agentId}:${path}`)
        const file = join(openClawDir, 'workspaces', agentId, path)
        try {
          return {
            path,
            content: readFileSync(file, 'utf-8'),
            updatedAt: statSync(file).mtime.toISOString(),
            metadata: { userEdited: false },
          }
        } catch {
          return null
        }
      },
      writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
        const dir = join(openClawDir, 'workspaces', agentId)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, file.path), file.content, 'utf-8')
      },
    },
  }
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime: appRuntime }
}

import * as installRoute from '../../packages/host/src/api/agent-packages/install'
import * as listRoute from '../../packages/host/src/api/agent-packages/list'
import * as dynamicRoute from '../../packages/host/src/api/agent-packages/dynamic'
import * as packagesListRoute from '../../packages/host/src/api/packages/list'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  workspaceReadCalls = []
  installRuntimeMock()
})

function seedAgentPackage(id = 'pixel', options: { enableLessons?: string[] } = {}): string {
  const enableLessons = options.enableLessons ?? ['style']
  const dir = join(testDir, `${id}-pkg`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'agent',
      name: id,
      version: '0.1.0',
      agent: { identity: { name: id } },
      install: { writeWorkspaceFiles: true, enableLessons },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        lessons: ['lessons/style.md'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul ${id}\n\n<!-- bakin:lesson-catalog:start -->\n<!-- bakin:lesson-catalog:end -->\n`,
  )
  writeFileSync(
    join(dir, 'lessons', 'style.md'),
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
    expect(pixelEntry?.version).toBe('0.1.0')
    expect(pixelEntry?.entry?.version).toBe('0.1.0')
  })

  it('returns a receipt with the updated version after POST /sync', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const manifestPath = join(src, 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.2.0' }))

    const { req: syncReq, url: syncUrl } = makeRequest('POST', '/api/agent-packages/pixel/sync', {})
    const syncRes = await dynamicRoute.handler(syncReq, syncUrl)
    expect(syncRes.status).toBe(200)
    const syncBody = await syncRes.json()
    expect(syncBody.ok).toBe(true)
    expect(syncBody.receipt.package.versionBefore).toBe('0.1.0')
    expect(syncBody.receipt.package.versionAfter).toBe('0.2.0')
    expect(syncBody.receipt.verification.status).toBe('ok')

    // Receipt persisted and retrievable
    const { req: rReq, url: rUrl } = makeRequest('GET', '/api/agent-packages/pixel/receipt')
    const rRes = await dynamicRoute.handler(rReq, rUrl)
    expect(rRes.status).toBe(200)
    expect((await rRes.json()).receipt.agentId).toBe('pixel')

    const { req, url } = makeRequest('GET', '/api/agent-packages')
    const res = await listRoute.get(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    const pixelEntry = body.agents.find((a: { agentId: string }) => a.agentId === 'pixel')
    expect(pixelEntry?.state).toBe('managed')
    expect(pixelEntry?.version).toBe('0.2.0')
  })

  it('responds 409 migrationRequired for legacy lockfile shapes, and /migrate clears it', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    // Rewrite the lockfile into the legacy pre-block shape
    const lock = readLockfile()
    const entry = lock.packages.pixel
    writeLockfile({
      version: 1,
      packages: {
        pixel: {
          ...entry,
          projections: [
            { kind: 'workspace-file', target: 'runtime:workspace-file:pixel:SOUL.md', sha256: 'x', templateOnly: true },
          ],
        },
      },
    })

    const { req: syncReq, url: syncUrl } = makeRequest('POST', '/api/agent-packages/pixel/sync', {})
    const syncRes = await dynamicRoute.handler(syncReq, syncUrl)
    expect(syncRes.status).toBe(409)
    expect((await syncRes.json()).migrationRequired).toBe(true)

    const { req: mReq, url: mUrl } = makeRequest('POST', '/api/agent-packages/migrate', {})
    const mRes = await dynamicRoute.handler(mReq, mUrl)
    expect(mRes.status).toBe(200)
    expect((await mRes.json()).ok).toBe(true)

    const { req: again, url: againUrl } = makeRequest('POST', '/api/agent-packages/pixel/sync', {})
    const againRes = await dynamicRoute.handler(again, againUrl)
    expect(againRes.status).toBe(200)
  })

  it('enriches package rows with update status when check=1 without mutating installed version', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const manifestPath = join(src, 'bakin-package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.2.0' }))

    const { req, url } = makeRequest('GET', '/api/agent-packages?check=1')
    const res = await listRoute.get(req, url)

    expect(res.status).toBe(200)
    const body = await res.json()
    const pixelEntry = body.agents.find((a: { agentId: string }) => a.agentId === 'pixel')
    expect(pixelEntry?.version).toBe('0.1.0')
    expect(pixelEntry?.entry?.version).toBe('0.1.0')
    expect(pixelEntry?.updateStatus).toMatchObject({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      upgradeAvailable: true,
    })
  })
})

describe('GET /api/packages', () => {
  it('returns standalone package entries and excludes agent packages', async () => {
    writeLockfile({
      version: 1,
      packages: {
        pixel: {
          kind: 'agent',
          version: '0.1.0',
          source: '/tmp/pixel',
          ref: '',
          commitSha: '',
          installedAt: '2026-05-18T00:00:00.000Z',
          state: 'managed',
          agentId: 'pixel',
          projections: [],
          refCount: 0,
          dependents: [],
          dependencies: [],
        },
        'shared-skills': {
          kind: 'skill-pack',
          version: '1.0.0',
          source: '/tmp/shared-skills',
          ref: '',
          commitSha: '',
          installedAt: '2026-05-18T00:00:00.000Z',
          projections: [],
          refCount: 0,
          dependents: [],
          dependencies: [],
        },
      },
    })

    const { req, url } = makeRequest('GET', '/api/packages')
    const res = await packagesListRoute.get(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.version).toBe(1)
    expect(body.packages.map((p: { id: string }) => p.id)).toEqual(['shared-skills'])
    expect(body.packages[0].kind).toBe('skill-pack')
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

describe('agent-packages dynamic — lessons endpoints', () => {
  it('GET /lessons returns an empty list for unmanaged agents', async () => {
    const { req, url } = makeRequest('GET', '/api/agent-packages/patch/lessons')
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, packageId: null, lessons: [] })
  })

  it('GET /lessons lists lessons with current enabled state', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('GET', '/api/agent-packages/pixel/lessons')
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const style = body.lessons.find((l: { lessonId: string }) => l.lessonId === 'style')
    expect(style?.enabled).toBe(true) // enableLessons: ['style']
  })

  it('POST /lessons/{lid} { enabled: false } disables a lesson', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }

    const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/lessons/style', {
      enabled: false,
    })
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.changed).toBe(true)
    expect(body.result.enabled).toBe(false)

    // Verify via GET that the toggle reflected
    const { req: req2, url: url2 } = makeRequest('GET', '/api/agent-packages/pixel/lessons')
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

    const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/lessons/style', {})
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(400)
  })

  it('does not enable a lesson when its installed source file is missing', async () => {
    const src = seedAgentPackage('pixel', { enableLessons: [] })
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }
    unlinkSync(join(testDir, 'packages', 'agents', 'pixel@0.1.0', 'lessons', 'style.md'))

    const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/lessons/style', {
      enabled: true,
    })
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('source file is missing')

    const lock = JSON.parse(readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8'))
    expect(lock.packages.pixel.lessonsEnabled).toEqual([])

    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')
    expect(soul).not.toContain('<!-- bakin:lesson:pixel:style:start -->')
  })
})

describe('agent-packages dynamic — 404 fallthrough', () => {
  it('returns 404 for an unknown verb/path combination', async () => {
    const { req, url } = makeRequest('PATCH', '/api/agent-packages/pixel/something-weird')
    const res = await dynamicRoute.handler(req, url)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/agent-packages/{agentId}/scan (#385)', () => {
  async function scan(agentId: string) {
    const { req, url } = makeRequest('GET', `/api/agent-packages/${agentId}/scan`)
    const res = await dynamicRoute.handler(req, url)
    return { status: res.status, body: await res.json() }
  }

  it('is clean after sync and reports live drift after an in-place edit — zero writes', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }
    {
      // Recompose against current context layers (install-time shas can lag
      // the lazily-seeded role context) so the baseline scan is clean.
      const { req, url } = makeRequest('POST', '/api/agent-packages/pixel/sync', {})
      const res = await dynamicRoute.handler(req, url)
      expect(res.status).toBe(200)
    }

    const clean = await scan('pixel')
    expect(clean.status).toBe(200)
    expect(clean.body.ok).toBe(true)
    expect(clean.body.packageId).toBe('pixel')
    expect(clean.body.findings).toEqual([])
    expect(typeof clean.body.scannedAt).toBe('string')

    // Drift: clobber the projected workspace file (managed block gone).
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    writeFileSync(soulPath, '# rogue content — managed block deleted\n')
    const lockBefore = readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')

    const drifted = await scan('pixel')
    expect(drifted.status).toBe(200)
    expect(drifted.body.findings.length).toBeGreaterThan(0)
    expect(
      (drifted.body.findings as Array<{ agentId?: string; packageId?: string }>).every(
        (f) => f.agentId === 'pixel' || f.packageId === 'pixel',
      ),
    ).toBe(true)

    // Read-only guarantee: the scan changed nothing.
    expect(readFileSync(join(testDir, 'packages', 'lock.json'), 'utf-8')).toBe(lockBefore)
    expect(readFileSync(soulPath, 'utf-8')).toBe('# rogue content — managed block deleted\n')
  })

  it('unknown agent scans to an empty findings list (not an error)', async () => {
    const src = seedAgentPackage()
    {
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      await installRoute.post(req, url)
    }
    workspaceReadCalls = []

    const { status, body } = await scan('nobody')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.packageId).toBeNull()
    expect(body.findings).toEqual([])
    expect(workspaceReadCalls).toEqual([])
  })

  it('does not read another installed agent workspace', async () => {
    for (const agentId of ['pixel', 'scout']) {
      const src = seedAgentPackage(agentId)
      const { req, url } = makeRequest('POST', '/api/agent-packages/install', { source: src })
      const res = await installRoute.post(req, url)
      expect(res.status).toBe(200)
    }
    workspaceReadCalls = []

    const { status } = await scan('pixel')

    expect(status).toBe(200)
    expect(workspaceReadCalls.length).toBeGreaterThan(0)
    expect(workspaceReadCalls.every((call) => call.startsWith('pixel:'))).toBe(true)
  })
})
