// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { NavBadge } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-use-nav-badge-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md (this test touches neither).
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const setNavBadge = mock()
mock.module('../../packages/sdk/src/register', () => ({ setNavBadge }))

import { render } from '@testing-library/react'
import '../rtl-settle'
import { useNavBadge } from '@/hooks/use-nav-badge'

function Probe({ badge }: { badge: NavBadge | null }) {
  useNavBadge('p', 'p-nav', badge)
  return null
}

afterEach(() => {
  setNavBadge.mockClear()
})

describe('useNavBadge', () => {
  it('calls setNavBadge once on mount', () => {
    render(<Probe badge={{ count: 2, tone: 'attention' }} />)
    expect(setNavBadge).toHaveBeenCalledTimes(1)
    expect(setNavBadge).toHaveBeenCalledWith('p', 'p-nav', { count: 2, tone: 'attention' })
  })

  it('does NOT re-call when re-rendered with an equal-value badge (fresh object)', () => {
    const { rerender } = render(<Probe badge={{ count: 2, tone: 'attention' }} />)
    setNavBadge.mockClear()
    rerender(<Probe badge={{ count: 2, tone: 'attention' }} />)
    expect(setNavBadge).not.toHaveBeenCalled()
  })

  it('re-calls when the count changes', () => {
    const { rerender } = render(<Probe badge={{ count: 2, tone: 'attention' }} />)
    setNavBadge.mockClear()
    rerender(<Probe badge={{ count: 5, tone: 'attention' }} />)
    expect(setNavBadge).toHaveBeenCalledWith('p', 'p-nav', { count: 5, tone: 'attention' })
  })

  it('re-calls when only the tone changes', () => {
    const { rerender } = render(<Probe badge={{ count: 2, tone: 'attention' }} />)
    setNavBadge.mockClear()
    rerender(<Probe badge={{ count: 2, tone: 'error' }} />)
    expect(setNavBadge).toHaveBeenCalledWith('p', 'p-nav', { count: 2, tone: 'error' })
  })

  it('passes null through to clear', () => {
    render(<Probe badge={null} />)
    expect(setNavBadge).toHaveBeenCalledWith('p', 'p-nav', null)
  })

  it('re-calls across the clear boundary (value → null → value)', () => {
    const { rerender } = render(<Probe badge={{ count: 3, tone: 'attention' }} />)
    setNavBadge.mockClear()
    rerender(<Probe badge={null} />)
    expect(setNavBadge).toHaveBeenLastCalledWith('p', 'p-nav', null)
    rerender(<Probe badge={{ count: 2, tone: 'attention' }} />)
    expect(setNavBadge).toHaveBeenLastCalledWith('p', 'p-nav', { count: 2, tone: 'attention' })
  })
})
