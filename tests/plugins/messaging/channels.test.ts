/**
 * Messaging plugin — channel feature tests.
 *
 * Tests configurable runtime channel IDs on routes and exec tools.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-channels-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be before any plugin imports
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
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

mock.module('../../../src/core/watcher', () => ({
  registerWatcher: mock(),
  unregisterWatcher: mock(),
}))

// Suppress SSE broadcast
;(globalThis as any).__bakinBroadcast = mock()

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

// Dynamic require — ES imports are hoisted above top-level `process.env`
// assignments, so messaging/storage.ts would call getContentDir() before
// BAKIN_HOME was set. require() runs in source order.
const messagingPlugin = require('../../../plugins/messaging/index').default as typeof import('../../../plugins/messaging/index').default
import type { CalendarItem } from '../../../plugins/messaging/types'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
  type ActivatedPlugin,
} from '../test-helpers'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  mkdirSync(join(testDir, 'messaging', 'sessions'), { recursive: true })
  writeFileSync(join(testDir, 'messaging.json'), '[]')
  plugin = await activatePlugin(messagingPlugin, testDir)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

beforeEach(() => {
  // Reset messaging.json between tests
  writeFileSync(join(testDir, 'messaging.json'), '[]')
})

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('Channel support — routes', () => {
  it('creates item with channels array via POST route', async () => {
    const route = findRoute(plugin.routes, 'POST', '/')!
    const result = await callRoute(route, plugin.ctx, {
      body: {
        title: 'Multi-channel post',
        agent: 'basil',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['general', 'announcements'],
      },
    })
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    const item = result.body.item as CalendarItem
    expect(item.channels).toEqual(['general', 'announcements'])
  })

  it('filters items by channel query param (channels array)', async () => {
    // Create items for different channels
    const postRoute = findRoute(plugin.routes, 'POST', '/')!
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'General only', agent: 'basil', scheduledAt: '2026-04-14T10:00:00Z', channels: ['general'] },
    })
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'Announcements only', agent: 'basil', scheduledAt: '2026-04-14T11:00:00Z', channels: ['announcements'] },
    })
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'Both', agent: 'basil', scheduledAt: '2026-04-14T12:00:00Z', channels: ['general', 'announcements'] },
    })

    const listRoute = findRoute(plugin.routes, 'GET', '/')!
    const general = await callRoute(listRoute, plugin.ctx, {
      searchParams: { channel: 'general' },
    })
    const generalItems = general.body.items as CalendarItem[]
    expect(generalItems.length).toBe(2) // 'General only' + 'Both'
    expect(generalItems.every(i => i.channels.includes('general'))).toBe(true)

    const announcements = await callRoute(listRoute, plugin.ctx, {
      searchParams: { channel: 'announcements' },
    })
    const announcementItems = announcements.body.items as CalendarItem[]
    expect(announcementItems.length).toBe(2) // 'Announcements only' + 'Both'
  })
})

// ---------------------------------------------------------------------------
// Exec tool tests
// ---------------------------------------------------------------------------

describe('Channel support — exec tools', () => {
  it('creates item with channels via exec tool', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
    const result = await callTool(tool, {
      title: 'Tool channels test',
      agent: 'scout',
      scheduledAt: '2026-04-15T09:00:00Z',
      channels: ['email', 'twitter'],
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['email', 'twitter'])
  })

  it('defaults to general when channels are omitted', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
    const result = await callTool(tool, {
      title: 'Default channel test',
      agent: 'nemo',
      scheduledAt: '2026-04-15T10:00:00Z',
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['general'])
  })

  it('stores explicit channels array', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
    const result = await callTool(tool, {
      title: 'Single channel test',
      agent: 'zen',
      scheduledAt: '2026-04-15T11:00:00Z',
      channels: ['announcements'],
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['announcements'])
  })

  it('filters by channel via list exec tool', async () => {
    // Clear and seed
    writeFileSync(join(testDir, 'messaging.json'), JSON.stringify([
      {
        id: 'ch-1', createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
        scheduledAt: '2026-04-15T10:00:00Z', agent: 'basil',
        channels: ['general', 'youtube'], contentType: 'tip',
        title: 'YT+DC', brief: '', tone: 'calm', status: 'draft',
      },
      {
        id: 'ch-2', createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
        scheduledAt: '2026-04-15T11:00:00Z', agent: 'basil',
        channels: ['announcements'], contentType: 'tip',
        title: 'IG only', brief: '', tone: 'calm', status: 'draft',
      },
    ]))

    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
    const result = await callTool(tool, { channel: 'youtube' })
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect((result.items as CalendarItem[])[0].id).toBe('ch-1')
  })

  it('list exec tool returns channels field', async () => {
    writeFileSync(join(testDir, 'messaging.json'), JSON.stringify([
      {
        id: 'ch-3', createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
        scheduledAt: '2026-04-15T10:00:00Z', agent: 'basil',
        channels: ['general', 'tiktok'], contentType: 'tip',
        title: 'Has channels', brief: '', tone: 'calm', status: 'draft',
      },
    ]))

    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
    const result = await callTool(tool, {})
    const items = result.items as Record<string, unknown>[]
    expect(items[0].channels).toEqual(['general', 'tiktok'])
  })
})
