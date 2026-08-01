/**
 * Pins the activate → onReady → indexer boundary.
 *
 * The memory plugin used to kick off its backfill with `void indexer.backfill`
 * inside `activate()`. Server startup in `server.ts` runs:
 *   pluginRegistry.initialize()     ← activate() here
 *   search adapter initialization
 *   createRegisteredTables()        ← bakin_memory created here
 *   runPendingReconciles()
 *   pluginRegistry.onAllReady()     ← onReady() here
 *
 * The backfill-in-activate path raced with table creation on a slow machine
 * and lost (April 2026 incident): every write hit "Endpoint not found:
 * /api/v1/tables/bakin_memory/batch" while offsets still advanced, which
 * then persisted an empty table forever. These tests lock in the fix so a
 * future refactor can't silently reintroduce the race.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-lifecycle-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-lifecycle-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-lifecycle-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({ watchFiles: mock() }))
mock.module('../../../packages/adapter-openclaw/src/home', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-lifecycle-mock`, 'openclaw')
  return {
    getOpenClawHome: () => base,
    getOpenClawPath: (...parts: string[]) => j(base, ...parts),
  }
})
mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({
    runtime: {
      adapter: 'openclaw',
      settings: {},
    },
    search: { adapter: 'antfly', settings: { auditTtl: null } },
  }),
}))
import { activatePlugin } from '../test-helpers'
import memoryPlugin from '../../../plugins/memory/index'
import { MemoryIndexer } from '../../../plugins/memory/lib/indexer'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

/** Flush the microtask queue so fire-and-forget promises settle. */
/** Drain microtasks + one macrotask. Not a settle — callers assert after it. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }
}

describe('memory plugin lifecycle — activate vs onReady', () => {
  it('activate() does NOT write to the search index', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    await flush()

    const index = activated.ctx.search.index as ReturnType<typeof mock>
    // No tier parser should have been able to fire yet — the table doesn't
    // exist at this point in server startup.
    expect(index).not.toHaveBeenCalled()
  })

  it('watcher events fired before onReady() do not reach the indexer', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    await flush()

    // Simulate a watcher event landing during the activate→onReady window.
    activated.ctx.events.emit('file.change', { file: '/tmp/audit.jsonl' })
    await flush()

    const index = activated.ctx.search.index as ReturnType<typeof mock>
    const remove = activated.ctx.search.remove as ReturnType<typeof mock>
    expect(index).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('onReady() unblocks the indexer without throwing', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    await flush()

    // Must not throw — onReady should be a no-throw contract.
    await expect(memoryPlugin.onReady?.()).resolves.toBeUndefined()
    await flush()

    // We don't assert that index() was called — the test harness has no
    // runtime agents to backfill from, so the indexer has nothing to do.
    // The point is: onReady ran and the plugin is still alive.
    expect(activated.ctx).toBeDefined()
  })

  it('post-onReady watcher events reach the indexer', async () => {
    // Reset module-level `ready` flag left behind by prior tests. Without
    // this, the pre-onReady assertion would flake on anything that runs
    // after the "unblocks without throwing" test above.
    await memoryPlugin.onShutdown?.()

    // Spy on the prototype BEFORE the plugin instantiates its indexer, so
    // the spy sees calls routed through the instance that activate() builds.
    const handleSpy = vi
      .spyOn(MemoryIndexer.prototype, 'handleWatcherEvent')
      .mockImplementation(async () => {})

    try {
      const activated = await activatePlugin(memoryPlugin, testDir)
      await flush()

      // Before onReady — event should be silently dropped by the `ready` gate.
      activated.ctx.events.emit('file.change', { file: '/tmp/pre-ready.jsonl' })
      await flush()
      expect(handleSpy).not.toHaveBeenCalled()

      await memoryPlugin.onReady?.()
      await flush()

      // After onReady — same event shape, this time it should reach the indexer.
      activated.ctx.events.emit('file.change', { file: '/tmp/post-ready.jsonl' })
      await flush()
      expect(handleSpy).toHaveBeenCalledWith('/tmp/post-ready.jsonl', 'change')
    } finally {
      handleSpy.mockRestore()
    }
  })

  it('onShutdown() unsubscribes watcher event handlers', async () => {
    await memoryPlugin.onShutdown?.()

    const handleSpy = vi
      .spyOn(MemoryIndexer.prototype, 'handleWatcherEvent')
      .mockImplementation(async () => {})

    try {
      const activated = await activatePlugin(memoryPlugin, testDir)
      await flush()

      await memoryPlugin.onReady?.()
      await flush()

      activated.ctx.events.emit('file.change', { file: '/tmp/before-shutdown.jsonl' })
      await flush()
      expect(handleSpy).toHaveBeenCalledTimes(1)

      await memoryPlugin.onShutdown?.()
      activated.ctx.events.emit('file.change', { file: '/tmp/after-shutdown.jsonl' })
      await flush()
      expect(handleSpy).toHaveBeenCalledTimes(1)
    } finally {
      handleSpy.mockRestore()
    }
  })
})
