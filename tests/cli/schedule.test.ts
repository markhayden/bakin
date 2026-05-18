import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import {
  cmdScheduleList,
  cmdScheduleAdd,
  cmdSchedulePause,
  cmdScheduleResume,
  cmdScheduleRemove,
  cmdScheduleRun,
  cmdScheduleRuns,
} from '../../src/cli/schedule'

/**
 * CLI schedule tests verify that each command calls the correct API endpoint
 * with the correct payload. We mock global fetch to intercept HTTP calls.
 */

const mockFetch = mock()
const consoleSpy = spyOn(console, 'log').mockImplementation(() => {})

describe('CLI schedule commands', () => {
  const originalFetch = globalThis.fetch
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function output(): string {
    return consoleSpy.mock.calls.map(c => String(c[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (typeof input === 'string' && input.startsWith('data:')) return originalFetch(input, init)
      return mockFetch(input, init)
    }) as typeof fetch
    setStdoutIsTTY(false)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
  })

  function mockJsonResponse(data: unknown) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(''),
    })
  }

  function expectGetTo(path: string) {
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(path),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    )
  }

  function expectPostTo(path: string, body: Record<string, unknown>) {
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(path),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      })
    )
  }

  describe('cmdScheduleList', () => {
    it('calls GET /api/plugins/schedule/', async () => {
      mockJsonResponse({ jobs: [] })
      await cmdScheduleList({})
      expectGetTo('/api/plugins/schedule/')
    })

    it('filters to Bakin jobs by default', async () => {
      mockJsonResponse({
        jobs: [
          { id: 'j1', displayName: 'Bakin Job', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: true },
          { id: 'j2', displayName: 'Other Job', isBakinJob: false, humanSchedule: 'weekly', paused: false, enabled: true },
        ],
      })
      await cmdScheduleList({})
      // Should only show Bakin job (1 header line + 1 separator + 1 job = logged displayName once)
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('Bakin Job')
      expect(output).not.toContain('Other Job')
    })

    it('shows all jobs with --all flag', async () => {
      mockJsonResponse({
        jobs: [
          { id: 'j1', displayName: 'Bakin Job', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: true },
          { id: 'j2', displayName: 'Other Job', isBakinJob: false, humanSchedule: 'weekly', paused: false, enabled: true },
        ],
      })
      await cmdScheduleList({ all: true })
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('Bakin Job')
      expect(output).toContain('Other Job')
    })

    it('filters by agent', async () => {
      mockJsonResponse({
        jobs: [
          { id: 'j1', displayName: 'Chef Job', agentId: 'chef', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: true },
          { id: 'j2', displayName: 'Pixel Job', agentId: 'pixel', isBakinJob: true, humanSchedule: 'weekly', paused: false, enabled: true },
        ],
      })
      await cmdScheduleList({ agent: 'chef' })
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('Chef Job')
      expect(output).not.toContain('Pixel Job')
    })

    it('outputs JSON with --json flag', async () => {
      mockJsonResponse({
        jobs: [
          { id: 'j1', displayName: 'Test', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: true },
        ],
      })
      await cmdScheduleList({ json: true })
      const output = consoleSpy.mock.calls[0][0]
      const parsed = JSON.parse(output)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].id).toBe('j1')
    })

    it('shows empty message when no jobs', async () => {
      mockJsonResponse({ jobs: [] })
      await cmdScheduleList({})
      expect(consoleSpy).toHaveBeenCalledWith('No scheduled jobs found.')
    })

    it('shows status correctly for paused/active/disabled', async () => {
      mockJsonResponse({
        jobs: [
          { id: 'j1', displayName: 'Paused', isBakinJob: true, humanSchedule: 'daily', paused: true, enabled: true },
          { id: 'j2', displayName: 'Active', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: true },
          { id: 'j3', displayName: 'Disabled', isBakinJob: true, humanSchedule: 'daily', paused: false, enabled: false },
        ],
      })
      await cmdScheduleList({ all: true })
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('paused')
      expect(output).toContain('active')
      expect(output).toContain('disabled')
    })
  })

  describe('cmdScheduleAdd', () => {
    it('calls POST /api/plugins/schedule/ with correct payload', async () => {
      mockJsonResponse({ ok: true, jobId: 'new-1', cron: '0 9 * * *', human: 'Every day at 9:00 AM' })
      await cmdScheduleAdd({ name: 'Daily Check', schedule: 'every day at 9am', agent: 'chef' })
      expectPostTo('/api/plugins/schedule/', {
        name: 'Daily Check',
        schedule: 'every day at 9am',
        agentId: 'chef',
        workflowId: undefined,
        taskPrompt: undefined,
      })
    })

    it('prints confirmation with job ID and human schedule', async () => {
      mockJsonResponse({ ok: true, jobId: 'new-1', cron: '0 9 * * *', human: 'Every day at 9:00 AM' })
      await cmdScheduleAdd({ name: 'Daily Check', schedule: 'every day at 9am' })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Daily Check'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('new-1'))
    })

    it('passes workflow and prompt when provided', async () => {
      mockJsonResponse({ ok: true, jobId: 'new-2', cron: '0 9 * * 1-5', human: 'Every weekday at 9am' })
      await cmdScheduleAdd({
        name: 'Weekday Post',
        schedule: 'every weekday at 9am',
        agent: 'pixel',
        workflow: 'image-social-post',
        prompt: 'Create daily social media image',
      })
      expectPostTo('/api/plugins/schedule/', {
        name: 'Weekday Post',
        schedule: 'every weekday at 9am',
        agentId: 'pixel',
        workflowId: 'image-social-post',
        taskPrompt: 'Create daily social media image',
      })
    })

    it('renders action confirmations with the shared TUI in a TTY', async () => {
      setStdoutIsTTY(true)

      mockJsonResponse({ ok: true, jobId: 'new-1', cron: '0 9 * * *', human: 'Every day at 9:00 AM' })
      await cmdScheduleAdd({ name: 'Daily Check', schedule: 'every day at 9am' })

      mockJsonResponse({ ok: true })
      await cmdSchedulePause('new-1', { until: '2026-04-01' })

      mockJsonResponse({ ok: true })
      await cmdScheduleResume('new-1')

      mockJsonResponse({ ok: true })
      await cmdScheduleRun('new-1')

      mockJsonResponse({ ok: true })
      await cmdScheduleRemove('new-1')

      expect(output()).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
      expect(output()).toContain('Schedule action')
      expect(output()).toContain('RESULT')
      expect(output()).toContain('Created schedule Daily Check')
      expect(output()).toContain('Paused new-1')
      expect(output()).toContain('Resumed new-1')
      expect(output()).toContain('Triggered immediate run for new-1')
      expect(output()).toContain('Removed new-1')
      expect(output()).not.toContain('Created schedule "Daily Check"')
    })
  })

  describe('cmdSchedulePause', () => {
    it('calls POST /api/plugins/schedule/job-1/pause with pause action', async () => {
      mockJsonResponse({ ok: true })
      await cmdSchedulePause('job-1', {})
      expectPostTo('/api/plugins/schedule/job-1/pause', { action: 'pause', pauseUntil: undefined })
    })

    it('passes pauseUntil when --until provided', async () => {
      mockJsonResponse({ ok: true })
      await cmdSchedulePause('job-1', { until: '2026-04-01' })
      expectPostTo('/api/plugins/schedule/job-1/pause', { action: 'pause', pauseUntil: '2026-04-01' })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('until 2026-04-01'))
    })

    it('sends skip action with count when --skip provided', async () => {
      mockJsonResponse({ ok: true })
      await cmdSchedulePause('job-1', { skip: 3 })
      expectPostTo('/api/plugins/schedule/job-1/pause', { action: 'skip', skipN: 3 })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping next 3'))
    })
  })

  describe('cmdScheduleResume', () => {
    it('calls POST /api/plugins/schedule/job-1/pause with resume action', async () => {
      mockJsonResponse({ ok: true })
      await cmdScheduleResume('job-1')
      expectPostTo('/api/plugins/schedule/job-1/pause', { action: 'resume' })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Resumed'))
    })
  })

  describe('cmdScheduleRemove', () => {
    it('calls DELETE /api/plugins/schedule/job-1', async () => {
      mockJsonResponse({ ok: true })
      await cmdScheduleRemove('job-1')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/schedule/job-1'),
        expect.objectContaining({ method: 'DELETE' })
      )
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed'))
    })
  })

  describe('cmdScheduleRun', () => {
    it('calls POST /api/plugins/schedule/job-1/run', async () => {
      mockJsonResponse({ ok: true })
      await cmdScheduleRun('job-1')
      expectPostTo('/api/plugins/schedule/job-1/run', {})
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Triggered'))
    })
  })

  describe('cmdScheduleRuns', () => {
    it('calls GET /api/plugins/schedule/job-1/runs', async () => {
      mockJsonResponse({ runs: [] })
      await cmdScheduleRuns('job-1', {})
      expectGetTo('/api/plugins/schedule/job-1/runs?limit=20')
    })

    it('uses custom limit', async () => {
      mockJsonResponse({ runs: [] })
      await cmdScheduleRuns('job-1', { limit: 5 })
      expectGetTo('/api/plugins/schedule/job-1/runs?limit=5')
    })

    it('shows empty message when no runs', async () => {
      mockJsonResponse({ runs: [] })
      await cmdScheduleRuns('job-1', {})
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No run history'))
    })

    it('formats run history table', async () => {
      mockJsonResponse({
        runs: [
          { runId: 'r1', timestamp: '2026-03-27T09:00:00Z', status: 'ok', taskId: 'task-1' },
          { runId: 'r2', timestamp: '2026-03-27T08:00:00Z', status: 'error', error: 'timeout' },
        ],
      })
      await cmdScheduleRuns('job-1', {})
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('task-1')
      expect(output).toContain('timeout')
    })
  })

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('Not found'),
      })
      await expect(cmdScheduleList({})).rejects.toThrow('API error 404')
    })
  })
})
