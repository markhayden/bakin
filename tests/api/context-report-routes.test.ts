/**
 * /api/context-report routes (#357) — summary list + per-agent breakdown.
 * Calls the handler directly with synthetic Web Requests. The critical
 * contract: responses carry source NAMES and NUMBERS only, never prompt or
 * workspace file content.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-context-report-routes-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
  isUsingBakinHome: () => true,
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('@/core/logger', loggerMock)
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('@bakin/core/logger', loggerMock)

type TestGlobal = typeof globalThis & { __bakinAppServices?: unknown }

function installRuntimeMock(): void {
  const runtime = createMockRuntimeAdapter({
    name: 'context-report-test-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
  })
  const appRuntime = {
    ...runtime,
    agents: {
      ...runtime.agents,
      workspaceFileStats: async (agentId: string) =>
        agentId === 'jessica'
          ? [
              { name: 'AGENTS.md', bytes: 640, mtimeMs: 1, kind: 'canonical' as const },
              { name: 'memory/2026-07-01.md', bytes: 128, mtimeMs: 1, kind: 'memory' as const },
            ]
          : null,
    },
  }
  ;(globalThis as TestGlobal).__bakinAppServices = { runtime: appRuntime }
  return void appRuntime.agents.create({ id: 'main', name: 'main' })
}

import { handler } from '../../packages/host/src/api/context-report/index'
import { closeDb } from '../../packages/core/src/storage/db'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const get = (path: string) => handler(new Request(`http://localhost${path}`), new URL(`http://localhost${path}`))

describe('/api/context-report', () => {
  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true })
    installRuntimeMock()
    const services = (globalThis as TestGlobal).__bakinAppServices as {
      runtime: { agents: { create: (i: { id: string; name: string }) => Promise<unknown> } }
    }
    await services.runtime.agents.create({ id: 'jessica', name: 'jessica' })
  })

  it('GET /api/context-report returns per-agent summary rows', async () => {
    const res = await get('/api/context-report')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const jessica = body.agents.find((a: { agentId: string }) => a.agentId === 'jessica')
    expect(jessica).toMatchObject({ workspaceAvailable: true, workspaceTotalBytes: 768 })
    expect(jessica.staticTaskBytes).toBeGreaterThan(1000)
    expect(jessica.estimatedMaxTaskBytes).toBeGreaterThanOrEqual(jessica.staticTaskBytes)
  })

  it('GET /api/context-report/{agentId} returns the full per-source breakdown, names + numbers only', async () => {
    const res = await get('/api/context-report/jessica')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.report.dispatch.task.sections.length).toBeGreaterThan(3)
    expect(body.report.workspace.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'AGENTS.md', bytes: 640 })]),
    )
    // No content leaks anywhere in the payload.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('OUTPUT DISCIPLINE — MANDATORY')
    expect(raw).not.toContain('"content"')
    for (const section of body.report.dispatch.task.sections) {
      expect(Object.keys(section).sort()).toEqual(['approxTokens', 'bytes', 'source'])
    }
  })

  it('404s for an unknown agent and 405s non-GET', async () => {
    const missing = await get('/api/context-report/ghost')
    expect(missing.status).toBe(404)
    const post = await handler(
      new Request('http://localhost/api/context-report', { method: 'POST' }),
      new URL('http://localhost/api/context-report'),
    )
    expect(post.status).toBe(405)
  })
})
