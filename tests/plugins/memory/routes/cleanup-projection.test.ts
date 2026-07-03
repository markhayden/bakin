/**
 * Tests for the agent-package-projection protection in cleanup find + dispatch.
 *
 * Durable files projected from an agent-package carry a `<file>.installedBy`
 * sidecar; an agent's edit to one can be reverted on `agents update
 * --refresh-template` unless `<file>.userEdited` is set. Find flags managed
 * files; dispatch sets the `.userEdited` sentinel so the cleanup sticks. Setting
 * the sentinel is a Bakin projection-layer write, not a runtime-memory write.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-cleanup-proj-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { cleanupFindRoute, cleanupDispatchRoute } from '../../../../plugins/memory/lib/routes/cleanup'
import type { PluginContext, SearchQueryParams } from '@bakin/core/plugin-types'

type Row = { id: string; fields: Record<string, unknown> }
type SeedFn = (agent: string | undefined, tier: string | undefined) => Row[]

function makeCtx(seed: SeedFn): PluginContext {
  let seq = 0
  return {
    pluginId: 'memory',
    search: {
      query: mock(async (params: SearchQueryParams) => {
        const agent = typeof params.filters?.agent === 'string' ? params.filters.agent : undefined
        const tier = typeof params.filters?.tier === 'string' ? params.filters.tier : undefined
        const rows = seed(agent, tier)
        return {
          results: rows.map((r) => ({ id: r.id, table: 'bakin_memory', score: 1, fields: r.fields })),
          meta: { query: params.q, total: rows.length, took_ms: 1, source: 'unavailable' as const },
        }
      }),
    },
    tasks: { create: mock(async (input) => ({ id: `task-${++seq}`, ...input, checked: false, column: 'todo' })) },
    activity: { log: mock(), audit: mock() },
  } as unknown as PluginContext
}

function durableRow(agent: string, sourcePath: string): Row {
  return { id: `durable:${agent}`, fields: { tier: 'durable', agent, source_path: sourcePath, content: 'use the beacon mcp' } }
}

function findReq(body: unknown): Request {
  return new Request('http://localhost/cleanup/find', { method: 'POST', body: JSON.stringify(body) })
}
function dispatchReq(body: unknown): Request {
  return new Request('http://localhost/cleanup/dispatch', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('cleanup find — managed flag', () => {
  it('flags durable hits whose source has an .installedBy sidecar as managed', async () => {
    const managedPath = join(testDir, 'AGENTS.md')
    const plainPath = join(testDir, 'SOUL.md')
    writeFileSync(managedPath, 'use the beacon mcp')
    writeFileSync(`${managedPath}.installedBy`, '{"package":"x"}')
    writeFileSync(plainPath, 'use the beacon mcp')

    const ctx = makeCtx((agent, tier) =>
      tier === 'durable'
        ? [durableRow('pixel', managedPath), { id: 'durable:plain', fields: { tier: 'durable', agent: 'pixel', source_path: plainPath, content: 'use the beacon mcp' } }]
        : [],
    )
    const res = await cleanupFindRoute.handler(findReq({ term: 'beacon' }), ctx, {})
    const body = await res.json() as { groups: Array<{ hits: Array<{ rowId: string; managed: boolean }> }> }
    const hits = body.groups[0].hits
    expect(hits.find((h) => h.rowId === 'durable:pixel')!.managed).toBe(true)
    expect(hits.find((h) => h.rowId === 'durable:plain')!.managed).toBe(false)
  })
})

describe('cleanup — skills are directory-projected', () => {
  it('flags a skill row via its DIRECTORY marker and pins the directory on dispatch', async () => {
    // Skill marker lives inside the skill dir, not beside SKILL.md.
    const skillDir = join(testDir, 'skills', 'foo')
    const skillFile = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillFile, 'use the beacon mcp')
    writeFileSync(join(skillDir, '.installedBy'), '{"package":"x"}')

    const skillRow = (): Row => ({
      id: 'durable:skill',
      fields: { tier: 'durable', kind: 'skill', agent: 'pixel', source_path: skillFile, content: 'use the beacon mcp' },
    })
    const ctx = makeCtx((agent, tier) => (tier === 'durable' && (agent === undefined || agent === 'pixel') ? [skillRow()] : []))

    // find flags it managed (via the dir marker)…
    const findRes = await cleanupFindRoute.handler(findReq({ term: 'beacon' }), ctx, {})
    const findBody = await findRes.json() as { groups: Array<{ hits: Array<{ managed: boolean }> }> }
    expect(findBody.groups[0].hits[0].managed).toBe(true)

    // …and dispatch sets .userEdited INSIDE the skill dir, not beside SKILL.md.
    await cleanupDispatchRoute.handler(dispatchReq({ term: 'beacon', action: 'remove', agents: ['pixel'] }), ctx, {})
    expect(existsSync(join(skillDir, '.userEdited'))).toBe(true)
    expect(existsSync(`${skillFile}.userEdited`)).toBe(false)
    expect(dirname(skillFile)).toBe(skillDir)
  })
})

describe('cleanup dispatch — protects managed edits', () => {
  it('sets the .userEdited sentinel for managed actionable targets', async () => {
    const managedPath = join(testDir, 'AGENTS.md')
    writeFileSync(managedPath, 'use the beacon mcp')
    writeFileSync(`${managedPath}.installedBy`, '{"package":"x"}')

    const ctx = makeCtx((agent, tier) => (tier === 'durable' && agent === 'pixel' ? [durableRow('pixel', managedPath)] : []))
    const res = await cleanupDispatchRoute.handler(
      dispatchReq({ term: 'beacon', action: 'remove', agents: ['pixel'] }),
      ctx,
      {},
    )
    expect(res.status).toBe(200)
    expect(existsSync(`${managedPath}.userEdited`)).toBe(true)
  })

  it('does not create a .userEdited sentinel for unmanaged targets', async () => {
    const plainPath = join(testDir, 'SOUL.md')
    writeFileSync(plainPath, 'use the beacon mcp')

    const ctx = makeCtx((agent, tier) =>
      tier === 'durable' && agent === 'pixel'
        ? [{ id: 'durable:plain', fields: { tier: 'durable', agent: 'pixel', source_path: plainPath, content: 'use the beacon mcp' } }]
        : [],
    )
    await cleanupDispatchRoute.handler(dispatchReq({ term: 'beacon', action: 'remove', agents: ['pixel'] }), ctx, {})
    expect(existsSync(`${plainPath}.userEdited`)).toBe(false)
  })
})
