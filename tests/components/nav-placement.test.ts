import { describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks even for pure partition tests.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-nav-placement-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-nav-placement-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { partitionNavItems } from '../../packages/host/src/components/layout/nav-placement'
import type { NavItem } from '@makinbakin/sdk'

const item = (id: string, extra: Partial<NavItem> = {}): NavItem => ({
  id,
  label: id,
  href: `/${id}`,
  ...extra,
})

describe('partitionNavItems', () => {
  it('returns everything as main when no item declares placement', () => {
    const items = [item('tasks'), item('team'), item('health')]
    const { main, bottom } = partitionNavItems(items)
    expect(main).toEqual(items)
    expect(bottom).toEqual([])
  })

  it('moves placement:"bottom" items to bottom, preserving order in both lists', () => {
    const explore = item('explore', { placement: 'bottom' })
    const items = [item('tasks'), explore, item('team')]
    const { main, bottom } = partitionNavItems(items)
    expect(main.map((i) => i.id)).toEqual(['tasks', 'team'])
    expect(bottom).toEqual([explore])
  })

  it('handles an all-bottom list', () => {
    const items = [item('a', { placement: 'bottom' }), item('b', { placement: 'bottom' })]
    const { main, bottom } = partitionNavItems(items)
    expect(main).toEqual([])
    expect(bottom.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('does not partition children — placement is a top-level concern', () => {
    const parent = item('group', {
      children: [item('child', { placement: 'bottom' })],
    })
    const { main, bottom } = partitionNavItems([parent])
    expect(main).toEqual([parent])
    expect(bottom).toEqual([])
  })
})
