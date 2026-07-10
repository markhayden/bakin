/**
 * Mechanism probes for tests/rtl-settle.ts — pins the facts behind the
 * kanban/TaskCard CI failures (intra-file React-root leakage under bun:test).
 *
 * Proven facts these tests encode:
 *  1. bun clears document.body between tests (so DOM residue is bun's
 *     concern) — but React ROOTS survive their test unless unmounted.
 *  2. The rtl-settle hook unmounts every test's roots inside act(), so a
 *     leaked async update can never race the unmount ("Attempted to
 *     synchronously unmount a root while React was already rendering").
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { render, screen } from '@testing-library/react'
import { useEffect, useState, type ReactElement } from 'react'

// Standard isolation mocks (CLAUDE.md) — this probe renders pure React and
// never touches storage; the mocks guarantee that stays true.
const testDir = join(tmpdir(), `bakin-test-rtl-settle-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))

import '../rtl-settle'

const events: string[] = []

function DeferredUpdate(): ReactElement {
  const [phase, setPhase] = useState('initial')
  useEffect(() => {
    const t = setTimeout(() => {
      events.push('deferred-update-fired')
      setPhase('settled')
    }, 0)
    return () => {
      events.push('effect-cleanup-ran')
      clearTimeout(t)
    }
  }, [])
  return <div data-probe="phase">{phase}</div>
}

describe('rtl-settle mechanism', () => {
  it('a test can end with async work still scheduled (the hazard shape)', () => {
    render(<DeferredUpdate />)
    // Ends WITHOUT awaiting the deferred update — the shape of an
    // interaction test whose waitFor resolved on a partial commit.
    expect(screen.getByText('initial')).toBeTruthy()
  })

  it('the hook unmounted the leaked root cleanly — no unmount-while-rendering', () => {
    // The root from test 1 was unmounted (its effect cleanup ran) inside
    // act(), with no React error escaping into this test.
    expect(events).toContain('effect-cleanup-ran')
    // And this test starts from a clean slate: rendering works normally.
    render(<div data-probe="second">fresh</div>)
    expect(screen.getByText('fresh')).toBeTruthy()
    expect(document.querySelectorAll('[data-probe]').length).toBe(1)
  })
})
