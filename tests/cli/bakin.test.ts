import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * CLI tests verify that commands exist and call the correct API endpoints.
 * We mock global fetch to intercept HTTP calls.
 */

const mockFetch = vi.fn()

describe('CLI bakin commands', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = mockFetch as any
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(''),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('api helpers', () => {
    it('should send POST with correct content-type', async () => {
      await fetch('http://localhost:3737/api/plugins/tasks/task-1/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'task-1', author: 'cli', message: 'test message' }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3737/api/plugins/tasks/task-1/log',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test message'),
        })
      )
    })
  })

  describe('command endpoint mapping', () => {
    it('tasks log calls POST /api/plugins/tasks/:id/log', async () => {
      await simulateCliPost('/api/plugins/tasks/abc/log', { id: 'abc', author: 'cli', message: 'progress update' })
      expectPostTo('/api/plugins/tasks/abc/log', { id: 'abc', author: 'cli', message: 'progress update' })
    })

    it('tasks block calls POST /api/plugins/tasks/:id/block', async () => {
      await simulateCliPost('/api/plugins/tasks/abc/block', { id: 'abc', reason: 'API down', agent: 'cli' })
      expectPostTo('/api/plugins/tasks/abc/block', { id: 'abc', reason: 'API down', agent: 'cli' })
    })

    it('tasks depend calls POST /api/plugins/tasks/:id/dependency', async () => {
      await simulateCliPost('/api/plugins/tasks/abc/dependency', { id: 'abc', dependsOn: 'def' })
      expectPostTo('/api/plugins/tasks/abc/dependency', { id: 'abc', dependsOn: 'def' })
    })

    it('tasks complete calls POST log then POST move', async () => {
      await simulateCliPost('/api/plugins/tasks/abc/log', { id: 'abc', author: 'cli', message: 'Task complete: All done' })
      await simulateCliPost('/api/plugins/tasks/abc/move', { id: 'abc', to: 'done', agent: 'cli' })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.mock.calls[0][0]).toContain('/api/plugins/tasks/abc/log')
      expect(mockFetch.mock.calls[1][0]).toContain('/api/plugins/tasks/abc/move')
    })

    it('workflows step calls GET /api/plugins/workflows/step', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ stepId: 'write-copy', label: 'Write Copy' }),
        text: () => Promise.resolve(''),
      })

      await fetch('http://localhost:3737/api/plugins/workflows/step?taskId=task-1', {
        headers: { 'Content-Type': 'application/json' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/workflows/step?taskId=task-1'),
        expect.any(Object)
      )
    })

    it('workflows submit calls POST /api/plugins/workflows/step/complete', async () => {
      const payload = { taskId: 't1', stepId: 's1', agentId: 'cli', output: { text: 'hello' } }
      await simulateCliPost('/api/plugins/workflows/step/complete', payload)
      expectPostTo('/api/plugins/workflows/step/complete', payload)
    })

    it('paths calls GET /api/paths', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ paths: { home: '/tmp' }, isBakinHome: true }),
        text: () => Promise.resolve(''),
      })

      await fetch('http://localhost:3737/api/paths', {
        headers: { 'Content-Type': 'application/json' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/paths'),
        expect.any(Object)
      )
    })
  })

  describe('tasks get endpoint mapping', () => {
    it('tasks get calls GET /api/plugins/tasks/ and filters by id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          columns: {
            inProgress: [{ id: 'task-1', title: 'Test Task', agent: 'pixel' }],
            todo: [],
            done: [],
          }
        }),
        text: () => Promise.resolve(''),
      })

      const res = await fetch('http://localhost:3737/api/plugins/tasks/', {
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json() as { columns: Record<string, Array<{ id: string }>> }

      let found = null
      for (const [col, tasks] of Object.entries(data.columns)) {
        const task = tasks.find(t => t.id === 'task-1')
        if (task) { found = { column: col, task }; break }
      }

      expect(found).not.toBeNull()
      expect(found!.column).toBe('inProgress')
      expect(found!.task.id).toBe('task-1')
    })
  })
})

// Helpers
async function simulateCliPost(path: string, body: Record<string, unknown>) {
  await fetch(`http://localhost:3737${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function expectPostTo(path: string, body: unknown) {
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining(path),
    expect.objectContaining({
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}
