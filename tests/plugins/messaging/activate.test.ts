/**
 * Messaging plugin — activate / settings seeding.
 *
 * Verifies that the plugin seeds DEFAULT_CONTENT_TYPES on first activate
 * and remains idempotent on re-activation when contentTypes are already
 * present in settings.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-messaging-activate-${Date.now()}`)
})

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../../src/core/openclaw-client', () => ({
  sendChannelMessage: vi.fn(),
}))

;(globalThis as any).__bakinBroadcast = vi.fn()

import messagingPlugin from '../../../plugins/messaging/index'
import { DEFAULT_CONTENT_TYPES } from '../../../plugins/messaging/types'
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
    vi.clearAllMocks()
  })

  it('seeds DEFAULT_CONTENT_TYPES on first activate when settings lack contentTypes', async () => {
    const { ctx } = createTestContext('messaging', testDir)
    // Default getSettings mock returns {} — no contentTypes present.
    const updateSpy = vi.fn()
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
    const updateSpy = vi.fn()
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
    const updateSpy = vi.fn()
    ctx.updateSettings = updateSpy

    await messagingPlugin.activate(ctx)

    expect(updateSpy).toHaveBeenCalledWith({ contentTypes: DEFAULT_CONTENT_TYPES })
  })
})
