import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NavItem } from '@makinbakin/sdk'

const testDir = join(tmpdir(), `bakin-test-nav-badge-logic-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md, even though this is pure logic.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import {
  badgeIsActive,
  isNavActive,
  pickRollupTone,
  collapsedParentRollupTone,
  collapsedParentAriaSuffix,
} from '../../packages/host/src/components/layout/nav-badge-logic'

// NOTE: these are the pure decisions behind AppSidebar's badge rendering.
// We test them directly instead of mounting AppSidebar, because importing
// the sidebar's transitive base-ui/lucide graph segfaults Bun under the
// full --isolate suite. The NavBadge / NavBadgeDot *components* are covered
// in nav-badge.test.tsx; the end-to-end visual wiring is verified manually
// against the imitation-crab dev loop (see the messaging consumer in PR #2).

const parent = (children: NavItem[]): NavItem => ({
  id: 'group',
  label: 'Group',
  icon: 'Workflow',
  href: '/group',
  children,
})

const child = (id: string): NavItem => ({ id, label: id, icon: 'ClipboardList', href: `/group/${id}` })

describe('badgeIsActive', () => {
  it('false for undefined', () => expect(badgeIsActive(undefined)).toBe(false))
  it('false for count 0', () => expect(badgeIsActive({ count: 0 })).toBe(false))
  it('false for negative count', () => expect(badgeIsActive({ count: -2 })).toBe(false))
  it('true for positive count', () => expect(badgeIsActive({ count: 3 })).toBe(true))
  it('true for presence-only (no count)', () => expect(badgeIsActive({ tone: 'info' })).toBe(true))
})

describe('isNavActive', () => {
  it('false for undefined href', () => expect(isNavActive('/x', undefined)).toBe(false))
  it('true on exact match', () => expect(isNavActive('/x', '/x')).toBe(true))
  it('true on prefix segment match', () => expect(isNavActive('/x/y', '/x')).toBe(true))
  it('false on partial non-segment match', () => expect(isNavActive('/xyz', '/x')).toBe(false))
})

describe('pickRollupTone', () => {
  it('null when no children', () => {
    expect(pickRollupTone({ id: 'flat', label: 'F', href: '/f' }, new Map())).toBeNull()
  })

  it('null when no child has an active badge', () => {
    const item = parent([child('a'), child('b')])
    expect(pickRollupTone(item, new Map())).toBeNull()
  })

  it('ignores count-0 child badges', () => {
    const item = parent([child('a')])
    expect(pickRollupTone(item, new Map([['a', { count: 0, tone: 'attention' }]]))).toBeNull()
  })

  it('returns the tone of the single active child', () => {
    const item = parent([child('a')])
    expect(pickRollupTone(item, new Map([['a', { count: 2, tone: 'info' }]]))).toBe('info')
  })

  it('prefers the most-attention-worthy tone across children', () => {
    const item = parent([child('a'), child('b'), child('c')])
    const badges = new Map<string, { count?: number; tone?: 'attention' | 'info' | 'success' }>([
      ['a', { count: 1, tone: 'success' }],
      ['b', { count: 1, tone: 'attention' }],
      ['c', { count: 1, tone: 'info' }],
    ])
    expect(pickRollupTone(item, badges)).toBe('attention')
  })

  it('defaults missing tone to attention', () => {
    const item = parent([child('a')])
    expect(pickRollupTone(item, new Map([['a', { count: 1 }]]))).toBe('attention')
  })

  it('error wins over attention across children', () => {
    const item = parent([child('a'), child('b')])
    const badges = new Map<string, { count?: number; tone?: 'error' | 'attention' | 'info' | 'success' }>([
      ['a', { count: 5, tone: 'attention' }],
      ['b', { count: 1, tone: 'error' }],
    ])
    expect(pickRollupTone(item, badges)).toBe('error')
  })

  it('info wins over success (pins the lower-priority ordering)', () => {
    const item = parent([child('a'), child('b')])
    const badges = new Map<string, { count?: number; tone?: 'error' | 'attention' | 'info' | 'success' }>([
      ['a', { count: 1, tone: 'success' }],
      ['b', { count: 1, tone: 'info' }],
    ])
    expect(pickRollupTone(item, badges)).toBe('info')
  })
})

describe('collapsedParentRollupTone', () => {
  it('uses the parent\'s own active badge tone', () => {
    const item = parent([child('a')])
    expect(collapsedParentRollupTone(item, { count: 5, tone: 'info' }, new Map())).toBe('info')
  })

  it('ignores a count-0 parent badge and falls back to child rollup', () => {
    const item = parent([child('a')])
    const badges = new Map([['a', { count: 1, tone: 'attention' as const }]])
    expect(collapsedParentRollupTone(item, { count: 0 }, badges)).toBe('attention')
  })

  it('lets a more severe child badge outrank the parent badge', () => {
    const item = parent([child('a')])
    const badges = new Map([['a', { count: 1, tone: 'error' as const }]])
    expect(collapsedParentRollupTone(item, { count: 5, tone: 'info' }, badges)).toBe('error')
  })

  it('returns null when neither parent nor children are active', () => {
    const item = parent([child('a')])
    expect(collapsedParentRollupTone(item, undefined, new Map())).toBeNull()
  })
})

describe('collapsedParentAriaSuffix', () => {
  it('announces the parent badge count when the parent badge is active', () => {
    expect(collapsedParentAriaSuffix({ count: 3, tone: 'attention' }, 'attention')).toBe(', 3 needing review')
  })

  it('announces a children hint when the dot is child-driven', () => {
    expect(collapsedParentAriaSuffix(undefined, 'attention')).toBe(', children needing review')
  })

  it('announces the child severity when it outranks an active parent badge', () => {
    expect(collapsedParentAriaSuffix({ count: 3, tone: 'info' }, 'error')).toBe(', children urgent')
  })

  it('uses the shared tone label for non-attention child rollups', () => {
    expect(collapsedParentAriaSuffix(undefined, 'info')).toBe(', children info')
  })

  it('announces error child rollups as "urgent" (consistent with the counted suffix)', () => {
    expect(collapsedParentAriaSuffix(undefined, 'error')).toBe(', children urgent')
  })

  it('empty string when there is no dot at all', () => {
    expect(collapsedParentAriaSuffix(undefined, null)).toBe('')
  })

  it('empty string when the parent badge is count-0 and no rollup', () => {
    expect(collapsedParentAriaSuffix({ count: 0 }, null)).toBe('')
  })
})
