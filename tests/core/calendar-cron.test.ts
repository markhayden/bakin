import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../src/core/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    calendar: { intervalMs: 1000 },
  }),
}))

import { start, stop } from '../../src/core/calendar-cron'
import { appendAudit } from '../../src/core/audit'

describe('calendar-cron', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-calendar-cron-'))
    vi.useFakeTimers()
    vi.restoreAllMocks // reset fetch spy between tests
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function writeCalendar(items: Record<string, unknown>[]) {
    writeFileSync(join(tempDir, 'calendar.json'), JSON.stringify(items, null, 2))
  }

  function readCalendar() {
    return JSON.parse(readFileSync(join(tempDir, 'calendar.json'), 'utf-8'))
  }

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  describe('start and stop', () => {
    it('start creates an interval timer', () => {
      start(tempDir, 3737)
      // Timer should be active — advancing time should not throw
      expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    })

    it('stop clears the interval', () => {
      start(tempDir, 3737)
      stop()
      // Calling stop again is safe (idempotent)
      expect(() => stop()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // executeScheduledContent (tested via interval tick)
  // -------------------------------------------------------------------------

  describe('executeScheduledContent', () => {
    it('does nothing when calendar.json does not exist', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('skips items that are not status "scheduled"', async () => {
      writeCalendar([
        { id: '1', title: 'Done', status: 'completed', scheduledAt: '2020-01-01T00:00:00Z', agent: 'trainer' },
        { id: '2', title: 'Executing', status: 'executing', scheduledAt: '2020-01-01T00:00:00Z', agent: 'trainer' },
      ])
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('skips items scheduled in the future', async () => {
      writeCalendar([
        { id: '1', title: 'Future', status: 'scheduled', scheduledAt: '2099-01-01T00:00:00Z', agent: 'trainer' },
      ])
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('creates a task and updates item to "executing" for due items', async () => {
      writeCalendar([
        {
          id: 'item-1',
          title: 'Post update',
          status: 'scheduled',
          scheduledAt: '2020-01-01T00:00:00Z',
          agent: 'trainer',
          contentType: 'social',
          tone: 'casual',
          brief: 'Write a post',
          channelTarget: '#general',
        },
      ])

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'task-99' }), { status: 200 }),
      )

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      // Should have POSTed to the tasks API
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, opts] = fetchSpy.mock.calls[0]
      expect(url).toBe('http://localhost:3737/api/plugins/tasks/')
      expect(opts!.method).toBe('POST')
      const body = JSON.parse(opts!.body as string)
      expect(body.title).toBe('Content: Post update')
      expect(body.assignee).toBe('trainer')

      // calendar.json should be updated
      const items = readCalendar()
      expect(items[0].status).toBe('executing')
      expect(items[0].taskId).toBe('task-99')
      expect(items[0].updatedAt).toBeDefined()
    })

    it('includes persona in task description when persona file exists', async () => {
      mkdirSync(join(tempDir, 'team', 'personas'), { recursive: true })
      writeFileSync(join(tempDir, 'team', 'personas', 'trainer.md'), 'You are Trainer, a social media expert.')

      writeCalendar([
        {
          id: 'item-2',
          title: 'Persona test',
          status: 'scheduled',
          scheduledAt: '2020-01-01T00:00:00Z',
          agent: 'trainer',
          contentType: 'blog',
          tone: 'professional',
          brief: 'Write a blog post',
          channelTarget: '#blog',
        },
      ])

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'task-100' }), { status: 200 }),
      )

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
      expect(body.description).toContain('You are Trainer, a social media expert.')
    })

    it('calls appendAudit after creating a task', async () => {
      writeCalendar([
        {
          id: 'item-3',
          title: 'Audit test',
          status: 'scheduled',
          scheduledAt: '2020-01-01T00:00:00Z',
          agent: 'trainer',
          contentType: 'social',
          tone: 'casual',
          brief: 'test',
          channelTarget: '#general',
        },
      ])

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'task-101' }), { status: 200 }),
      )

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'calendar.execute',
        'system',
        expect.objectContaining({ itemId: 'item-3', taskId: 'task-101', title: 'Audit test' }),
      )
    })

    it('handles fetch errors gracefully without crashing', async () => {
      writeCalendar([
        {
          id: 'item-4',
          title: 'Error test',
          status: 'scheduled',
          scheduledAt: '2020-01-01T00:00:00Z',
          agent: 'trainer',
          contentType: 'social',
          tone: 'casual',
          brief: 'test',
          channelTarget: '#general',
        },
      ])

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

      start(tempDir, 3737)
      // Should not throw
      await vi.advanceTimersByTimeAsync(1500)
    })
  })

  // -------------------------------------------------------------------------
  // buildContentTaskDescription (tested via task creation body)
  // -------------------------------------------------------------------------

  describe('buildContentTaskDescription', () => {
    it('includes all item fields and port in the description', async () => {
      writeCalendar([
        {
          id: 'desc-1',
          title: 'My Title',
          status: 'scheduled',
          scheduledAt: '2020-01-01T00:00:00Z',
          agent: 'pixel',
          contentType: 'image',
          tone: 'playful',
          brief: 'Create a fun image',
          channelTarget: '#art',
        },
      ])

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'task-200' }), { status: 200 }),
      )

      start(tempDir, 4000)
      await vi.advanceTimersByTimeAsync(1500)

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
      const desc = body.description as string
      expect(desc).toContain('You are pixel')
      expect(desc).toContain('**Title:** My Title')
      expect(desc).toContain('**Type:** image')
      expect(desc).toContain('**Tone:** playful')
      expect(desc).toContain('Create a fun image')
      expect(desc).toContain('localhost:4000')
      expect(desc).toContain('#art')
    })
  })
})
