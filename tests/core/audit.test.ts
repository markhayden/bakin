import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
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

vi.mock('../../src/core/antfly', () => ({
  indexAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

import { appendAudit } from '../../src/core/audit'
import { indexAuditEvent } from '../../src/core/antfly'

describe('audit', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-audit-'))
    vi.clearAllMocks()
    delete (globalThis as any).__bakinBroadcastAudit
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // appendAudit — file writing
  // ---------------------------------------------------------------------------

  describe('file writing', () => {
    it('creates audit.jsonl and writes a JSONL entry', () => {
      appendAudit(tempDir, 'test.event', 'pixel', { foo: 'bar' })

      const auditFile = join(tempDir, 'audit.jsonl')
      expect(existsSync(auditFile)).toBe(true)

      const line = readFileSync(auditFile, 'utf-8').trim()
      const entry = JSON.parse(line)
      expect(entry.event).toBe('test.event')
      expect(entry.agent).toBe('pixel')
      expect(entry.data).toEqual({ foo: 'bar' })
      expect(entry.ts).toBeDefined()
    })

    it('appends multiple entries as separate lines', () => {
      appendAudit(tempDir, 'event.a', 'pixel')
      appendAudit(tempDir, 'event.b', 'nemo')

      const lines = readFileSync(join(tempDir, 'audit.jsonl'), 'utf-8')
        .trim()
        .split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).event).toBe('event.a')
      expect(JSON.parse(lines[1]).event).toBe('event.b')
    })

    it('defaults data to empty object', () => {
      appendAudit(tempDir, 'no.data', 'pixel')

      const line = readFileSync(join(tempDir, 'audit.jsonl'), 'utf-8').trim()
      const entry = JSON.parse(line)
      expect(entry.data).toEqual({})
    })

    it('includes channel when provided', () => {
      appendAudit(tempDir, 'with.channel', 'pixel', { x: 1 }, 'mcp')

      const line = readFileSync(join(tempDir, 'audit.jsonl'), 'utf-8').trim()
      const entry = JSON.parse(line)
      expect(entry.channel).toBe('mcp')
    })

    it('omits channel field when not provided', () => {
      appendAudit(tempDir, 'no.channel', 'pixel')

      const line = readFileSync(join(tempDir, 'audit.jsonl'), 'utf-8').trim()
      const entry = JSON.parse(line)
      expect(entry).not.toHaveProperty('channel')
    })

    it('creates parent directories if they do not exist', () => {
      const nested = join(tempDir, 'deep', 'nested')
      appendAudit(nested, 'nested.event', 'pixel')
      expect(existsSync(join(nested, 'audit.jsonl'))).toBe(true)
    })

    it('does not throw on write failure', () => {
      // Pass a path that can't be written (file as dir)
      const badPath = join(tempDir, 'audit.jsonl', 'impossible')
      expect(() => appendAudit(badPath, 'fail', 'pixel')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // SSE broadcast via globalThis
  // ---------------------------------------------------------------------------

  describe('SSE broadcast', () => {
    it('calls globalThis.__bakinBroadcastAudit when set', () => {
      const broadcastFn = vi.fn()
      ;(globalThis as any).__bakinBroadcastAudit = broadcastFn

      appendAudit(tempDir, 'sse.test', 'pixel', { key: 'value' })

      expect(broadcastFn).toHaveBeenCalledOnce()
      const entry = broadcastFn.mock.calls[0][0]
      expect(entry.event).toBe('sse.test')
      expect(entry.agent).toBe('pixel')
      expect(entry.data).toEqual({ key: 'value' })
    })

    it('does not throw when broadcast is not available', () => {
      delete (globalThis as any).__bakinBroadcastAudit
      expect(() => appendAudit(tempDir, 'no.sse', 'pixel')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Antfly indexing
  // ---------------------------------------------------------------------------

  describe('Antfly indexing', () => {
    it('calls indexAuditEvent with the entry', () => {
      appendAudit(tempDir, 'antfly.test', 'nemo', { score: 42 })

      expect(vi.mocked(indexAuditEvent)).toHaveBeenCalledOnce()
      const entry = vi.mocked(indexAuditEvent).mock.calls[0][0]
      expect(entry.event).toBe('antfly.test')
      expect(entry.agent).toBe('nemo')
      expect(entry.data).toEqual({ score: 42 })
    })

    it('does not throw when indexAuditEvent rejects', () => {
      vi.mocked(indexAuditEvent).mockRejectedValueOnce(new Error('antfly down'))
      expect(() => appendAudit(tempDir, 'antfly.fail', 'pixel')).not.toThrow()
    })
  })
})
