/**
 * Tests for clipboard asset purge on task completion.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-clipboard-purge-${Date.now()}`)
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

let plugin: ActivatedPlugin
let purgeHandler: ((data: Record<string, unknown>) => Promise<unknown>) | undefined

beforeAll(async () => {
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)

  // Find the purge hook handler that was registered
  const registerCalls = (plugin.ctx.hooks.register as ReturnType<typeof mock>).mock.calls
  const purgeCall = registerCalls.find((args: unknown[]) => args[0] === 'assets.purgeClipboardForTask')
  purgeHandler = purgeCall?.[1] as typeof purgeHandler
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

/** Seed a versioned asset (manifest + v1 file) linked to a task with a source kind. */
function seedAsset(assetId: string, taskId: string, sourceKind: string): string {
  const ym = `${assetId.slice(0, 4)}-${assetId.slice(4, 6)}`
  const dir = join(assetsRoot, 'store', ym, assetId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'v1.png'), 'test-content')
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    assetId, type: 'images', source: { kind: sourceKind, path: null },
    agent: 'user', taskId, created: 'c', updated: 'c',
    currentVersion: 1, description: '', tags: [],
    versions: [{
      version: 1, file: 'v1.png', thumb: null, mimeType: 'image/png', size: 12,
      width: null, height: null, created: 'c', description: '', tags: [],
      op: 'upload', parentVersion: null, tool: null, prompt: null, promptHash: null, generation: null,
    }],
    exports: [],
  }))
  return dir
}

describe('clipboard purge hook', () => {
  it('registers the purgeClipboardForTask hook', () => {
    expect(purgeHandler).toBeDefined()
  })

  it('does nothing when purgeClipboardOnComplete is disabled', async () => {
    const dir = seedAsset('20260404-clip-aaaaaaaa', 'task-purge-1', 'clipboard')
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: false })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId: 'task-purge-1' })
    expect(result).toEqual({ purged: 0 })
    expect(existsSync(dir)).toBe(true)
  })

  it('does nothing when no taskId provided', async () => {
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings
    const result = await purgeHandler!({})
    expect(result).toEqual({ purged: 0 })
  })

  it('purges clipboard assets when enabled', async () => {
    const taskId = 'task-purge-2'
    const dir = seedAsset('20260404-pasted-bbbbbbbb', taskId, 'clipboard')
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBeGreaterThanOrEqual(1)
    // The asset directory is trashed (moved out of store/).
    expect(existsSync(dir)).toBe(false)
  })

  it('preserves non-clipboard assets', async () => {
    const taskId = 'task-purge-3'
    const agentDir = seedAsset('20260404-agent-cccccccc', taskId, 'generated')
    const uploadDir = seedAsset('20260404-upload-dddddddd', taskId, 'upload')
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBe(0)
    expect(existsSync(agentDir)).toBe(true)
    expect(existsSync(uploadDir)).toBe(true)
  })
})
