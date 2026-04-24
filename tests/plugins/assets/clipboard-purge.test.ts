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
import { buildIndex } from '@bakin/assets/lib/asset-index'

let plugin: ActivatedPlugin
let purgeHandler: ((data: Record<string, unknown>) => Promise<unknown>) | undefined

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)

  // Find the purge hook handler that was registered
  const registerCalls = (plugin.ctx.hooks.register as ReturnType<typeof mock>).mock.calls
  const purgeCall = registerCalls.find((args: unknown[]) => args[0] === 'assets.purgeClipboardForTask')
  purgeHandler = purgeCall?.[1] as typeof purgeHandler
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function createAsset(
  type: string,
  taskId: string,
  filename: string,
  source: string,
): string {
  // Filename must be canonical (YYYYMMDD-slug-id8.ext) — the date prefix
  // determines the month shard under assets/store/{YYYY-MM}/.
  const ym = `${filename.slice(0, 4)}-${filename.slice(4, 6)}`
  const dir = join(assetsRoot, 'store', ym)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, 'test-content')
  writeFileSync(`${filePath}.meta.json`, JSON.stringify({
    agent: 'user',
    taskId,
    created: new Date().toISOString(),
    type,
    source,
  }))
  // Also need trash directory
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
  return filePath
}

describe('clipboard purge hook', () => {
  it('registers the purgeClipboardForTask hook', () => {
    expect(purgeHandler).toBeDefined()
  })

  it('does nothing when purgeClipboardOnComplete is disabled', async () => {
    const filename = '20260404-clip-aaaaaaaa.png'
    createAsset('images', 'task-purge-1', filename, 'clipboard')
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: false })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId: 'task-purge-1' })
    expect(result).toEqual({ purged: 0 })

    // File should still exist
    expect(existsSync(join(assetsRoot, 'store', '2026-04', filename))).toBe(true)
  })

  it('does nothing when no taskId provided', async () => {
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings
    const result = await purgeHandler!({})
    expect(result).toEqual({ purged: 0 })
  })

  it('purges clipboard assets when enabled', async () => {
    const taskId = 'task-purge-2'
    const filename = '20260404-pasted-bbbbbbbb.png'
    createAsset('images', taskId, filename, 'clipboard')
    buildIndex() // Rebuild index to pick up the new file
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBeGreaterThanOrEqual(1)
  })

  it('preserves non-clipboard assets', async () => {
    const taskId = 'task-purge-3'
    const agentFile = '20260404-agent-cccccccc.png'
    const uploadFile = '20260404-upload-dddddddd.jpg'
    createAsset('images', taskId, agentFile, 'agent')
    createAsset('images', taskId, uploadFile, 'upload')
    buildIndex() // Rebuild index to pick up the new files
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBe(0)

    // Files should still exist
    expect(existsSync(join(assetsRoot, 'store', '2026-04', agentFile))).toBe(true)
    expect(existsSync(join(assetsRoot, 'store', '2026-04', uploadFile))).toBe(true)
  })
})
