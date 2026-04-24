import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

const { hoistedBakinHome } = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const bakinHome = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  process.env.BAKIN_HOME = bakinHome
  process.env.OPENCLAW_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  return { hoistedBakinHome: bakinHome }
})()

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => hoistedBakinHome,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import { readRuns, getLastRun } from '@bakin/schedule/lib/runs-reader'

const testDir = join(tmpdir(), `bakin-test-runs-${Date.now()}`)

describe('schedule/runs-reader', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns empty array for nonexistent file', () => {
    const runs = readRuns('nonexistent', 50, testDir)
    expect(runs).toEqual([])
  })

  it('parses valid JSONL entries', () => {
    const lines = [
      JSON.stringify({ runId: 'r1', jobId: 'j1', timestamp: '2026-03-27T09:00:00Z', status: 'success' }),
      JSON.stringify({ runId: 'r2', jobId: 'j1', timestamp: '2026-03-26T09:00:00Z', status: 'failure', error: 'timeout' }),
    ]
    writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

    const runs = readRuns('j1', 50, testDir)
    expect(runs).toHaveLength(2)
    expect(runs[0].runId).toBe('r1') // newest first
    expect(runs[1].runId).toBe('r2')
  })

  it('sorts newest-first', () => {
    const lines = [
      JSON.stringify({ runId: 'old', jobId: 'j1', timestamp: '2026-03-25T09:00:00Z', status: 'success' }),
      JSON.stringify({ runId: 'new', jobId: 'j1', timestamp: '2026-03-27T09:00:00Z', status: 'success' }),
    ]
    writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

    const runs = readRuns('j1', 50, testDir)
    expect(runs[0].runId).toBe('new')
    expect(runs[1].runId).toBe('old')
  })

  it('respects limit parameter', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ runId: `r${i}`, jobId: 'j1', timestamp: `2026-03-${(20 + i).toString().padStart(2, '0')}T09:00:00Z`, status: 'success' })
    )
    writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

    const runs = readRuns('j1', 3, testDir)
    expect(runs).toHaveLength(3)
  })

  it('skips malformed lines', () => {
    const lines = [
      JSON.stringify({ runId: 'r1', jobId: 'j1', timestamp: '2026-03-27T09:00:00Z', status: 'success' }),
      'not json at all',
      JSON.stringify({ runId: 'r2', jobId: 'j1', timestamp: '2026-03-26T09:00:00Z', status: 'success' }),
    ]
    writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

    const runs = readRuns('j1', 50, testDir)
    expect(runs).toHaveLength(2)
  })

  it('skips entries missing required fields', () => {
    const lines = [
      JSON.stringify({ runId: 'r1', jobId: 'j1', timestamp: '2026-03-27T09:00:00Z', status: 'success' }),
      JSON.stringify({ runId: 'r2' }), // missing jobId and timestamp
    ]
    writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

    const runs = readRuns('j1', 50, testDir)
    expect(runs).toHaveLength(1)
  })

  it('handles empty file', () => {
    writeFileSync(join(testDir, 'j1.jsonl'), '')
    const runs = readRuns('j1', 50, testDir)
    expect(runs).toEqual([])
  })

  describe('getLastRun', () => {
    it('returns null for nonexistent job', () => {
      expect(getLastRun('nonexistent', testDir)).toBeNull()
    })

    it('returns the most recent run', () => {
      const lines = [
        JSON.stringify({ runId: 'old', jobId: 'j1', timestamp: '2026-03-25T09:00:00Z', status: 'failure' }),
        JSON.stringify({ runId: 'new', jobId: 'j1', timestamp: '2026-03-27T09:00:00Z', status: 'success' }),
      ]
      writeFileSync(join(testDir, 'j1.jsonl'), lines.join('\n'))

      const last = getLastRun('j1', testDir)
      expect(last).not.toBeNull()
      expect(last!.runId).toBe('new')
      expect(last!.status).toBe('success')
    })
  })
})
