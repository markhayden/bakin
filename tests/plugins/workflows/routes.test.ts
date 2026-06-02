/**
 * Workflows plugin — search route integration test.
 *
 * Activates the workflows plugin against a mocked PluginContext and exercises
 * the auto-registered GET /search route via `seedResults` + `callSearchRoute`
 * helpers from `tests/plugins/test-helpers.ts`.
 *
 * The workflows plugin registers a file-backed content type (`bakin_workflows`)
 * during `activate()`, which causes the test helper to auto-register the
 * `/search` route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  callRoute,
  callSearchRoute,
  findRoute,
  type ActivatedPlugin,
} from '../test-helpers'

// ─── Test directory ────────────────────────────────────────────────────────

const testDir = join(tmpdir(), `bakin-test-workflows-search-${Date.now()}`)

// ─── Mocks (must be declared before any plugin imports) ────────────────────

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('@/core/task-store', () => ({
  createTask: mock(() => Promise.resolve({ id: 'mock-task' })),
  addTaskLog: mock(() => Promise.resolve()),
  moveTask: mock(() => Promise.resolve()),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

;(globalThis as unknown as { __bakinBroadcast?: unknown }).__bakinBroadcast = mock()

// ─── Plugin import (after mocks) ───────────────────────────────────────────

import workflowsPlugin from '../../../plugins/workflows'
import { getPluginSkills } from '../../../src/lib/plugin-registry'
import {
  hashWorkflowSkillContent,
  writeWorkflowSkillInstallMarker,
} from '../../../plugins/workflows/lib/workflow-skill-drift'

// ─── Setup ─────────────────────────────────────────────────────────────────

let activated: ActivatedPlugin
const skillsDir = join(testDir, 'workflows', 'skills')
const managedDir = join(testDir, 'managed-workflow-skills')

const currentGenerateImageSkill = `---
name: Generate Image
output_schema:
  type: object
  required: [assetId]
---

Return assetId from the images tool.
`

const staleGenerateImageSkill = `---
name: Generate Image
output_schema:
  type: object
  required: [image_filename]
---

Return image_filename and promptAssetFilename after savePromptPacket.
`

beforeAll(async () => {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }
  activated = await activatePlugin(workflowsPlugin, testDir)
  activated.ctx.registerWorkflow({
    id: 'drift-route-test',
    name: 'Drift Route Test',
    description: 'Route fixture for workflow skill drift.',
    version: 1,
    steps: [{
      id: 'gen',
      type: 'agent',
      label: 'Generate',
      agent: 'pixel',
      skill: 'generate-image',
    }],
  })
  activated.ctx.registerWorkflow({
    id: 'drift-nested-child',
    name: 'Drift Nested Child',
    description: 'Child workflow with a managed skill.',
    version: 1,
    steps: [{
      id: 'nested-gen',
      type: 'agent',
      label: 'Nested Generate',
      agent: 'pixel',
      skill: 'generate-image',
    }],
  })
  activated.ctx.registerWorkflow({
    id: 'drift-nested-parent',
    name: 'Drift Nested Parent',
    description: 'Parent workflow that expands a child workflow.',
    version: 1,
    steps: [{
      id: 'child-flow',
      type: 'workflow',
      label: 'Run Child',
      workflow_id: 'drift-nested-child',
    }],
  })
})

afterAll(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

beforeEach(() => {
  activated.seedResults([])
  getPluginSkills().clear()
  rmSync(skillsDir, { recursive: true, force: true })
  rmSync(managedDir, { recursive: true, force: true })
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(managedDir, { recursive: true })
})

function seedManagedGenerateImageSkill(options: { repairable?: boolean } = {}): void {
  const sourcePath = join(managedDir, 'generate-image.md')
  const target = join(skillsDir, 'generate-image.md')
  writeFileSync(sourcePath, currentGenerateImageSkill, 'utf-8')
  writeFileSync(target, staleGenerateImageSkill, 'utf-8')
  getPluginSkills().set('generate-image', {
    name: 'Generate Image',
    instructions: 'Return assetId from the images tool.',
    source: 'plugin:images',
    sourcePath,
  })
  if (options.repairable) {
    writeWorkflowSkillInstallMarker(target, {
      sourceKind: 'plugin',
      sourceId: 'images',
      sourcePath,
      sha256: hashWorkflowSkillContent(staleGenerateImageSkill),
      installedAt: '2026-06-02T00:00:00.000Z',
    })
  }
}

// ─── Search Route ──────────────────────────────────────────────────────────

describe('Workflows Plugin — GET /search', () => {
  it('auto-registers a /search route via registerFileBackedContentType', () => {
    const route = activated.routes.find(
      (r) => r.method === 'GET' && r.path === '/search',
    )
    expect(route).toBeDefined()
  })

  it('returns seeded workflow definition results for a valid query', async () => {
    activated.seedResults([
      {
        id: 'def:content-pipeline',
        table: 'bakin_workflows',
        score: 0.95,
        fields: {
          name: 'Content Pipeline',
          description: 'Generate and publish content',
          type: 'definition',
          status: 'active',
        },
      },
      {
        id: 'def:onboarding',
        table: 'bakin_workflows',
        score: 0.72,
        fields: {
          name: 'Onboarding',
          description: 'Welcome new agents',
          type: 'definition',
          status: 'active',
        },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'pipeline')

    expect(status).toBe(200)
    const results = body.results as Array<{ id: string; score: number; table: string }>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('def:content-pipeline')
    expect(results[0].score).toBe(0.95)
    expect(results[0].table).toBe('bakin_workflows')
  })

  it('returns 400 when q is missing', async () => {
    const { status, body } = await callSearchRoute(activated, '')

    expect(status).toBe(400)
    expect(body.error).toBe('Missing ?q= parameter')
  })

  it('returns 200 with empty results when no matches', async () => {
    const { status, body } = await callSearchRoute(activated, 'no-matches')

    expect(status).toBe(200)
    expect(body.results).toEqual([])
  })

  it('passes parsed type,status facets to ctx.search.query', async () => {
    await callSearchRoute(activated, 'pipeline', { facets: 'type,status' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'pipeline',
        facets: ['type', 'status'],
      }),
    )
  })
})

describe('Workflows Plugin — workflow skill drift routes', () => {
  it('includes workflow skill drift summaries in the definitions list', async () => {
    seedManagedGenerateImageSkill()
    const route = findRoute(activated.routes, 'GET', '/definitions')!

    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(200)
    const templates = body.templates as Array<{ filename: string; skillDrift?: any }>
    const template = templates.find(item => item.filename === 'drift-route-test')
    expect(template?.skillDrift?.count).toBe(1)
    expect(template?.skillDrift?.skills).toEqual(['generate-image'])
    expect(template?.skillDrift?.byStep.gen).toEqual(['generate-image'])
  })

  it('includes workflow skill drift summaries in definition detail', async () => {
    seedManagedGenerateImageSkill()
    const route = findRoute(activated.routes, 'GET', '/definitions/:name')!

    const { status, body } = await callRoute(route, activated.ctx, {
      path: '/definitions/drift-route-test',
      searchParams: { name: 'drift-route-test' },
    })

    expect(status).toBe(200)
    expect((body.skillDrift as { count: number }).count).toBe(1)
    expect((body.skillDrift as { byStep: Record<string, string[]> }).byStep.gen).toEqual(['generate-image'])
  })

  it('includes nested workflow skill drift summaries in parent definition detail', async () => {
    seedManagedGenerateImageSkill()
    const route = findRoute(activated.routes, 'GET', '/definitions/:name')!

    const { status, body } = await callRoute(route, activated.ctx, {
      path: '/definitions/drift-nested-parent',
      searchParams: { name: 'drift-nested-parent' },
    })

    expect(status).toBe(200)
    expect((body.skillDrift as { count: number }).count).toBe(1)
    expect((body.skillDrift as { byStep: Record<string, string[]> }).byStep['child-flow__nested-gen']).toEqual(['generate-image'])
  })

  it('repairs a safe stale workflow skill through the direct repair route', async () => {
    seedManagedGenerateImageSkill({ repairable: true })
    const repairRoute = findRoute(activated.routes, 'POST', '/skills/:name/repair')!
    const detailRoute = findRoute(activated.routes, 'GET', '/definitions/:name')!

    const repaired = await callRoute(repairRoute, activated.ctx, {
      path: '/skills/generate-image/repair',
    })
    const detail = await callRoute(detailRoute, activated.ctx, {
      path: '/definitions/drift-route-test',
      searchParams: { name: 'drift-route-test' },
    })

    expect(repaired.status).toBe(200)
    expect(repaired.body.status).toBe('applied')
    expect(detail.status).toBe(200)
    expect(detail.body.skillDrift).toBeUndefined()
  })

  it('returns 500 when direct repair cannot write the replacement file', async () => {
    seedManagedGenerateImageSkill({ repairable: true })
    const repairRoute = findRoute(activated.routes, 'POST', '/skills/:name/repair')!
    const originalDateNow = Date.now
    const fixedNow = 1780431742000
    const target = join(skillsDir, 'generate-image.md')
    const collidingTempPath = `${target}.repair-${process.pid}-${fixedNow}.tmp`
    Date.now = () => fixedNow
    mkdirSync(collidingTempPath, { recursive: true })

    try {
      const repaired = await callRoute(repairRoute, activated.ctx, {
        path: '/skills/generate-image/repair',
      })

      expect(repaired.status).toBe(500)
      expect(repaired.body.status).toBe('failed')
    } finally {
      Date.now = originalDateNow
      rmSync(collidingTempPath, { recursive: true, force: true })
    }
  })
})
