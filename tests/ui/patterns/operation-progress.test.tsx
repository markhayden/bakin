// @vitest-environment jsdom
/**
 * OperationProgress (#895 D4/D13): stuck is judged from progress alone,
 * a restart never also reads as stuck, the live clock stops once settled,
 * and the byte/duration copy the stories pin.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'

import { OperationProgress, type OperationProgressProps } from '@makinbakin/sdk/patterns'
import { formatOperationBytes, formatOperationDuration } from '../../../packages/sdk/src/patterns/operation-progress'
import { actRender } from '../../rtl-settle'

afterEach(cleanup)

type OperationView = OperationProgressProps['operation']
const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()

function view(over: Partial<OperationView> = {}): OperationView {
  return {
    id: 'op-1',
    children: [],
    rev: 1,
    bootId: 'boot-a',
    kind: 'install',
    owner: 'core',
    origin: 'web',
    title: 'Install',
    fingerprint: 'install:x',
    resources: [],
    status: 'running',
    plan: { stages: [{ id: 'build', kind: 'building', label: 'Build' }], pointOfNoReturn: null },
    stages: [{ id: 'build', kind: 'building', label: 'Build', status: 'active', startedAt: ago(300) }],
    cancellable: true,
    startedAt: ago(300),
    lastProgressAt: ago(300),
    lastLivenessAt: ago(0),
    lastOutput: 'compiling…',
    log: [],
    ...over,
  }
}

describe('formatting', () => {
  it('formats durations and decimal byte sizes', () => {
    expect(formatOperationDuration(14_400)).toBe('14s')
    expect(formatOperationDuration(125_000)).toBe('2m 05s')
    expect(formatOperationDuration(3_720_000)).toBe('1h 02m')
    expect(formatOperationDuration(-5)).toBe('0s')
    expect(formatOperationBytes(999)).toBe('999 B')
    expect(formatOperationBytes(12_400_000)).toBe('12.4 MB')
    expect(formatOperationBytes(2_500_000_000)).toBe('2.5 GB')
  })
})

describe('OperationProgress', () => {
  it('reports stuck from progress alone, even while output keeps arriving', () => {
    render(<OperationProgress operation={view()} now={NOW} />)
    expect(screen.getByText('No progress for 5m 00s')).toBeTruthy()
    expect(screen.getByText('compiling…')).toBeTruthy()
  })

  it('never reports a restarted operation as stuck', () => {
    render(<OperationProgress operation={view()} phase="restarted" now={NOW} />)
    expect(screen.getByText('Bakin restarted while this was running')).toBeTruthy()
    expect(screen.queryByText(/^No progress for/)).toBeNull()
  })

  it('offers Cancel only while cancel is allowed', () => {
    const { rerender } = render(<OperationProgress operation={view()} now={NOW} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    rerender(<OperationProgress operation={view({ cancellable: false, plan: { stages: [], pointOfNoReturn: 'build' } })} now={NOW} onCancel={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByText('Will finish — past the point of no return')).toBeTruthy()
  })

  it('ticks its elapsed clock while running and freezes it once finished', async () => {
    const realNow = Date.now
    let clock = NOW
    Date.now = () => clock
    try {
      const running = view({ startedAt: ago(10), lastProgressAt: ago(0), stages: [{ id: 'build', kind: 'building', label: 'Build', status: 'active', startedAt: ago(10) }] })
      const { rerender } = await actRender(() => render(<OperationProgress operation={running} />))
      expect(screen.getAllByText('10s').length).toBeGreaterThan(0)
      await act(async () => {
        clock += 3_000
        await new Promise((r) => setTimeout(r, 1_100))
      })
      expect(screen.getAllByText('13s').length).toBeGreaterThan(0)

      const done = { ...running, status: 'succeeded' as const, endedAt: new Date(clock).toISOString(), stages: [{ ...running.stages[0]!, status: 'done' as const, endedAt: new Date(clock).toISOString() }] }
      rerender(<OperationProgress operation={done} />)
      await act(async () => {
        clock += 60_000
        await new Promise((r) => setTimeout(r, 1_100))
      })
      expect(screen.getAllByText('13s').length).toBeGreaterThan(0)
      expect(screen.queryByText('1m 13s')).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
