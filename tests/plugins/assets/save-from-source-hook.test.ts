/**
 * Tests for the assets.saveFromSource hook — core's sanctioned path for
 * persisting salvaged/system files as managed assets (HookRegistry, since
 * core can't call plugin exec tools).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-save-from-source-${Date.now()}`)
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

type HookHandler = (data: Record<string, unknown>) => Promise<{ assetId: string; version: number; changed: boolean }>

let plugin: ActivatedPlugin
let saveHandler: HookHandler | undefined

beforeAll(async () => {
  mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)

  const registerCalls = (plugin.ctx.hooks.register as ReturnType<typeof mock>).mock.calls
  const saveCall = registerCalls.find((args: unknown[]) => args[0] === 'assets.saveFromSource')
  saveHandler = saveCall?.[1] as HookHandler | undefined
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('assets.saveFromSource hook', () => {
  it('is registered', () => {
    expect(saveHandler).toBeDefined()
  })

  it('saves a workspace file as a task-linked asset', async () => {
    const sourceDir = join(testDir, 'tasks', 'salvage')
    mkdirSync(sourceDir, { recursive: true })
    const filePath = join(sourceDir, 't-100-d1.md')
    writeFileSync(filePath, '# Salvaged partial output\n\nsix half-finished deliverables…')

    const result = await saveHandler!({
      filePath,
      taskId: 't-100',
      agent: 'jessica',
      type: 'text',
      description: 'Salvaged output from dead session',
      tags: ['salvaged-output'],
      tool: 'session-forensics',
    })

    expect(result.assetId).toBeDefined()
    expect(result.version).toBe(1)
    expect(result.changed).toBe(true)
  })

  it('is idempotent: re-saving the same unchanged source path is a no-op, changed content bumps the version', async () => {
    const sourceDir = join(testDir, 'tasks', 'salvage')
    mkdirSync(sourceDir, { recursive: true })
    const filePath = join(sourceDir, 't-200-d1.md')
    writeFileSync(filePath, 'attempt one salvage')

    const first = await saveHandler!({ filePath, taskId: 't-200', agent: 'jessica', type: 'text' })
    expect(first.changed).toBe(true)

    const again = await saveHandler!({ filePath, taskId: 't-200', agent: 'jessica', type: 'text' })
    expect(again.assetId).toBe(first.assetId)
    expect(again.changed).toBe(false)
    expect(again.version).toBe(first.version)

    writeFileSync(filePath, 'attempt two salvage — different content')
    const bumped = await saveHandler!({ filePath, taskId: 't-200', agent: 'jessica', type: 'text' })
    expect(bumped.assetId).toBe(first.assetId)
    expect(bumped.changed).toBe(true)
    expect(bumped.version).toBe(first.version + 1)
  })

  it('rejects a missing filePath', async () => {
    await expect(saveHandler!({ taskId: 't-300', agent: 'jessica', type: 'text' })).rejects.toThrow('filePath')
  })
})
