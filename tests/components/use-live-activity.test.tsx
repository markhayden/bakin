// @vitest-environment jsdom
/**
 * useLiveActivity (tasks board chips) — ingress rules for the ephemeral
 * turn-activity events: event-own timestamps (replay honesty), stale-drop,
 * malformed-chunk tolerance, parent+child chip writes, and the failed-tool
 * marker. The 10s sweep interval reuses the same TTL cutoff pinned here via
 * liveActivityTs.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-use-live-activity-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
// The hook itself is pure client state (react + plugin-event emitter), but
// the isolation rules require the store seams pinned for anything under
// plugins/tasks — belt and braces against future imports.
mock.module('../../src/core/task-store', () => ({}))
mock.module('@/core/task-store', () => ({}))

import { act, render, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { settleReact } from '../rtl-settle'
import { emitPluginEvent } from '@makinbakin/sdk/hooks'
import { useLiveActivity, chipLabel, liveActivityTs, type LiveActivity } from '../../plugins/tasks/hooks/use-live-activity'

let latest: Record<string, LiveActivity> = {}
function Probe() {
  latest = useLiveActivity()
  return null
}

// The emitter calls listeners synchronously → the hook's setState must run
// inside act(), or under full-suite CPU load the update lands during
// teardown and fails the run (the settleReact/act rule from tests/setup).
function emitActivity(overrides: Record<string, unknown>): void {
  act(() => {
    emitPluginEvent({
      event: 'turn-activity',
      taskId: 't-1',
      agentId: 'jessica',
      runId: 'task:t-1:d1',
      chunk: { type: 'status', content: 'thinking' },
      ts: new Date().toISOString(),
      ...overrides,
    } as never)
  })
}

beforeEach(() => {
  latest = {}
})

describe('chipLabel', () => {
  it('renders tool phases with honest markers', () => {
    expect(chipLabel({ type: 'tool', data: { toolName: 'exec', phase: 'call' } })).toBe('exec…')
    expect(chipLabel({ type: 'tool', data: { toolName: 'exec', phase: 'result', status: 'completed' } })).toBe('exec ✓')
    // A failed tool must NOT get a checkmark.
    expect(chipLabel({ type: 'tool', data: { toolName: 'exec', phase: 'result', status: 'failed' } })).toBe('exec ✗')
    expect(chipLabel({ type: 'status', content: 'thinking' })).toBe('thinking')
    expect(chipLabel({ type: 'status' })).toBe('working…')
  })
})

describe('liveActivityTs', () => {
  it('uses the event timestamp, drops stale, tolerates garbage', () => {
    const now = Date.now()
    expect(liveActivityTs(new Date(now - 1_000).toISOString(), now)).toBe(now - 1_000)
    // Older than the 45s TTL → null (a replayed event never re-chips).
    expect(liveActivityTs(new Date(now - 46_000).toISOString(), now)).toBeNull()
    // Unparseable → receipt time (live events with a mangled ts still chip).
    expect(liveActivityTs('not-a-date', now)).toBe(now)
    expect(liveActivityTs(undefined, now)).toBe(now)
  })
})

describe('useLiveActivity', () => {
  it('chips the task with the event-own timestamp', async () => {
    render(<Probe />)
    const ts = new Date(Date.now() - 2_000).toISOString()
    emitActivity({ ts, chunk: { type: 'tool', data: { toolName: 'web_fetch', phase: 'call' } } })
    await waitFor(() => expect(latest['t-1']).toBeDefined())
    expect(latest['t-1']!.label).toBe('web_fetch…')
    expect(latest['t-1']!.ts).toBe(Date.parse(ts))
  })

  it('drops stale events entirely — replay can never re-chip', async () => {
    render(<Probe />)
    emitActivity({ ts: new Date(Date.now() - 60_000).toISOString() })
    await new Promise((r) => setTimeout(r, 20))
    expect(latest['t-1']).toBeUndefined()
  })

  it('ignores malformed payloads (no chunk / no ids)', async () => {
    render(<Probe />)
    emitActivity({ chunk: undefined })
    emitActivity({ taskId: undefined, childTaskId: undefined })
    await new Promise((r) => setTimeout(r, 20))
    expect(Object.keys(latest)).toHaveLength(0)
  })

  it('chips BOTH parent and child for nested-workflow step turns', async () => {
    render(<Probe />)
    emitActivity({ taskId: 'wf-p', childTaskId: 'wf-p--sub' })
    await waitFor(() => expect(latest['wf-p']).toBeDefined())
    expect(latest['wf-p--sub']).toBeDefined()
    expect(latest['wf-p']!.label).toBe('thinking')
    await settleReact()
  })
})
