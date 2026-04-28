/**
 * Messaging plugin — activate / settings seeding.
 *
 * Verifies that the plugin seeds DEFAULT_CONTENT_TYPES on first activate
 * and remains idempotent on re-activation when contentTypes are already
 * present in settings.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-messaging-activate-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

;(globalThis as any).__bakinBroadcast = mock()

// Dynamic require — ES imports are hoisted above mock.module registrations, so
// plugins/messaging/lib/storage.ts would evaluate getContentDir before the mock
// takes effect. Using require() defers the load until after mocks are set.
const messagingPlugin = require('../../../plugins/messaging/index').default as typeof import('../../../plugins/messaging/index').default
const { DEFAULT_CONTENT_TYPES } = require('../../../plugins/messaging/types') as typeof import('../../../plugins/messaging/types')
import type messagingPluginType from '../../../plugins/messaging/index'
import type { MessagingSettings } from '../../../plugins/messaging/types'
import { createTestContext } from '../test-helpers'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('messaging plugin — activate', () => {
  beforeEach(() => {
    mock.clearAllMocks()
  })

  it('seeds DEFAULT_CONTENT_TYPES on first activate when settings lack contentTypes', async () => {
    const { ctx } = createTestContext('messaging', testDir)
    // Default getSettings mock returns {} — no contentTypes present.
    const updateSpy = mock()
    ctx.updateSettings = updateSpy

    await messagingPlugin.activate(ctx)

    expect(updateSpy).toHaveBeenCalledWith({ contentTypes: DEFAULT_CONTENT_TYPES })
  })

  it('is idempotent — no seed when contentTypes already populated', async () => {
    const { ctx } = createTestContext('messaging', testDir)
    const existing: MessagingSettings = {
      contentTypes: [{ id: 'recipe', label: 'Recipe' }, { id: 'tip', label: 'Tip' }],
    }
    ctx.getSettings = (() => existing) as typeof ctx.getSettings
    const updateSpy = mock()
    ctx.updateSettings = updateSpy

    await messagingPlugin.activate(ctx)

    // updateSettings may still be called by other activate logic, but NOT
    // for the contentTypes seed path.
    for (const call of updateSpy.mock.calls) {
      expect(call[0]).not.toHaveProperty('contentTypes')
    }
  })

  it('seeds when contentTypes exists but is empty', async () => {
    const { ctx } = createTestContext('messaging', testDir)
    ctx.getSettings = (() => ({ contentTypes: [] })) as typeof ctx.getSettings
    const updateSpy = mock()
    ctx.updateSettings = updateSpy

    await messagingPlugin.activate(ctx)

    expect(updateSpy).toHaveBeenCalledWith({ contentTypes: DEFAULT_CONTENT_TYPES })
  })
})
