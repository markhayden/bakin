/**
 * Messaging plugin — route and exec tool tests.
 *
 * Tests the original 8 HTTP routes and 7 exec tools registered by the messaging plugin.
 * Uses a temp directory backed by the real storage module (messaging.json on disk).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-messaging-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be before any plugin imports
// ---------------------------------------------------------------------------

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

// Suppress SSE broadcast
;(globalThis as any).__bakinBroadcast = mock()

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const messagingPlugin = require('../../../plugins/messaging/index').default as typeof import('../../../plugins/messaging/index').default
import type { CalendarItem } from '../../../plugins/messaging/types'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callSearchRoute,
  callTool,
} from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

type RuntimeSend = ActivatedPlugin['ctx']['runtime']['messaging']['send']
type RuntimeStream = ActivatedPlugin['ctx']['runtime']['messaging']['stream']

let mockRuntimeSend = mock(async () => ({ id: 'runtime-msg', content: '' }))
let mockRuntimeStream = mock(() => emptyRuntimeStream())

async function* emptyRuntimeStream(): AsyncIterable<never> {
  const items: never[] = []
  for (const item of items) yield item
}

function installRuntimeMessagingMocks(): void {
  plugin.ctx.runtime.messaging.send = mockRuntimeSend as RuntimeSend
  plugin.ctx.runtime.messaging.stream = mockRuntimeStream as RuntimeStream
}

function resetRuntimeMessagingMocks(): void {
  mockRuntimeSend = mock(async () => ({ id: 'runtime-msg', content: '' }))
  mockRuntimeStream = mock(() => emptyRuntimeStream())
  installRuntimeMessagingMocks()
}

function sendRuntimeResponse(content: string): void {
  mockRuntimeSend.mockImplementationOnce(async () => ({ id: 'runtime-msg', content }))
}

// ---------------------------------------------------------------------------
// Seed data helpers
// ---------------------------------------------------------------------------

function seedItems(items: CalendarItem[]): void {
  writeFileSync(join(testDir, 'messaging.json'), JSON.stringify(items, null, 2))
}

function makeItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'item-1',
    title: 'Test Post',
    agent: 'basil',
    channels: ['general'],
    contentType: 'tip',
    tone: 'conversational',
    scheduledAt: '2026-04-10T12:00:00Z',
    brief: 'A test brief',
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  seedItems([])
  plugin = await activatePlugin(messagingPlugin, testDir)
  installRuntimeMessagingMocks()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Reset to empty messaging before each test
  seedItems([])
  mock.clearAllMocks()
  resetRuntimeMessagingMocks()
})

// ===========================================================================
// ROUTES
// ===========================================================================

describe('Calendar routes', () => {
  // ── GET / ───────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'GET', '/')).toBeDefined()
    })

    it('returns empty items when calendar is empty', async () => {
      const route = findRoute(plugin.routes, 'GET', '/')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      expect(body.items).toEqual([])
    })

    it('returns all seeded items', async () => {
      seedItems([makeItem({ id: 'a' }), makeItem({ id: 'b' })])
      const route = findRoute(plugin.routes, 'GET', '/')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      expect((body.items as unknown[]).length).toBe(2)
    })

    it('filters by month query param', async () => {
      seedItems([
        makeItem({ id: 'apr', scheduledAt: '2026-04-10T12:00:00Z' }),
        makeItem({ id: 'may', scheduledAt: '2026-05-10T12:00:00Z' }),
      ])
      const route = findRoute(plugin.routes, 'GET', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
        path: '/?month=2026-04',
        searchParams: { month: '2026-04' },
      })
      const items = body.items as CalendarItem[]
      expect(items.length).toBe(1)
      expect(items[0].id).toBe('apr')
    })

    it('sorts items by scheduledAt descending', async () => {
      seedItems([
        makeItem({ id: 'early', scheduledAt: '2026-04-01T00:00:00Z' }),
        makeItem({ id: 'late', scheduledAt: '2026-04-30T00:00:00Z' }),
      ])
      const route = findRoute(plugin.routes, 'GET', '/')!
      const { body } = await callRoute(route, plugin.ctx)
      const items = body.items as CalendarItem[]
      expect(items[0].id).toBe('late')
      expect(items[1].id).toBe('early')
    })
  })

  // ── POST / ──────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/')).toBeDefined()
    })

    it('creates a new item', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {
          title: 'New Post',
          agent: 'scout',
          scheduledAt: '2026-04-15T10:00:00Z',
          channels: ['general'],
          contentType: 'recipe',
          tone: 'energetic',
          brief: 'Make something tasty',
        },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.item as CalendarItem).title).toBe('New Post')
      expect((body.item as CalendarItem).id).toBeDefined()
    })

    it('returns 400 when required fields are missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { title: 'No Agent' },
      })
      expect(status).toBe(400)
      expect(body.error).toBeDefined()
    })

    it('defaults channels to general and status to draft', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
        body: { title: 'Defaults Test', agent: 'nemo', scheduledAt: '2026-04-20T08:00:00Z' },
      })
      const item = body.item as CalendarItem
      expect(item.channels).toEqual(['general'])
      expect(item.status).toBe('draft')
    })

    it('emits audit and activity log', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      await callRoute(route, plugin.ctx, {
        body: { title: 'Audit Test', agent: 'zen', scheduledAt: '2026-04-20T08:00:00Z' },
      })
      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith(
        'item.created',
        'zen',
        expect.objectContaining({ title: 'Audit Test' }),
      )
      expect(plugin.ctx.activity.log).toHaveBeenCalled()
    })
  })

  // ── PUT /:itemId ────────────────────────────────────────────────────────

  describe('PUT /:itemId', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'PUT', '/:itemId')).toBeDefined()
    })

    it('updates an existing item', async () => {
      seedItems([makeItem({ id: 'upd-1', title: 'Original' })])
      const route = findRoute(plugin.routes, 'PUT', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'upd-1' },
        body: { title: 'Updated Title' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.item as CalendarItem).title).toBe('Updated Title')
    })

    it('returns 404 for non-existent item', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'does-not-exist' },
        body: { title: 'Nope' },
      })
      expect(status).toBe(404)
      expect(body.error).toBeDefined()
    })

    it('returns 400 when no id is provided', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toBe('id required')
    })

    it('can use id from request body when searchParam missing', async () => {
      seedItems([makeItem({ id: 'body-id', title: 'Body ID' })])
      const route = findRoute(plugin.routes, 'PUT', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { id: 'body-id', title: 'Via Body' },
      })
      expect(status).toBe(200)
      expect((body.item as CalendarItem).title).toBe('Via Body')
    })
  })

  // ── DELETE /:itemId ─────────────────────────────────────────────────────

  describe('DELETE /:itemId', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'DELETE', '/:itemId')).toBeDefined()
    })

    it('deletes an existing item', async () => {
      seedItems([makeItem({ id: 'del-1' })])
      const route = findRoute(plugin.routes, 'DELETE', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'del-1' },
        body: {},
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)

      // Verify item is gone
      const raw = JSON.parse(readFileSync(join(testDir, 'messaging.json'), 'utf-8'))
      expect(raw.length).toBe(0)
    })

    it('returns 400 when no id is provided', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:itemId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toBe('id required')
    })
  })

  // ── POST /:itemId/approve ──────────────────────────────────────────────

  describe('POST /:itemId/approve', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/:itemId/approve')).toBeDefined()
    })

    it('approves a draft item to scheduled', async () => {
      seedItems([makeItem({ id: 'appr-1', status: 'draft' })])
      const route = findRoute(plugin.routes, 'POST', '/:itemId/approve')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'appr-1' },
        body: {},
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.item as CalendarItem).status).toBe('scheduled')
    })

    it('approves a review item to published (mocking execFile)', async () => {
      seedItems([makeItem({ id: 'appr-2', status: 'review', draft: { caption: 'Hello!' } })])
      const sendMessage = mock(async () => ({ deliveries: [] }))
      plugin.ctx.runtime.channels.sendMessage = sendMessage

      const route = findRoute(plugin.routes, 'POST', '/:itemId/approve')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'appr-2' },
        body: {},
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.item as CalendarItem).status).toBe('published')
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        channels: ['general'],
        message: expect.objectContaining({
          body: 'Hello!',
        }),
      }))
    })

    it('returns 404 for non-existent item', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:itemId/approve')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'ghost' },
        body: {},
      })
      expect(status).toBe(404)
      expect(body.error).toBe('Item not found')
    })

    it('returns 400 for item in non-approvable status', async () => {
      seedItems([makeItem({ id: 'appr-3', status: 'executing' })])
      const route = findRoute(plugin.routes, 'POST', '/:itemId/approve')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'appr-3' },
        body: {},
      })
      expect(status).toBe(400)
      expect((body.error as string)).toContain('Cannot approve')
    })

    it('returns 400 when no id provided', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:itemId/approve')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toBe('id required')
    })
  })

  // ── POST /:itemId/reject ───────────────────────────────────────────────

  describe('POST /:itemId/reject', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/:itemId/reject')).toBeDefined()
    })

    it('rejects a review item back to draft', async () => {
      seedItems([makeItem({ id: 'rej-1', status: 'review' })])
      const route = findRoute(plugin.routes, 'POST', '/:itemId/reject')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'rej-1' },
        body: { note: 'Needs more work' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect((body.item as CalendarItem).status).toBe('draft')
      expect((body.item as CalendarItem).rejectionNote).toBe('Needs more work')
    })

    it('returns 400 for non-review item', async () => {
      seedItems([makeItem({ id: 'rej-2', status: 'draft' })])
      const route = findRoute(plugin.routes, 'POST', '/:itemId/reject')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'rej-2' },
        body: {},
      })
      expect(status).toBe(400)
      expect((body.error as string)).toContain('review')
    })

    it('returns 404 for non-existent item', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:itemId/reject')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { itemId: 'nope' },
        body: {},
      })
      expect(status).toBe(404)
    })

    it('returns 400 when no id provided', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:itemId/reject')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
    })
  })

  // ── POST /brainstorm ───────────────────────────────────────────────────

  describe('POST /brainstorm', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/brainstorm')).toBeDefined()
    })

    it('returns 400 when agentId or message missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/brainstorm')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { agentId: 'basil' },
      })
      expect(status).toBe(400)
      expect(body.error).toBeDefined()
    })

    it('calls runtime completion and returns response with suggestions', async () => {
      // Set up persona file
      const personaDir = join(testDir, 'team', 'personas')
      mkdirSync(personaDir, { recursive: true })
      writeFileSync(join(personaDir, 'basil.md'), '# Basil\nA nutrition-focused agent.')

      sendRuntimeResponse(
        `Great ideas coming up!\n\n\`\`\`json\n[{"title":"Morning Smoothie","scheduledAt":"2026-04-15T09:00:00Z","contentType":"recipe","tone":"energetic","brief":"A vibrant smoothie recipe post"}]\n\`\`\``,
      )

      const route = findRoute(plugin.routes, 'POST', '/brainstorm')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {
          agentId: 'basil',
          message: 'I need some recipe ideas for next week',
          history: [],
        },
      })

      expect(status).toBe(200)
      expect(body.response).toBe('Great ideas coming up!')
      expect(body.suggestions).toEqual([
        expect.objectContaining({
          title: 'Morning Smoothie',
          contentType: 'recipe',
          tone: 'energetic',
        }),
      ])
      expect(mockRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'basil',
      }))
    })
  })
})

// ===========================================================================
// EXEC TOOLS
// ===========================================================================

describe('Calendar exec tools', () => {
  // ── bakin_exec_messaging_list ────────────────────────────────────────────

  describe('bakin_exec_messaging_list', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_list')).toBeDefined()
    })

    it('returns all items when no filters', async () => {
      seedItems([makeItem({ id: 'l1' }), makeItem({ id: 'l2' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.count).toBe(2)
      expect((result.items as unknown[]).length).toBe(2)
    })

    it('filters by month', async () => {
      seedItems([
        makeItem({ id: 'apr', scheduledAt: '2026-04-10T12:00:00Z' }),
        makeItem({ id: 'may', scheduledAt: '2026-05-10T12:00:00Z' }),
      ])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
      const result = await callTool(tool, { month: '2026-05' })
      expect(result.count).toBe(1)
      expect((result.items as any[])[0].id).toBe('may')
    })

    it('filters by status', async () => {
      seedItems([
        makeItem({ id: 'draft1', status: 'draft' }),
        makeItem({ id: 'pub1', status: 'published' }),
      ])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
      const result = await callTool(tool, { status: 'published' })
      expect(result.count).toBe(1)
      expect((result.items as any[])[0].id).toBe('pub1')
    })

    it('filters by agent', async () => {
      seedItems([
        makeItem({ id: 'basil1', agent: 'basil' }),
        makeItem({ id: 'scout1', agent: 'scout' }),
      ])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
      const result = await callTool(tool, { agent: 'scout' })
      expect(result.count).toBe(1)
      expect((result.items as any[])[0].id).toBe('scout1')
    })

    it('returns summary fields only (no draft or brief)', async () => {
      seedItems([makeItem({ id: 'summary', draft: { caption: 'secret' } })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_list')!
      const result = await callTool(tool, {})
      const item = (result.items as any[])[0]
      expect(item.id).toBe('summary')
      expect(item.draft).toBeUndefined()
      expect(item.brief).toBeUndefined()
    })
  })

  // ── bakin_exec_messaging_get ────────────────────────────────────────────

  describe('bakin_exec_messaging_get', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_get')).toBeDefined()
    })

    it('returns a single item with full details', async () => {
      seedItems([makeItem({ id: 'get-1', title: 'Full Details', brief: 'The brief' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_get')!
      const result = await callTool(tool, { itemId: 'get-1' })
      expect(result.ok).toBe(true)
      expect((result.item as CalendarItem).title).toBe('Full Details')
      expect((result.item as CalendarItem).brief).toBe('The brief')
    })

    it('returns error for missing itemId', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_get')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toBe('itemId required')
    })

    it('returns error for non-existent item', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_get')!
      const result = await callTool(tool, { itemId: 'no-such-id' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Item not found')
    })
  })

  // ── bakin_exec_messaging_create ─────────────────────────────────────────

  describe('bakin_exec_messaging_create', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_create')).toBeDefined()
    })

    it('creates a new item with all fields', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
      const result = await callTool(tool, {
        title: 'Tool Created',
        agent: 'nemo',
        scheduledAt: '2026-04-18T14:00:00Z',
        channels: ['general'],
        contentType: 'workout',
        tone: 'energetic',
        brief: 'High energy workout post',
        status: 'scheduled',
      })
      expect(result.ok).toBe(true)
      const item = result.item as CalendarItem
      expect(item.title).toBe('Tool Created')
      expect(item.agent).toBe('nemo')
      expect(item.status).toBe('scheduled')
      expect(item.contentType).toBe('workout')
      expect(item.id).toBeDefined()
    })

    it('applies defaults for optional fields', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
      const result = await callTool(tool, {
        title: 'Minimal',
        agent: 'basil',
        scheduledAt: '2026-04-18T14:00:00Z',
      })
      expect(result.ok).toBe(true)
      const item = result.item as CalendarItem
      expect(item.channels).toEqual(['general'])
      expect(item.contentType).toBe('post')
      expect(item.tone).toBe('conversational')
      expect(item.status).toBe('draft')
    })

    it('returns error when required fields are missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
      const result = await callTool(tool, { title: 'No agent' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('required')
    })

    it('emits audit event on creation', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_create')!
      await callTool(tool, {
        title: 'Audit Check',
        agent: 'zen',
        scheduledAt: '2026-04-20T10:00:00Z',
      }, 'zen')
      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith(
        'item.created',
        'zen',
        expect.objectContaining({ title: 'Audit Check' }),
      )
    })
  })

  // ── bakin_exec_messaging_update ─────────────────────────────────────────

  describe('bakin_exec_messaging_update', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_update')).toBeDefined()
    })

    it('updates an existing item', async () => {
      seedItems([makeItem({ id: 'tool-upd-1', title: 'Before' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_update')!
      const result = await callTool(tool, { itemId: 'tool-upd-1', title: 'After' })
      expect(result.ok).toBe(true)
      expect((result.item as CalendarItem).title).toBe('After')
    })

    it('returns error when itemId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_update')!
      const result = await callTool(tool, { title: 'No ID' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('itemId required')
    })

    it('returns error for non-existent item', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_update')!
      const result = await callTool(tool, { itemId: 'fake-id', title: 'Nope' })
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('updates multiple fields at once', async () => {
      seedItems([makeItem({ id: 'multi-upd', title: 'Old', tone: 'calm', brief: 'Old brief' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_update')!
      const result = await callTool(tool, {
        itemId: 'multi-upd',
        title: 'New',
        tone: 'energetic',
        brief: 'New brief',
      })
      expect(result.ok).toBe(true)
      const item = result.item as CalendarItem
      expect(item.title).toBe('New')
      expect(item.tone).toBe('energetic')
      expect(item.brief).toBe('New brief')
    })
  })

  // ── bakin_exec_messaging_approve ────────────────────────────────────────

  describe('bakin_exec_messaging_approve', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_approve')).toBeDefined()
    })

    it('approves draft to scheduled', async () => {
      seedItems([makeItem({ id: 'tool-appr-1', status: 'draft' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_approve')!
      const result = await callTool(tool, { itemId: 'tool-appr-1' })
      expect(result.ok).toBe(true)
      expect(result.newStatus).toBe('scheduled')
      expect((result.item as CalendarItem).status).toBe('scheduled')
    })

    it('returns error for missing itemId', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_approve')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('itemId required')
    })

    it('returns error for non-existent item', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_approve')!
      const result = await callTool(tool, { itemId: 'phantom' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Item not found')
    })

    it('returns error for non-approvable status', async () => {
      seedItems([makeItem({ id: 'tool-appr-bad', status: 'executing' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_approve')!
      const result = await callTool(tool, { itemId: 'tool-appr-bad' })
      expect(result.ok).toBe(false)
      expect((result.error as string)).toContain('Cannot approve')
    })
  })

  // ── bakin_exec_messaging_reject ─────────────────────────────────────────

  describe('bakin_exec_messaging_reject', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_reject')).toBeDefined()
    })

    it('rejects a review item back to draft', async () => {
      seedItems([makeItem({ id: 'tool-rej-1', status: 'review', title: 'Review Me' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      const result = await callTool(tool, { itemId: 'tool-rej-1', note: 'Try again' })
      expect(result.ok).toBe(true)
      expect((result.item as CalendarItem).status).toBe('draft')
      expect((result.item as CalendarItem).rejectionNote).toBe('Try again')
    })

    it('rejects without a note', async () => {
      seedItems([makeItem({ id: 'tool-rej-2', status: 'review' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      const result = await callTool(tool, { itemId: 'tool-rej-2' })
      expect(result.ok).toBe(true)
      expect((result.item as CalendarItem).status).toBe('draft')
    })

    it('returns error for missing itemId', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
    })

    it('returns error for non-existent item', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      const result = await callTool(tool, { itemId: 'missing' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Item not found')
    })

    it('returns error for non-review item', async () => {
      seedItems([makeItem({ id: 'tool-rej-3', status: 'scheduled' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      const result = await callTool(tool, { itemId: 'tool-rej-3' })
      expect(result.ok).toBe(false)
      expect((result.error as string)).toContain('review')
    })

    it('emits audit and activity log on rejection', async () => {
      seedItems([makeItem({ id: 'tool-rej-4', status: 'review', title: 'Logged Reject' })])
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_reject')!
      await callTool(tool, { itemId: 'tool-rej-4', note: 'Feedback' })
      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith(
        'item.rejected',
        'system',
        expect.objectContaining({ itemId: 'tool-rej-4', note: 'Feedback' }),
      )
    })
  })
})

// ===========================================================================
// Search route (auto-registered via ctx.search.registerFileBackedContentType)
// ===========================================================================

describe('GET /search — auto-registered brainstorm search', () => {
  beforeEach(() => {
    // Reset seeded results between tests
    plugin.seedResults([])
  })

  it('returns 200 with seeded brainstorm results on a happy-path query', async () => {
    plugin.seedResults([
      {
        id: 'brainstorm-sess-1',
        table: 'bakin_messaging_brainstorm',
        score: 0.92,
        fields: {
          session_id: 'sess-1',
          title: 'Week 16 recipes',
          status: 'active',
          agent_id: 'basil',
          message_body: 'Looking for spring smoothies',
        },
      },
      {
        id: 'brainstorm-sess-2',
        table: 'bakin_messaging_brainstorm',
        score: 0.74,
        fields: {
          session_id: 'sess-2',
          title: 'Outdoor sprint',
          status: 'completed',
          agent_id: 'scout',
          message_body: 'Outdoor activity ideas',
        },
      },
    ])

    const { status, body } = await callSearchRoute(plugin, 'recipes')
    expect(status).toBe(200)
    const results = body.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('brainstorm-sess-1')
    expect(results[0].table).toBe('bakin_messaging_brainstorm')
    expect((results[0].fields as Record<string, unknown>).agent_id).toBe('basil')
  })

  it('returns 400 when q is missing', async () => {
    const route = findRoute(plugin.routes, 'GET', '/search')!
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route, plugin.ctx)
    expect(status).toBe(400)
    expect(body.error).toMatch(/[Mm]issing/)
  })

  it('passes the actual brainstorm facets (status, agent_id) through to ctx.search.query', async () => {
    plugin.seedResults([])
    await callSearchRoute(plugin, 'anything', { facets: 'status,agent_id' })

    expect(plugin.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'anything',
        facets: ['status', 'agent_id'],
      }),
    )
  })

  it('returns 200 with empty results when seed is empty', async () => {
    plugin.seedResults([])

    const { status, body } = await callSearchRoute(plugin, 'no-such-thing')
    expect(status).toBe(200)
    const results = body.results as unknown[]
    expect(results).toEqual([])
    const meta = body.meta as Record<string, unknown> | undefined
    expect(meta?.total).toBe(0)
  })
})

// ===========================================================================
// Registration completeness
// ===========================================================================

describe('Calendar plugin registration', () => {
  it('registers exactly 18 routes', () => {
    expect(plugin.routes.length).toBe(18)
  })

  it('registers exactly 15 exec tools', () => {
    expect(plugin.execTools.length).toBe(15)
  })

  it('called watchFiles with messaging.json during activation', async () => {
    // Re-activate to test this since beforeEach clears mocks
    const fresh = await activatePlugin(messagingPlugin, testDir)
    expect(fresh.ctx.watchFiles).toHaveBeenCalledWith(['messaging.json', 'messaging/sessions/*.json'])
  })
})
