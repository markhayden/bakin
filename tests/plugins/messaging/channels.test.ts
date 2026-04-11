/**
 * Calendar plugin — channel feature tests.
 *
 * Tests configurable channels on routes, exec tools, and backward compatibility
 * with the legacy single `channel` field.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-channels-${Date.now()}`)
})

// ---------------------------------------------------------------------------
// Mocks — must be before any plugin imports
// ---------------------------------------------------------------------------

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

vi.mock('../../../src/core/watcher', () => ({
  registerWatcher: vi.fn(),
  unregisterWatcher: vi.fn(),
}))

vi.mock('../../../plugins/messaging/lib/gateway', () => ({
  streamChatCompletion: vi.fn(async () => new Response('data: [DONE]\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  })),
  chatCompletion: vi.fn(async () => 'mock response'),
}))

// Suppress SSE broadcast
;(globalThis as any).__bakinBroadcast = vi.fn()

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import messagingPlugin from '../../../plugins/messaging/index'
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

function readCalendar(): CalendarItem[] {
  return JSON.parse(readFileSync(join(testDir, 'messaging.json'), 'utf-8'))
}

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('Channel support — routes', () => {
  it('creates item with channels array via POST route', async () => {
    const route = findRoute(plugin.routes, 'POST', '/')!
    const result = await callRoute(route, plugin.ctx, {
      body: {
        title: 'Multi-channel post',
        agent: 'chef',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['discord', 'instagram'],
      },
    })
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    const item = result.body.item as CalendarItem
    expect(item.channels).toEqual(['discord', 'instagram'])
  })

  it('filters items by channel query param (channels array)', async () => {
    // Create items for different channels
    const postRoute = findRoute(plugin.routes, 'POST', '/')!
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'Discord only', agent: 'chef', scheduledAt: '2026-04-14T10:00:00Z', channels: ['discord'] },
    })
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'Instagram only', agent: 'chef', scheduledAt: '2026-04-14T11:00:00Z', channels: ['instagram'] },
    })
    await callRoute(postRoute, plugin.ctx, {
      body: { title: 'Both', agent: 'chef', scheduledAt: '2026-04-14T12:00:00Z', channels: ['discord', 'instagram'] },
    })

    const listRoute = findRoute(plugin.routes, 'GET', '/')!
    const discord = await callRoute(listRoute, plugin.ctx, {
      searchParams: { channel: 'discord' },
    })
    const discordItems = discord.body.items as CalendarItem[]
    expect(discordItems.length).toBe(2) // 'Discord only' + 'Both'
    expect(discordItems.every(i => i.channels?.includes('discord'))).toBe(true)

    const instagram = await callRoute(listRoute, plugin.ctx, {
      searchParams: { channel: 'instagram' },
    })
    const igItems = instagram.body.items as CalendarItem[]
    expect(igItems.length).toBe(2) // 'Instagram only' + 'Both'
  })

  it('backward compat: filters by legacy channel field', async () => {
    // Write an old-style item with channel but no channels array
    const items = readCalendar()
    items.push({
      id: 'legacy-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledAt: '2026-04-14T10:00:00Z',
      agent: 'chef',
      channel: 'discord',
      channelTarget: '123',
      contentType: 'tip',
      title: 'Legacy item',
      brief: '',
      tone: 'calm',
      status: 'draft',
    } as CalendarItem)
    writeFileSync(join(testDir, 'messaging.json'), JSON.stringify(items))

    const listRoute = findRoute(plugin.routes, 'GET', '/')!
    const result = await callRoute(listRoute, plugin.ctx, {
      searchParams: { channel: 'discord' },
    })
    const filtered = result.body.items as CalendarItem[]
    expect(filtered.some(i => i.id === 'legacy-1')).toBe(true)
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
      agent: 'explorer',
      scheduledAt: '2026-04-15T09:00:00Z',
      channels: ['email', 'twitter'],
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['email', 'twitter'])
  })

  it('defaults to discord channel when neither channels nor channel provided', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
    const result = await callTool(tool, {
      title: 'Default channel test',
      agent: 'trainer',
      scheduledAt: '2026-04-15T10:00:00Z',
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['discord'])
  })

  it('uses single channel param as channels array', async () => {
    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
    const result = await callTool(tool, {
      title: 'Single channel test',
      agent: 'coach',
      scheduledAt: '2026-04-15T11:00:00Z',
      channel: 'instagram',
    })
    expect(result.ok).toBe(true)
    const item = result.item as CalendarItem
    expect(item.channels).toEqual(['instagram'])
  })

  it('filters by channel via list exec tool', async () => {
    // Clear and seed
    writeFileSync(join(testDir, 'messaging.json'), JSON.stringify([
      {
        id: 'ch-1', createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
        scheduledAt: '2026-04-15T10:00:00Z', agent: 'chef', channel: 'discord',
        channels: ['discord', 'youtube'], channelTarget: '123', contentType: 'tip',
        title: 'YT+DC', brief: '', tone: 'calm', status: 'draft',
      },
      {
        id: 'ch-2', createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
        scheduledAt: '2026-04-15T11:00:00Z', agent: 'chef', channel: 'instagram',
        channels: ['instagram'], channelTarget: '456', contentType: 'tip',
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
        scheduledAt: '2026-04-15T10:00:00Z', agent: 'chef', channel: 'discord',
        channels: ['discord', 'tiktok'], channelTarget: '123', contentType: 'tip',
        title: 'Has channels', brief: '', tone: 'calm', status: 'draft',
      },
    ]))

    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
    const result = await callTool(tool, {})
    const items = result.items as Record<string, unknown>[]
    expect(items[0].channels).toEqual(['discord', 'tiktok'])
  })
})
