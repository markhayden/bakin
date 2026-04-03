import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock logger to suppress output during tests
vi.mock('@/core/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock antfly — we test the integration call, not antfly internals
const mockIndexAuditEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/core/antfly', () => ({
  indexAuditEvent: (...args: unknown[]) => mockIndexAuditEvent(...args),
}))

describe('audit', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bakin-audit-test-'))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
    mockIndexAuditEvent.mockClear()
    // Clear SSE broadcast between tests
    delete (globalThis as any).__bakinBroadcastAudit
  })

  afterEach(() => {
    vi.useRealTimers()
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* cleanup best-effort */ }
  })

  // -----------------------------------------------------------------------
  // JSONL file writing
  // -----------------------------------------------------------------------

  describe('appendAudit — JSONL writing', () => {
    it('appends a valid JSONL entry to audit.jsonl', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'task.created', 'patch', { taskId: 'abc123' })

      const content = readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(1)

      const entry = JSON.parse(lines[0])
      expect(entry).toMatchObject({
        ts: '2026-06-15T12:00:00.000Z',
        event: 'task.created',
        agent: 'patch',
        data: { taskId: 'abc123' },
      })
    })

    it('appends multiple entries as separate lines', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'task.created', 'patch', { id: '1' })
      appendAudit(tmpDir, 'task.completed', 'scout', { id: '2' })
      appendAudit(tmpDir, 'task.blocked', 'basil', { id: '3' })

      const content = readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(3)

      const events = lines.map(l => JSON.parse(l).event)
      expect(events).toEqual(['task.created', 'task.completed', 'task.blocked'])
    })

    it('creates parent directories if they do not exist', async () => {
      const { appendAudit } = await import('@/core/audit')
      const nestedDir = join(tmpDir, 'deep', 'nested', 'content')

      appendAudit(nestedDir, 'test.event', 'patch')

      expect(existsSync(join(nestedDir, 'audit.jsonl'))).toBe(true)
      const entry = JSON.parse(readFileSync(join(nestedDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.event).toBe('test.event')
    })

    it('defaults data to empty object when omitted', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'simple.event', 'patch')

      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.data).toEqual({})
    })

    it('includes channel when provided', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'mcp.call', 'patch', { tool: 'test' }, 'mcp')

      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.channel).toBe('mcp')
    })

    it('omits channel key when not provided', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'test.event', 'patch', {})

      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry).not.toHaveProperty('channel')
    })

    it('accepts all valid channel types', async () => {
      const { appendAudit } = await import('@/core/audit')
      const channels = ['mcp', 'rest', 'cli', 'system'] as const

      for (const ch of channels) {
        appendAudit(tmpDir, `${ch}.event`, 'patch', {}, ch)
      }

      const lines = readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim().split('\n')
      expect(lines).toHaveLength(4)
      const parsedChannels = lines.map(l => JSON.parse(l).channel)
      expect(parsedChannels).toEqual(['mcp', 'rest', 'cli', 'system'])
    })

    it('does not throw when file write fails (logs error instead)', async () => {
      const { appendAudit } = await import('@/core/audit')

      // Pass a path that cannot be created (null byte in path)
      expect(() => {
        appendAudit('/dev/null/\0invalid', 'test.event', 'patch')
      }).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // SSE broadcast
  // -----------------------------------------------------------------------

  describe('appendAudit — SSE broadcast', () => {
    it('calls globalThis.__bakinBroadcastAudit when available', async () => {
      const { appendAudit } = await import('@/core/audit')
      const broadcastSpy = vi.fn()
      ;(globalThis as any).__bakinBroadcastAudit = broadcastSpy

      appendAudit(tmpDir, 'sse.test', 'patch', { key: 'value' })

      expect(broadcastSpy).toHaveBeenCalledOnce()
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ts: '2026-06-15T12:00:00.000Z',
          event: 'sse.test',
          agent: 'patch',
          data: { key: 'value' },
        }),
      )
    })

    it('does not throw when SSE broadcast is not registered', async () => {
      const { appendAudit } = await import('@/core/audit')
      delete (globalThis as any).__bakinBroadcastAudit

      expect(() => {
        appendAudit(tmpDir, 'no.sse', 'patch')
      }).not.toThrow()
    })

    it('broadcasts the same entry that was written to disk', async () => {
      const { appendAudit } = await import('@/core/audit')
      const broadcastSpy = vi.fn()
      ;(globalThis as any).__bakinBroadcastAudit = broadcastSpy

      appendAudit(tmpDir, 'sync.check', 'scout', { x: 1 }, 'rest')

      const diskEntry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      const broadcastedEntry = broadcastSpy.mock.calls[0][0]

      expect(diskEntry).toEqual(broadcastedEntry)
    })
  })

  // -----------------------------------------------------------------------
  // Antfly indexing
  // -----------------------------------------------------------------------

  describe('appendAudit — Antfly indexing', () => {
    it('calls indexAuditEvent with the audit entry', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'antfly.test', 'patch', { indexed: true })

      expect(mockIndexAuditEvent).toHaveBeenCalledOnce()
      expect(mockIndexAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          ts: '2026-06-15T12:00:00.000Z',
          event: 'antfly.test',
          agent: 'patch',
          data: { indexed: true },
        }),
      )
    })

    it('does not throw when indexAuditEvent rejects', async () => {
      mockIndexAuditEvent.mockRejectedValueOnce(new Error('antfly down'))
      const { appendAudit } = await import('@/core/audit')

      // The .catch() in audit.ts swallows the rejection
      expect(() => {
        appendAudit(tmpDir, 'antfly.fail', 'patch')
      }).not.toThrow()
    })

    it('still writes to disk even when antfly rejects', async () => {
      mockIndexAuditEvent.mockRejectedValueOnce(new Error('antfly down'))
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'disk.always', 'patch', { resilient: true })

      expect(existsSync(join(tmpDir, 'audit.jsonl'))).toBe(true)
      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.event).toBe('disk.always')
    })
  })

  // -----------------------------------------------------------------------
  // Entry structure
  // -----------------------------------------------------------------------

  describe('appendAudit — entry structure', () => {
    it('produces valid JSON on every line', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'json.check', 'patch', { nested: { deep: true } })
      appendAudit(tmpDir, 'json.special', 'scout', { text: 'quotes "and" newlines\n' })

      const lines = readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim().split('\n')
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    it('each line ends with newline for proper JSONL format', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'newline.check', 'patch')

      const raw = readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8')
      expect(raw.endsWith('\n')).toBe(true)
    })

    it('includes ts as ISO-8601 string', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'ts.check', 'patch')

      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })

    it('spreads data fields into the entry alongside required keys', async () => {
      const { appendAudit } = await import('@/core/audit')

      appendAudit(tmpDir, 'spread.test', 'patch', { custom: 'field', count: 42 })

      const entry = JSON.parse(readFileSync(join(tmpDir, 'audit.jsonl'), 'utf-8').trim())
      expect(entry.data.custom).toBe('field')
      expect(entry.data.count).toBe(42)
    })
  })
})
