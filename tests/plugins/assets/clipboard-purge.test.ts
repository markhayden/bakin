/**
 * Tests for clipboard asset purge on task completion.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-clipboard-purge-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => {
    const base = join(testDir, 'assets')
    return {
      'assets.text': join(base, 'text'),
      'assets.images': join(base, 'images'),
      'assets.video': join(base, 'video'),
      'assets.audio': join(base, 'audio'),
      'assets.plans': join(base, 'plans'),
      'assets.research': join(base, 'research'),
      'assets.pdf': join(base, 'pdf'),
      'assets.data': join(base, 'data'),
      'assets.other': join(base, 'other'),
    }
  },
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/watcher', () => ({
  registerSyncHook: vi.fn(),
}))

import assetsPlugin from '@bakin/assets'
import { buildIndex } from '@bakin/assets/lib/asset-index'

let plugin: ActivatedPlugin
let purgeHandler: ((data: Record<string, unknown>) => Promise<unknown>) | undefined

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)

  // Find the purge hook handler that was registered
  const registerCalls = (plugin.ctx.hooks.register as ReturnType<typeof vi.fn>).mock.calls
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
  const dir = join(assetsRoot, type, taskId)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, 'test-content')
  writeFileSync(`${filePath}.meta.json`, JSON.stringify({
    agent: 'user',
    taskId,
    created: new Date().toISOString(),
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
    createAsset('images', 'task-purge-1', '20260404-clip.png', 'clipboard')
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: false })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId: 'task-purge-1' })
    expect(result).toEqual({ purged: 0 })

    // File should still exist
    expect(existsSync(join(assetsRoot, 'images', 'task-purge-1', '20260404-clip.png'))).toBe(true)
  })

  it('does nothing when no taskId provided', async () => {
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings
    const result = await purgeHandler!({})
    expect(result).toEqual({ purged: 0 })
  })

  it('purges clipboard assets when enabled', async () => {
    const taskId = 'task-purge-2'
    createAsset('images', taskId, '20260404-pasted.png', 'clipboard')
    buildIndex() // Rebuild index to pick up the new file
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBeGreaterThanOrEqual(1)
  })

  it('preserves non-clipboard assets', async () => {
    const taskId = 'task-purge-3'
    createAsset('images', taskId, '20260404-agent-made.png', 'agent')
    createAsset('images', taskId, '20260404-uploaded.jpg', 'upload')
    buildIndex() // Rebuild index to pick up the new files
    plugin.ctx.getSettings = (() => ({ purgeClipboardOnComplete: true })) as typeof plugin.ctx.getSettings

    const result = await purgeHandler!({ taskId }) as { purged: number }
    expect(result.purged).toBe(0)

    // Files should still exist
    expect(existsSync(join(assetsRoot, 'images', taskId, '20260404-agent-made.png'))).toBe(true)
    expect(existsSync(join(assetsRoot, 'images', taskId, '20260404-uploaded.jpg'))).toBe(true)
  })
})
