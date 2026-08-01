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

import { renderToStaticMarkup } from 'react-dom/server'
import { NavBadge, NavBadgeDot, navBadgeAriaSuffix } from '../../packages/host/src/components/layout/nav-badge'

// Render to an HTML string rather than mounting into happy-dom — these are
// pure presentational components, so the markup is enough to assert on, and
// it keeps this file's memory footprint near zero (the full --isolate suite
// sits close to a Bun segfault threshold; mounting here would add to it).

describe('NavBadge', () => {
  it('renders nothing when badge is undefined', () => {
    expect(renderToStaticMarkup(<NavBadge badge={undefined} />)).toBe('')
  })

  it('renders nothing when count is 0', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ count: 0 }} />)).toBe('')
  })

  it('renders a pill with the count when count is positive', () => {
    const html = renderToStaticMarkup(<NavBadge badge={{ count: 3 }} />)
    expect(html).toContain('nav-badge-pill')
    expect(html).toContain('>3<')
  })

  it('clamps counts above 99 to "99+"', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ count: 250 }} />)).toContain('99+')
  })

  it('renders a dot (no count) when count is omitted', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ tone: 'info' }} />)).toContain('bg-bakin-signal-info')
  })

  // Counted pills ride the kit Badge (size xs, solid) — tone maps to the
  // Badge tone vocabulary and the data attributes are the contract.
  it('applies the attention tone by default', () => {
    const html = renderToStaticMarkup(<NavBadge badge={{ count: 1 }} />)
    expect(html).toContain('data-tone="attention"')
    expect(html).toContain('data-size="xs"')
    expect(html).toContain('data-variant="solid"')
  })

  it('maps info tone onto the kit info tone', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ count: 1, tone: 'info' }} />)).toContain('data-tone="info"')
  })

  it('maps success tone onto the kit success tone', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ count: 1, tone: 'success' }} />)).toContain('data-tone="success"')
  })

  it('maps error tone onto the kit danger tone', () => {
    expect(renderToStaticMarkup(<NavBadge badge={{ count: 1, tone: 'error' }} />)).toContain('data-tone="danger"')
  })
})

describe('NavBadgeDot', () => {
  it('renders a small dot using the given tone', () => {
    expect(renderToStaticMarkup(<NavBadgeDot tone="attention" />)).toContain('bg-bakin-signal-highlight')
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

  it('formats presence-only error (no count) as "urgent"', () => {
    expect(navBadgeAriaSuffix({ tone: 'error' })).toBe(', urgent')
  })
})
