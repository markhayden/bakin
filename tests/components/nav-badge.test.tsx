// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-nav-badge-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { render, screen } from '@testing-library/react'
import { NavBadge, NavBadgeDot, navBadgeAriaSuffix } from '../../packages/host/src/components/layout/nav-badge'

describe('NavBadge', () => {
  it('renders nothing when badge is undefined', () => {
    const { container } = render(<NavBadge badge={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is 0', () => {
    const { container } = render(<NavBadge badge={{ count: 0 }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a pill with the count when count is positive', () => {
    render(<NavBadge badge={{ count: 3 }} />)
    expect(screen.getByTestId('nav-badge-pill').textContent).toBe('3')
  })

  it('clamps counts above 99 to "99+"', () => {
    render(<NavBadge badge={{ count: 250 }} />)
    expect(screen.getByTestId('nav-badge-pill').textContent).toBe('99+')
  })

  it('renders a dot when count is omitted', () => {
    render(<NavBadge badge={{ tone: 'info' }} />)
    expect(screen.getByTestId('nav-badge-pill').className).toContain('bg-sky-400')
  })

  it('applies the attention palette by default', () => {
    render(<NavBadge badge={{ count: 1 }} />)
    expect(screen.getByTestId('nav-badge-pill').className).toContain('bg-amber-500/20')
  })

  it('applies the info palette when tone is info', () => {
    render(<NavBadge badge={{ count: 1, tone: 'info' }} />)
    expect(screen.getByTestId('nav-badge-pill').className).toContain('bg-sky-500/20')
  })

  it('applies the success palette when tone is success', () => {
    render(<NavBadge badge={{ count: 1, tone: 'success' }} />)
    expect(screen.getByTestId('nav-badge-pill').className).toContain('bg-emerald-500/20')
  })

  it('applies the error palette (red) when tone is error', () => {
    render(<NavBadge badge={{ count: 1, tone: 'error' }} />)
    expect(screen.getByTestId('nav-badge-pill').className).toContain('bg-red-500/20')
  })
})

describe('NavBadgeDot', () => {
  it('renders a small dot using the given tone', () => {
    render(<NavBadgeDot tone="attention" />)
    expect(screen.getByTestId('nav-badge-dot').className).toContain('bg-amber-400')
  })
})

describe('navBadgeAriaSuffix', () => {
  it('returns empty string when no badge', () => {
    expect(navBadgeAriaSuffix(undefined)).toBe('')
  })

  it('returns empty string when count is 0', () => {
    expect(navBadgeAriaSuffix({ count: 0 })).toBe('')
  })

  it('formats count + attention tone as "needing review"', () => {
    expect(navBadgeAriaSuffix({ count: 3, tone: 'attention' })).toBe(', 3 needing review')
  })

  it('formats count + info tone as the tone label', () => {
    expect(navBadgeAriaSuffix({ count: 2, tone: 'info' })).toBe(', 2 info')
  })

  it('clamps counts in aria suffix', () => {
    expect(navBadgeAriaSuffix({ count: 300 })).toBe(', 99+ needing review')
  })

  it('returns just the tone for presence-only badges', () => {
    expect(navBadgeAriaSuffix({ tone: 'success' })).toBe(', success')
  })

  it('formats error tone as the neutral word "urgent"', () => {
    expect(navBadgeAriaSuffix({ count: 3, tone: 'error' })).toBe(', 3 urgent')
  })
})
