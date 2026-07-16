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

import { buildSidebarNavModel } from '../../packages/host/src/components/layout/nav-placement'
import type { NavItem } from '@makinbakin/sdk'

const item = (id: string, extra: Partial<NavItem> = {}): NavItem => ({
  id,
  label: id,
  href: `/${id}`,
  ...extra,
})

describe('buildSidebarNavModel', () => {
  it('extracts Chat and Tasks in fixed order and reserves Explore for the host promotion', () => {
    const custom = item('custom')
    const model = buildSidebarNavModel([
      item('tasks', { order: 999 }),
      item('explore'),
      custom,
      item('chat', { order: -999 }),
    ])

    expect(model.primary.map((navItem) => navItem.id)).toEqual(['chat', 'tasks'])
    expect(model.sections).toEqual([
      { id: 'mix-ins', label: 'Mix-ins', items: [custom] },
    ])
  })

  it('orders official destinations by the product story instead of registry order', () => {
    const model = buildSidebarNavModel([
      item('memory', { section: 'operations', order: -10 }),
      item('messaging', { section: 'create', order: -10 }),
      item('workflows', { section: 'plan-and-automate', order: -10 }),
      item('projects', { section: 'plan-and-automate', order: 999 }),
      item('health', { section: 'operations', order: 999 }),
      item('assets', { section: 'create', order: 999 }),
      item('models', { section: 'operations' }),
      item('schedule', { section: 'plan-and-automate' }),
      item('brands', { section: 'create' }),
      item('team', { section: 'operations' }),
    ])

    expect(model.sections.map((section) => [section.id, section.items.map((navItem) => navItem.id)])).toEqual([
      ['plan-and-automate', ['projects', 'schedule', 'workflows']],
      ['create', ['brands', 'assets', 'messaging']],
      ['operations', ['health', 'team', 'models', 'memory']],
    ])
  })

  it('keeps custom entries after official entries and sorts the custom cohort deterministically', () => {
    const model = buildSidebarNavModel([
      item('custom-z', { label: 'Zulu', section: 'create', order: -100 }),
      item('assets', { section: 'create' }),
      item('custom-b', { label: 'Alpha', section: 'create', order: 20 }),
      item('custom-a', { label: 'Alpha', section: 'create', order: 20 }),
      item('custom-m', { label: 'Middle', section: 'create', order: 10 }),
      item('brands', { section: 'create' }),
    ])

    expect(model.sections[0]?.items.map((navItem) => navItem.id)).toEqual([
      'brands',
      'assets',
      'custom-z',
      'custom-m',
      'custom-a',
      'custom-b',
    ])
  })

  it('falls sectionless items into Mix-ins and omits every empty section', () => {
    const model = buildSidebarNavModel([
      item('beta', { label: 'Beta' }),
      item('alpha', { label: 'Alpha' }),
    ])

    expect(model.sections).toEqual([{
      id: 'mix-ins',
      label: 'Mix-ins',
      items: [item('alpha', { label: 'Alpha' }), item('beta', { label: 'Beta' })],
    }])
    expect(buildSidebarNavModel([]).sections).toEqual([])
  })

  it('uses a plugin declaration for its destination instead of hardcoding official ids', () => {
    const model = buildSidebarNavModel([
      item('health', { section: 'operations' }),
      item('projects', { section: 'operations', order: -100 }),
    ])

    expect(model.sections).toHaveLength(1)
    expect(model.sections[0]?.id).toBe('operations')
    expect(model.sections[0]?.items.map((navItem) => navItem.id)).toEqual(['health', 'projects'])
  })

  it('does not mutate the registry snapshot while sorting', () => {
    const items = [
      item('z', { label: 'Zulu' }),
      item('a', { label: 'Alpha' }),
      item('tasks'),
    ]
    const originalOrder = items.map((navItem) => navItem.id)

    buildSidebarNavModel(items)

    expect(items.map((navItem) => navItem.id)).toEqual(originalOrder)
  })
})
