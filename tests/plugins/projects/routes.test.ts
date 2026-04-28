/**
 * Projects plugin — route and exec tool integration tests.
 * Activates the plugin with a mock PluginContext, then exercises every
 * registered HTTP route and MCP exec tool.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
  callSearchRoute,
} from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'
import type { ChatChunk, MessageArgs, MessageResult } from '@bakin/core/adapters/runtime'

// ---------------------------------------------------------------------------
// Test directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-projects-routes-${Date.now()}`)
const projectsDir = join(testDir, 'projects')

// ---------------------------------------------------------------------------
// Mocks — must be declared before any plugin imports
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getBakinPaths: () => ({ projects: projectsDir }),
  getContentDir: () => testDir,
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

const mockCreateTask = mock((opts?: unknown) => {
  void opts
  return Promise.resolve({ id: 'promoted01' })
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({
    columns: {
      todo: [{ id: 'board01', title: 'Board Task 1' }],
      inProgress: [],
      review: [],
      done: [{ id: 'board02', title: 'Done Task' }],
      archived: [],
      blocked: [],
      backlog: [],
    },
  }),
}))

/** Consume an SSE Response body into a list of {event, data} records. */
async function consumeSSE(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: Array<{ event: string; data: unknown }> = []
  let buffer = ''
  let currentEvent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && currentEvent) {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) })
        currentEvent = ''
      }
    }
  }
  return events
}

type ProjectRouteTestGlobal = typeof globalThis & {
  __bakinBroadcast?: unknown
  __bakinProjectIndex?: unknown
  __bakinProjectLock?: unknown
}

const testGlobal = globalThis as ProjectRouteTestGlobal

// Suppress SSE broadcast
testGlobal.__bakinBroadcast = mock()

// Clear project index / lock between tests
function clearGlobals() {
  testGlobal.__bakinProjectIndex = undefined
  testGlobal.__bakinProjectLock = undefined
}

// ---------------------------------------------------------------------------
// Plugin import (after mocks)
// ---------------------------------------------------------------------------

import projectsPlugin from '../../../plugins/projects'
import { readProject as readProjectFile } from '../../../plugins/projects/lib/parser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a project markdown file directly on disk for read-only tests. */
function writeProjectFixture(
  id: string,
  opts: { title?: string; status?: string; tasks?: Array<{ id: string; title: string; checked: boolean; taskId?: string }>; assets?: Array<{ filename: string; label?: string }>; body?: string; owner?: string } = {},
) {
  const title = opts.title ?? `Project ${id}`
  const status = opts.status ?? 'active'
  const owner = opts.owner ?? 'main'
  const tasks = opts.tasks ?? []
  const assets = opts.assets ?? []
  const body = opts.body ?? `# ${title}\nProject body text.`
  const now = new Date().toISOString()

  const fm: Record<string, unknown> = {
    id,
    title,
    status,
    created: now,
    updated: now,
    owner,
    tasks: tasks.map(t => {
      const item: Record<string, unknown> = { id: t.id, title: t.title, checked: t.checked }
      if (t.taskId) item.taskId = t.taskId
      return item
    }),
  }
  if (assets.length > 0) fm.assets = assets

  const content = `---\n${yaml.dump(fm, { lineWidth: -1 }).trim()}\n---\n\n${body}\n`
  if (!existsSync(projectsDir)) mkdirSync(projectsDir, { recursive: true })
  writeFileSync(join(projectsDir, `${id}.md`), content, 'utf-8')
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

async function* streamTextChunks(tokens: string[]): AsyncIterable<ChatChunk> {
  for (const token of tokens) {
    yield { type: 'text', content: token }
  }
}

function mockRuntimeStream(tokens: string[]) {
  const streamMock = mock((args: MessageArgs) => {
    void args
    return streamTextChunks(tokens)
  })
  plugin.ctx.runtime.messaging.stream = streamMock
  return streamMock
}

function mockRuntimeStreamError(message: string) {
  const streamMock = mock((args: MessageArgs): AsyncIterable<ChatChunk> => {
    void args
    throw new Error(message)
  })
  plugin.ctx.runtime.messaging.stream = streamMock
  return streamMock
}

function mockRuntimeSend(content: string) {
  const sendMock = mock((args: MessageArgs): Promise<MessageResult> => {
    void args
    return Promise.resolve({
      id: 'msg-test',
      content,
    })
  })
  plugin.ctx.runtime.messaging.send = sendMock
  return sendMock
}

function mockRuntimeSendError(message: string) {
  const sendMock = mock(async (args: MessageArgs): Promise<MessageResult> => {
    void args
    throw new Error(message)
  })
  plugin.ctx.runtime.messaging.send = sendMock
  return sendMock
}

beforeEach(async () => {
  clearGlobals()
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  mkdirSync(projectsDir, { recursive: true })
  mockCreateTask.mockClear()
  plugin = await activatePlugin(projectsPlugin, testDir)
})

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
})

// ===========================================================================
// ROUTES
// ===========================================================================

describe('Routes', () => {
  // -------------------------------------------------------------------------
  // GET / — list projects
  // -------------------------------------------------------------------------
  describe('GET / — list projects', () => {
    it('returns empty list when no projects exist', async () => {
      const route = findRoute(plugin.routes, 'GET', '/')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      expect(body.projects).toEqual([])
    })

    it('returns project summaries', async () => {
      writeProjectFixture('proj-aaa', { title: 'Alpha', tasks: [{ id: 't001', title: 'Do thing', checked: false }] })
      writeProjectFixture('proj-bbb', { title: 'Beta', status: 'completed' })

      const route = findRoute(plugin.routes, 'GET', '/')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      const projects = body.projects as Array<Record<string, unknown>>
      expect(projects).toHaveLength(2)
      expect(projects.map(p => p.title)).toContain('Alpha')
      expect(projects.map(p => p.title)).toContain('Beta')
    })

    it('filters by status query param', async () => {
      writeProjectFixture('proj-aaa', { title: 'Active One', status: 'active' })
      writeProjectFixture('proj-bbb', { title: 'Draft One', status: 'draft' })

      const route = findRoute(plugin.routes, 'GET', '/')!
      const { body } = await callRoute(route, plugin.ctx, { searchParams: { status: 'draft' } })
      const projects = body.projects as Array<Record<string, unknown>>
      expect(projects).toHaveLength(1)
      expect(projects[0].title).toBe('Draft One')
    })
  })

  // -------------------------------------------------------------------------
  // GET /:projectId — get single project
  // -------------------------------------------------------------------------
  describe('GET /:projectId — get project', () => {
    it('returns a project by ID', async () => {
      writeProjectFixture('proj-001', { title: 'My Project', tasks: [{ id: 't001', title: 'Step 1', checked: false }] })

      const route = findRoute(plugin.routes, 'GET', '/:projectId')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, { searchParams: { projectId: 'proj-001' } })
      expect(status).toBe(200)
      const project = body.project as Record<string, unknown>
      expect(project.title).toBe('My Project')
      expect(project.id).toBe('proj-001')
    })

    it('returns 400 when id is missing', async () => {
      const route = findRoute(plugin.routes, 'GET', '/:projectId')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(400)
      expect(body.error).toMatch(/[Mm]issing/)
    })

    it('returns 404 when project does not exist', async () => {
      const route = findRoute(plugin.routes, 'GET', '/:projectId')!
      const { status, body } = await callRoute(route, plugin.ctx, { searchParams: { projectId: 'nonexistent' } })
      expect(status).toBe(404)
      expect(body.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // POST / — create project
  // -------------------------------------------------------------------------
  describe('POST / — create project', () => {
    it('creates a project and returns its id', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { title: 'New Project', owner: 'scout' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.id).toBeDefined()
      expect(typeof body.id).toBe('string')
    })

    it('creates with initial tasks', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
        body: { title: 'With Tasks', tasks: ['Step 1', 'Step 2'] },
      })
      expect(body.ok).toBe(true)
      const items = body.taskItems as Array<Record<string, unknown>>
      expect(items).toHaveLength(2)
      expect(items[0].title).toBe('Step 1')
    })

    it('returns 400 when title is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/[Mm]issing title/)
    })

    it('records audit activity', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      await callRoute(route, plugin.ctx, { body: { title: 'Audited' } })
      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith(
        'created',
        expect.any(String),
        expect.objectContaining({ title: 'Audited' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // PUT /:projectId — update project
  // -------------------------------------------------------------------------
  describe('PUT /:projectId — update project', () => {
    it('updates title and status', async () => {
      writeProjectFixture('proj-upd', { title: 'Old Title', status: 'draft' })

      const route = findRoute(plugin.routes, 'PUT', '/:projectId')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-upd' },
        body: { title: 'New Title', status: 'active' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when id is missing', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:projectId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { title: 'No Id' },
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/[Mm]issing/)
    })

    it('returns 400 for non-existent project', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:projectId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'ghost' },
        body: { title: 'Nope' },
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /:projectId — delete project
  // -------------------------------------------------------------------------
  describe('DELETE /:projectId — delete project', () => {
    it('deletes a project', async () => {
      writeProjectFixture('proj-del', { title: 'Delete Me' })

      const route = findRoute(plugin.routes, 'DELETE', '/:projectId')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-del' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(existsSync(join(projectsDir, 'proj-del.md'))).toBe(false)
    })

    it('returns 400 when id is missing', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:projectId')!
      const { status } = await callRoute(route, plugin.ctx)
      expect(status).toBe(400)
    })

    it('returns 400 for non-existent project', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:projectId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'nope' },
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/not found/i)
    })

    it('invokes tasks.deleteTask hook when deleteLinkedTasks is true', async () => {
      writeProjectFixture('proj-linked', {
        title: 'Linked',
        tasks: [{ id: 't001', title: 'Linked Item', checked: false, taskId: 'board01' }],
      })

      const route = findRoute(plugin.routes, 'DELETE', '/:projectId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-linked' },
        body: { deleteLinkedTasks: true },
      })
      expect(plugin.ctx.hooks.invoke).toHaveBeenCalledWith(
        'tasks.deleteTask',
        expect.objectContaining({ identifier: 'board01' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // POST /:projectId/checklist — add checklist item
  // -------------------------------------------------------------------------
  describe('POST /:projectId/checklist — add item', () => {
    it('adds an item to the checklist', async () => {
      writeProjectFixture('proj-cl', { title: 'Checklist Project' })

      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-cl' },
        body: { title: 'New Item' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.taskItemId).toBeDefined()
    })

    it('returns 400 when projectId or title is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { title: 'No Project Id' },
      })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // PUT /:projectId/checklist/:itemId/toggle — toggle item
  // -------------------------------------------------------------------------
  describe('PUT /:projectId/checklist/:itemId/toggle', () => {
    it('toggles a checklist item', async () => {
      writeProjectFixture('proj-tog', {
        title: 'Toggle Project',
        tasks: [{ id: 't001', title: 'Item 1', checked: false }],
      })

      const route = findRoute(plugin.routes, 'PUT', '/:projectId/checklist/:itemId/toggle')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-tog', itemId: 't001' },
        body: { checked: true },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.progress).toBe(100)
    })

    it('returns 400 when ids are missing', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:projectId/checklist/:itemId/toggle')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { checked: true },
      })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // PUT /:projectId/checklist/:itemId — update item
  // -------------------------------------------------------------------------
  describe('PUT /:projectId/checklist/:itemId — update item', () => {
    it('updates item title and description', async () => {
      writeProjectFixture('proj-updi', {
        title: 'Update Item Project',
        tasks: [{ id: 't001', title: 'Original', checked: false }],
      })

      const route = findRoute(plugin.routes, 'PUT', '/:projectId/checklist/:itemId')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-updi', itemId: 't001' },
        body: { title: 'Updated', description: 'Some detail' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when ids are missing', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:projectId/checklist/:itemId')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { title: 'No Ids' },
      })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /:projectId/checklist/:itemId — remove item
  // -------------------------------------------------------------------------
  describe('DELETE /:projectId/checklist/:itemId — remove item', () => {
    it('removes a checklist item', async () => {
      writeProjectFixture('proj-rmi', {
        title: 'Remove Item Project',
        tasks: [
          { id: 't001', title: 'Keep', checked: false },
          { id: 't002', title: 'Remove', checked: false },
        ],
      })

      const route = findRoute(plugin.routes, 'DELETE', '/:projectId/checklist/:itemId')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-rmi', itemId: 't002' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when ids are missing', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:projectId/checklist/:itemId')!
      const { status } = await callRoute(route, plugin.ctx, {})
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /:projectId/checklist/:itemId/link — link to board task
  // -------------------------------------------------------------------------
  describe('POST /:projectId/checklist/:itemId/link', () => {
    it('links a checklist item to a board task', async () => {
      writeProjectFixture('proj-lnk', {
        title: 'Link Project',
        tasks: [{ id: 't001', title: 'Linkable', checked: false }],
      })

      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist/:itemId/link')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-lnk', itemId: 't001' },
        body: { taskId: 'board01' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when required fields are missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist/:itemId/link')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-lnk', itemId: 't001' },
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toMatch(/[Mm]issing/)
    })
  })

  // -------------------------------------------------------------------------
  // POST /:projectId/checklist/:itemId/promote — promote to task
  // -------------------------------------------------------------------------
  describe('POST /:projectId/checklist/:itemId/promote', () => {
    it('promotes a checklist item to a board task', async () => {
      writeProjectFixture('proj-prom', {
        title: 'Promote Project',
        tasks: [{ id: 't001', title: 'Promote Me', checked: false }],
      })

      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist/:itemId/promote')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-prom', itemId: 't001' },
        body: { assignee: 'pixel' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.taskId).toBe('promoted01')
      expect(mockCreateTask).toHaveBeenCalledTimes(1)
    })

    it('returns 400 when ids are missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/checklist/:itemId/promote')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /:projectId/assets — attach asset
  // -------------------------------------------------------------------------
  describe('POST /:projectId/assets — attach asset', () => {
    it('attaches an asset to a project', async () => {
      writeProjectFixture('proj-att', { title: 'Attach Project' })

      const route = findRoute(plugin.routes, 'POST', '/:projectId/assets')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-att' },
        body: { filename: '20260401-spec-abcdef12.md', label: 'Spec doc' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when projectId or filename is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/assets')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { label: 'No filename' },
      })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /:projectId/assets/:filename — detach asset
  // -------------------------------------------------------------------------
  describe('DELETE /:projectId/assets/:filename — detach asset', () => {
    it('detaches an asset from a project', async () => {
      writeProjectFixture('proj-det', {
        title: 'Detach Project',
        assets: [{ filename: '20260401-spec-abcdef12.md', label: 'Spec' }],
      })

      const route = findRoute(plugin.routes, 'DELETE', '/:projectId/assets/:filename')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { projectId: 'proj-det', filename: '20260401-spec-abcdef12.md' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
    })

    it('returns 400 when required params are missing', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:projectId/assets/:filename')!
      const { status } = await callRoute(route, plugin.ctx, {})
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // POST /:projectId/ask — agent brainstorm
  // -------------------------------------------------------------------------
  describe('POST /:projectId/ask — agent brainstorm (SSE stream)', () => {
    it('streams token events then a done event with accumulated content', async () => {
      writeProjectFixture('proj-ask', {
        title: 'Ask Project',
        tasks: [{ id: 't001', title: 'Do stuff', checked: true }],
        assets: [{ filename: '20260401-brief-abcdef12.md', label: 'Brief' }],
      })
      const streamMock = mockRuntimeStream(['Hel', 'lo ', 'world'])

      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { response } = await callRoute(route, plugin.ctx, {
        body: { projectId: 'proj-ask', prompt: 'What should we do next?' },
        rawResponse: true,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')

      const events = await consumeSSE(response)
      const tokens = events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text)
      expect(tokens).toEqual(['Hel', 'lo ', 'world'])
      const doneEvent = events.find((e) => e.event === 'done')
      expect(doneEvent).toBeDefined()
      expect((doneEvent!.data as { content: string }).content).toBe('Hello world')

      // Context was built with project metadata
      expect(streamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'main',
          content: expect.stringContaining('Ask Project'),
        }),
      )
    })

    it('uses the custom agent and includes history in the prompt', async () => {
      writeProjectFixture('proj-ask2', { title: 'Ask 2' })
      const streamMock = mockRuntimeStream(['ok'])

      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { response } = await callRoute(route, plugin.ctx, {
        body: {
          projectId: 'proj-ask2',
          prompt: 'Continue',
          agent: 'pixel',
          history: [{ role: 'user', content: 'Start' }, { role: 'assistant', content: 'OK' }],
        },
        rawResponse: true,
      })
      await consumeSSE(response)
      expect(streamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'pixel',
          content: expect.stringContaining('Previous conversation'),
        }),
      )
    })

    it('falls back to chatCompletion when gateway does not stream', async () => {
      writeProjectFixture('proj-fallback', { title: 'Fallback' })
      mockRuntimeStreamError('stream unavailable')
      const sendMock = mockRuntimeSend('Full reply in one go')

      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { response } = await callRoute(route, plugin.ctx, {
        body: { projectId: 'proj-fallback', prompt: 'Hi' },
        rawResponse: true,
      })
      const events = await consumeSSE(response)
      const tokens = events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text)
      expect(tokens).toEqual(['Full reply in one go'])
      expect(events.some((e) => e.event === 'done')).toBe(true)
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'main',
          content: expect.stringContaining('Fallback'),
        }),
      )
    })

    it('returns 400 when projectId or prompt is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { projectId: 'proj-ask' },
      })
      expect(status).toBe(400)
    })

    it('returns 404 when the project does not exist', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { projectId: 'nonexistent', prompt: 'Hello' },
      })
      expect(status).toBe(404)
      expect(body.error).toMatch(/not found/i)
    })

    it('emits an error event when both streaming and fallback fail', async () => {
      writeProjectFixture('proj-fail', { title: 'Fail Project' })
      mockRuntimeStreamError('unreachable')
      mockRuntimeSendError('gateway down')

      const route = findRoute(plugin.routes, 'POST', '/:projectId/ask')!
      const { response } = await callRoute(route, plugin.ctx, {
        body: { projectId: 'proj-fail', prompt: 'Help' },
        rawResponse: true,
      })
      const events = await consumeSSE(response)
      const errEvent = events.find((e) => e.event === 'error')
      expect(errEvent).toBeDefined()
      expect((errEvent!.data as { message: string }).message).toMatch(/gateway down|unreachable/i)
    })
  })
})

// ===========================================================================
// EXEC TOOLS
// ===========================================================================

describe('Exec Tools', () => {
  // -------------------------------------------------------------------------
  // bakin_exec_project_list
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_list', () => {
    it('lists all projects', async () => {
      writeProjectFixture('proj-a', { title: 'A', status: 'active' })
      writeProjectFixture('proj-b', { title: 'B', status: 'draft' })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_list')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      const projects = result.projects as Array<Record<string, unknown>>
      expect(projects).toHaveLength(2)
    })

    it('filters by status', async () => {
      writeProjectFixture('proj-a', { title: 'A', status: 'active' })
      writeProjectFixture('proj-b', { title: 'B', status: 'draft' })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_list')!
      const result = await callTool(tool, { status: 'active' })
      const projects = result.projects as Array<Record<string, unknown>>
      expect(projects).toHaveLength(1)
      expect(projects[0].title).toBe('A')
    })

    it('returns empty list when no projects', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_list')!
      const result = await callTool(tool, {})
      expect(result.projects).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_get
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_get', () => {
    it('returns a project with resolved linked tasks', async () => {
      writeProjectFixture('proj-get', {
        title: 'Get Project',
        tasks: [{ id: 't001', title: 'Linked', checked: false, taskId: 'board01' }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_get')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-get' })
      expect(result.ok).toBe(true)
      const project = result.project as Record<string, unknown>
      expect(project.title).toBe('Get Project')
      expect(project.resolvedTasks).toBeDefined()
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_get')!
      const result = await callTool(tool, { projectId: 'ghost' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_create
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_create', () => {
    it('creates a project and returns id', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_create')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { title: 'Created via Tool' })
      expect(result.ok).toBe(true)
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
    })

    it('creates with initial tasks', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_create')!
      const result = await callTool(tool, {
        title: 'With Items',
        tasks: ['Item A', 'Item B'],
        body: '# Plan',
        owner: 'scout',
      }, 'scout')
      expect(result.ok).toBe(true)
      const items = result.taskItems as Array<Record<string, unknown>>
      expect(items).toHaveLength(2)
      expect(items[0].title).toBe('Item A')
    })

    it('uses agent as owner fallback', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_create')!
      const result = await callTool(tool, { title: 'Agent Owner' }, 'pixel')
      expect(result.ok).toBe(true)
      // The owner should be 'pixel' (passed as agent param)
      const project = readProjectFile(result.id as string)
      expect(project!.owner).toBe('pixel')
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_update
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_update', () => {
    it('updates project fields', async () => {
      writeProjectFixture('proj-tool-upd', { title: 'Old', status: 'draft' })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_update')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, {
        projectId: 'proj-tool-upd',
        title: 'New Title',
        status: 'active',
      })
      expect(result.ok).toBe(true)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_update')!
      const result = await callTool(tool, { projectId: 'ghost', title: 'X' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })

    it('returns error when completing with unchecked items', async () => {
      writeProjectFixture('proj-incomplete', {
        title: 'Incomplete',
        tasks: [{ id: 't001', title: 'Not done', checked: false }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_update')!
      const result = await callTool(tool, { projectId: 'proj-incomplete', status: 'completed' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/unchecked/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_delete
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_delete', () => {
    it('deletes a project', async () => {
      writeProjectFixture('proj-tool-del', { title: 'Delete Me' })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_delete')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-tool-del' })
      expect(result.ok).toBe(true)
      expect(existsSync(join(projectsDir, 'proj-tool-del.md'))).toBe(false)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_delete')!
      const result = await callTool(tool, { projectId: 'nope' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_add_item
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_add_item', () => {
    it('adds a checklist item', async () => {
      writeProjectFixture('proj-ai', { title: 'Add Item', tasks: [{ id: 't001', title: 'Existing', checked: false }] })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_add_item')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-ai', title: 'New Item' })
      expect(result.ok).toBe(true)
      expect(result.taskItemId).toBe('t002')
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_mark_item
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_mark_item', () => {
    it('marks an item as checked', async () => {
      writeProjectFixture('proj-mi', {
        title: 'Mark Item',
        tasks: [{ id: 't001', title: 'To Check', checked: false }, { id: 't002', title: 'Other', checked: false }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_mark_item')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-mi', taskItemId: 't001', checked: true })
      expect(result.ok).toBe(true)
      expect(result.progress).toBe(50) // 1 of 2
    })

    it('unchecks an item', async () => {
      writeProjectFixture('proj-mi2', {
        title: 'Uncheck',
        tasks: [{ id: 't001', title: 'Checked', checked: true }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_mark_item')!
      const result = await callTool(tool, { projectId: 'proj-mi2', taskItemId: 't001', checked: false })
      expect(result.ok).toBe(true)
      expect(result.progress).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_remove_item
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_remove_item', () => {
    it('removes a checklist item', async () => {
      writeProjectFixture('proj-ri', {
        title: 'Remove Item',
        tasks: [{ id: 't001', title: 'Remove', checked: false }, { id: 't002', title: 'Keep', checked: false }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_remove_item')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-ri', taskItemId: 't001' })
      expect(result.ok).toBe(true)
    })

    it('returns error for non-existent item', async () => {
      writeProjectFixture('proj-ri2', { title: 'No Item', tasks: [] })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_remove_item')!
      const result = await callTool(tool, { projectId: 'proj-ri2', taskItemId: 't999' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_link_item
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_link_item', () => {
    it('links a board task to a checklist item', async () => {
      writeProjectFixture('proj-li', {
        title: 'Link Item',
        tasks: [{ id: 't001', title: 'To Link', checked: false }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_link_item')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-li', taskItemId: 't001', taskId: 'board01' })
      expect(result.ok).toBe(true)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_link_item')!
      const result = await callTool(tool, { projectId: 'ghost', taskItemId: 't001', taskId: 'board01' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_promote_item
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_promote_item', () => {
    it('promotes a checklist item to a board task', async () => {
      writeProjectFixture('proj-pi', {
        title: 'Promote Item',
        tasks: [{ id: 't001', title: 'Promote Me', checked: false }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_promote_item')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-pi', taskItemId: 't001', assignee: 'pixel' })
      expect(result.ok).toBe(true)
      expect(result.taskId).toBe('promoted01')
      expect(mockCreateTask).toHaveBeenCalledTimes(1)
    })

    it('returns error if item already linked', async () => {
      writeProjectFixture('proj-pi2', {
        title: 'Already Linked',
        tasks: [{ id: 't001', title: 'Linked', checked: false, taskId: 'existing01' }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_promote_item')!
      const result = await callTool(tool, { projectId: 'proj-pi2', taskItemId: 't001' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/already linked/i)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_promote_item')!
      const result = await callTool(tool, { projectId: 'ghost', taskItemId: 't001' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_attach_asset
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_attach_asset', () => {
    it('attaches an asset', async () => {
      writeProjectFixture('proj-aa', { title: 'Attach Asset' })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_attach_asset')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, {
        projectId: 'proj-aa',
        filename: '20260401-logo-abcdef12.png',
        label: 'Logo',
      })
      expect(result.ok).toBe(true)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_attach_asset')!
      const result = await callTool(tool, { projectId: 'ghost', filename: '20260401-x-abcdef12.md' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // -------------------------------------------------------------------------
  // bakin_exec_project_detach_asset
  // -------------------------------------------------------------------------
  describe('bakin_exec_project_detach_asset', () => {
    it('detaches an asset', async () => {
      writeProjectFixture('proj-da', {
        title: 'Detach Asset',
        assets: [{ filename: '20260401-brief-abcdef12.md', label: 'Brief' }],
      })

      const tool = findTool(plugin.execTools, 'bakin_exec_project_detach_asset')!
      expect(tool).toBeDefined()
      const result = await callTool(tool, { projectId: 'proj-da', filename: '20260401-brief-abcdef12.md' })
      expect(result.ok).toBe(true)
    })

    it('returns error for non-existent project', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_project_detach_asset')!
      const result = await callTool(tool, { projectId: 'ghost', filename: '20260401-x-abcdef12.md' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })
})

// ===========================================================================
// Search route (auto-registered via ctx.search.registerFileBackedContentType)
// ===========================================================================

describe('GET /search — auto-registered search route', () => {
  it('returns 200 with seeded results on a happy-path query', async () => {
    plugin.seedResults([
      {
        id: 'p1',
        table: 'bakin_projects',
        score: 0.9,
        fields: { title: 'Project One' },
      },
    ])

    const { status, body } = await callSearchRoute(plugin, 'project')
    expect(status).toBe(200)
    const results = body.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p1')
    expect(results[0].table).toBe('bakin_projects')
    expect(results[0].score).toBe(0.9)
    expect((results[0].fields as Record<string, unknown>).title).toBe('Project One')
  })

  it('returns 400 when q is missing', async () => {
    const route = findRoute(plugin.routes, 'GET', '/search')!
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route, plugin.ctx)
    expect(status).toBe(400)
    expect(body.error).toMatch(/[Mm]issing/)
  })

  it('returns 200 with empty results for a zero-result query', async () => {
    plugin.seedResults([])

    const { status, body } = await callSearchRoute(plugin, 'no-such-thing')
    expect(status).toBe(200)
    const results = body.results as unknown[]
    expect(results).toEqual([])
    const meta = body.meta as Record<string, unknown> | undefined
    expect(meta?.total).toBe(0)
  })

  it('passes facets through to ctx.search.query', async () => {
    plugin.seedResults([])

    await callSearchRoute(plugin, 'anything', { facets: 'status' })

    expect(plugin.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'anything',
        facets: ['status'],
      }),
    )
  })
})

// ===========================================================================
// Registration completeness
// ===========================================================================

describe('Registration', () => {
  it('registers all expected routes', async () => {
    const expectedRoutes = [
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/:projectId' },
      { method: 'POST', path: '/' },
      { method: 'PUT', path: '/:projectId' },
      { method: 'DELETE', path: '/:projectId' },
      { method: 'POST', path: '/:projectId/checklist' },
      { method: 'PUT', path: '/:projectId/checklist/:itemId/toggle' },
      { method: 'PUT', path: '/:projectId/checklist/:itemId' },
      { method: 'DELETE', path: '/:projectId/checklist/:itemId' },
      { method: 'POST', path: '/:projectId/checklist/:itemId/link' },
      { method: 'POST', path: '/:projectId/checklist/:itemId/promote' },
      { method: 'POST', path: '/:projectId/assets' },
      { method: 'DELETE', path: '/:projectId/assets/:filename' },
      { method: 'POST', path: '/:projectId/ask' },
      { method: 'GET', path: '/search' },
    ]

    for (const { method, path } of expectedRoutes) {
      const route = findRoute(plugin.routes, method, path)
      expect(route, `Missing route: ${method} ${path}`).toBeDefined()
    }
  })

  it('registers all expected exec tools', async () => {
    const expectedTools = [
      'bakin_exec_project_list',
      'bakin_exec_project_get',
      'bakin_exec_project_create',
      'bakin_exec_project_update',
      'bakin_exec_project_delete',
      'bakin_exec_project_add_item',
      'bakin_exec_project_mark_item',
      'bakin_exec_project_remove_item',
      'bakin_exec_project_link_item',
      'bakin_exec_project_promote_item',
      'bakin_exec_project_attach_asset',
      'bakin_exec_project_detach_asset',
    ]

    for (const name of expectedTools) {
      const tool = findTool(plugin.execTools, name)
      expect(tool, `Missing exec tool: ${name}`).toBeDefined()
    }
  })

  it('registers hooks', () => {
    expect(plugin.ctx.hooks.register).toHaveBeenCalledWith('projects.readProject', expect.any(Function))
    expect(plugin.ctx.hooks.register).toHaveBeenCalledWith('projects.autoCheckLinkedItem', expect.any(Function))
  })

  it('watches project files', () => {
    expect(plugin.ctx.watchFiles).toHaveBeenCalledWith(['projects/*.md'])
  })
})
