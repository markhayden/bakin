/**
 * Runtime-management page reducers (P3.3) — the capability matrix rows and
 * the runtime:switch SSE progress fold, pure and DOM-free.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure reducer suite; content-dir mocked to satisfy the isolation guard.
const testDir = join(tmpdir(), `bakin-test-runtime-report-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { capabilityRows, reduceSwitchProgress, type SwitchStepRow } from '../../packages/host/src/lib/runtime-report'

const PI_CAPS = {
  toolCalling: { mode: 'native', access: { style: 'in-process' } },
  delivery: { mode: 'unavailable' },
  imageGen: { mode: 'native' },
  memory: { mode: 'native' },
  sessions: { mode: 'native' },
  workspaceFiles: { mode: 'native' },
  concurrency: { sameAgentTurns: 'serialized' },
  input: { imageInput: true, audioInput: false },
}

describe('capabilityRows', () => {
  it('flattens a CapabilitySet into ordered, labelled rows', () => {
    const rows = capabilityRows(PI_CAPS)
    expect(rows.map((r) => r.key)).toEqual([
      'toolCalling', 'delivery', 'imageGen', 'memory', 'sessions', 'workspaceFiles', 'input',
    ])
    expect(rows[0]).toEqual({ key: 'toolCalling', label: 'Tool calling', mode: 'native', detail: 'in-process' })
    expect(rows.find((r) => r.key === 'delivery')!.mode).toBe('unavailable')
    expect(rows.find((r) => r.key === 'input')).toEqual({ key: 'input', label: 'Model input', mode: 'native', detail: 'image' })
  })

  it('renders text-only input honestly and tolerates null payloads', () => {
    const rows = capabilityRows({ ...PI_CAPS, input: { imageInput: false, audioInput: false } })
    expect(rows.find((r) => r.key === 'input')).toEqual({ key: 'input', label: 'Model input', mode: 'unavailable', detail: 'text only' })
    expect(capabilityRows(null)).toEqual([])
    expect(capabilityRows(undefined)).toEqual([])
  })
})

describe('reduceSwitchProgress', () => {
  it('appends running steps and resolves them in place', () => {
    let steps: SwitchStepRow[] = []
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'validate', status: 'start' })
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'validate', status: 'ok', detail: 'openclaw → pi' })
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'backup', status: 'start' })
    expect(steps).toEqual([
      { phase: 'validate', status: 'ok', detail: 'openclaw → pi' },
      { phase: 'backup', status: 'running' },
    ])
  })

  it('resolves a step that never emitted start, marks errors, and ignores foreign events', () => {
    let steps: SwitchStepRow[] = []
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'sync-agents', status: 'skip', detail: 'no drift' })
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'provision', status: 'error', detail: 'boom' })
    steps = reduceSwitchProgress(steps, { type: 'task:update' })
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch' })
    expect(steps).toEqual([
      { phase: 'sync-agents', status: 'skip', detail: 'no drift' },
      { phase: 'provision', status: 'error', detail: 'boom' },
    ])
  })

  it('a duplicate start is a no-op (idempotent stream)', () => {
    let steps: SwitchStepRow[] = []
    steps = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'flip', status: 'start' })
    const again = reduceSwitchProgress(steps, { type: 'runtime:switch', phase: 'flip', status: 'start' })
    expect(again).toEqual([{ phase: 'flip', status: 'running' }])
  })
})
