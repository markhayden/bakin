/**
 * Tests for the assets.listByTask hook — core's sanctioned path for resolving
 * a task's attached assets at dispatch time (replaces the broken sidecar scan
 * that predated the versioned-asset layout). Backed by an in-memory
 * taskId→assetIds index maintained on manifest writes.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-list-by-task-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))

mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
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
}))

import assetsPlugin from '@bakin/assets'
import { createAsset, relink } from '@bakin/assets/lib/asset-service'
import { deleteAsset } from '@bakin/assets/lib/asset-trash'

type ListHandler = (data: Record<string, unknown>) => Array<{ assetId: string; description: string; type: string }> | Promise<Array<{ assetId: string; description: string; type: string }>>

let plugin: ActivatedPlugin
let listHandler: ListHandler | undefined

function makeSourceFile(name: string, content: string): string {
  const dir = join(testDir, 'sources')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

beforeAll(async () => {
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)

  const registerCalls = (plugin.ctx.hooks.register as ReturnType<typeof mock>).mock.calls
  const listCall = registerCalls.find((args: unknown[]) => args[0] === 'assets.listByTask')
  listHandler = listCall?.[1] as ListHandler | undefined
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('assets.listByTask hook', () => {
  it('is registered', () => {
    expect(listHandler).toBeDefined()
  })

  it('returns assets linked to a task under the versioned layout', async () => {
    const src = makeSourceFile('report.md', '# Quarterly report')
    const { assetId } = await createAsset({
      type: 'text',
      sourceFilePath: src,
      taskId: 'task-with-assets',
      agent: 'pixel',
      description: 'Quarterly report draft',
    })

    const result = await listHandler!({ taskId: 'task-with-assets' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ assetId, type: 'text' })
    expect(result[0]!.description.length).toBeGreaterThan(0)
  })

  it('returns empty for a task with no assets and for missing taskId', async () => {
    expect(await listHandler!({ taskId: 'task-without-assets' })).toEqual([])
    expect(await listHandler!({})).toEqual([])
  })

  it('relink moves the asset between task buckets', async () => {
    const src = makeSourceFile('moving.md', 'moves between tasks')
    const { assetId } = await createAsset({
      type: 'text',
      sourceFilePath: src,
      taskId: 'task-a',
      agent: 'pixel',
      description: 'movable',
    })

    expect((await listHandler!({ taskId: 'task-a' })).map(a => a.assetId)).toContain(assetId)

    await relink(assetId, 'task-b')
    expect((await listHandler!({ taskId: 'task-a' })).map(a => a.assetId)).not.toContain(assetId)
    expect((await listHandler!({ taskId: 'task-b' })).map(a => a.assetId)).toContain(assetId)
  })

  it('deleted (trashed) assets disappear from the task listing', async () => {
    const src = makeSourceFile('doomed.md', 'soon gone')
    const { assetId } = await createAsset({
      type: 'text',
      sourceFilePath: src,
      taskId: 'task-doomed',
      agent: 'pixel',
      description: 'doomed',
    })
    expect((await listHandler!({ taskId: 'task-doomed' })).map(a => a.assetId)).toContain(assetId)

    await deleteAsset(assetId)
    expect((await listHandler!({ taskId: 'task-doomed' })).map(a => a.assetId)).not.toContain(assetId)
  })
})
