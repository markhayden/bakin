// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-app-sidebar-badges-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { act, render, screen } from '@testing-library/react'
import { registerPlugin, setNavBadge, unregisterPlugin } from '@makinbakin/sdk'
import { SidebarContext } from '@/context/sidebar-context'
import { AppSidebar } from '../../packages/host/src/components/layout/app-sidebar'

const TEST_PLUGIN_IDS = ['flat-test', 'group-test']

afterEach(() => {
  for (const id of TEST_PLUGIN_IDS) unregisterPlugin(id)
})

function renderSidebar({ collapsed = false }: { collapsed?: boolean } = {}) {
  return render(
    <SidebarContext.Provider value={{ collapsed, toggle: () => {} }}>
      <AppSidebar />
    </SidebarContext.Provider>,
  )
}

describe('AppSidebar — badges', () => {
  beforeEach(() => {
    // Make sure pathname doesn't auto-expand any groups (tests own that state)
    window.history.pushState({}, '', '/')
  })

  it('flat expanded — renders a pill on a flat nav item with a badge', () => {
    registerPlugin({
      id: 'flat-test',
      navItems: [{ id: 'flat-test-nav', label: 'Flat', icon: 'Activity', href: '/flat' }],
    })
    act(() => {
      setNavBadge('flat-test', 'flat-test-nav', { count: 3, tone: 'attention' })
    })
    renderSidebar()
    const pills = screen.getAllByTestId('nav-badge-pill')
    expect(pills.some((p) => p.textContent === '3')).toBe(true)
  })

  it('flat collapsed — renders a dot on the icon and aria-label includes count', () => {
    registerPlugin({
      id: 'flat-test',
      navItems: [{ id: 'flat-test-nav', label: 'Flat', icon: 'Activity', href: '/flat' }],
    })
    act(() => {
      setNavBadge('flat-test', 'flat-test-nav', { count: 5, tone: 'attention' })
    })
    const { container } = renderSidebar({ collapsed: true })
    const dot = container.querySelector('[data-testid="nav-badge-dot"]')
    expect(dot).not.toBeNull()
    expect(container.querySelector('a[aria-label="Flat, 5 needing review"]')).not.toBeNull()
  })

  it('expanded child — renders a pill next to the child label', () => {
    registerPlugin({
      id: 'group-test',
      navItems: [
        {
          id: 'group-test-parent',
          label: 'Group',
          icon: 'Workflow',
          href: '/group',
          alwaysExpanded: true,
          children: [
            { id: 'group-test-child', label: 'Child', icon: 'ClipboardList', href: '/group/child' },
          ],
        },
      ],
    })
    act(() => {
      setNavBadge('group-test', 'group-test-child', { count: 2, tone: 'attention' })
    })
    renderSidebar()
    const pills = screen.getAllByTestId('nav-badge-pill')
    expect(pills.some((p) => p.textContent === '2')).toBe(true)
  })

  it('expanded parent — pill renders when parent has a direct badge', () => {
    registerPlugin({
      id: 'group-test',
      navItems: [
        {
          id: 'group-test-parent',
          label: 'Group',
          icon: 'Workflow',
          href: '/group',
          alwaysExpanded: true,
          children: [
            { id: 'group-test-child', label: 'Child', icon: 'ClipboardList', href: '/group/child' },
          ],
        },
      ],
    })
    act(() => {
      setNavBadge('group-test', 'group-test-parent', { count: 7, tone: 'info' })
    })
    renderSidebar()
    const pills = screen.getAllByTestId('nav-badge-pill')
    expect(pills.some((p) => p.textContent === '7')).toBe(true)
  })

  it('collapsed alwaysExpanded — parent shows a rollup dot when a child has a badge', () => {
    registerPlugin({
      id: 'group-test',
      navItems: [
        {
          id: 'group-test-parent',
          label: 'Group',
          icon: 'Workflow',
          href: '/group',
          alwaysExpanded: true,
          children: [
            { id: 'group-test-child', label: 'Child', icon: 'ClipboardList', href: '/group/child' },
          ],
        },
      ],
    })
    act(() => {
      setNavBadge('group-test', 'group-test-child', { count: 1, tone: 'attention' })
    })
    const { container } = renderSidebar({ collapsed: true })
    expect(container.querySelector('[data-testid="nav-badge-dot"]')).not.toBeNull()
  })

  it('clearing a badge with null removes the pill', () => {
    registerPlugin({
      id: 'flat-test',
      navItems: [{ id: 'flat-test-nav', label: 'Flat', icon: 'Activity', href: '/flat' }],
    })
    act(() => {
      setNavBadge('flat-test', 'flat-test-nav', { count: 3, tone: 'attention' })
    })
    const { container } = renderSidebar()
    expect(container.querySelectorAll('[data-testid="nav-badge-pill"]').length).toBeGreaterThan(0)
    act(() => {
      setNavBadge('flat-test', 'flat-test-nav', null)
    })
    expect(container.querySelectorAll('[data-testid="nav-badge-pill"]').length).toBe(0)
  })

  it('works identically for built-in plugin ids and user plugin ids', () => {
    // The registry doesn't distinguish core vs installed — same call path
    // for any pluginId. Register two plugins with different ids and ensure
    // both badges render side-by-side.
    registerPlugin({
      id: 'flat-test',
      navItems: [{ id: 'flat-test-nav', label: 'Flat', icon: 'Activity', href: '/flat' }],
    })
    registerPlugin({
      id: 'group-test',
      navItems: [{ id: 'group-test-nav', label: 'Group', icon: 'Workflow', href: '/group' }],
    })
    act(() => {
      setNavBadge('flat-test', 'flat-test-nav', { count: 1 })
      setNavBadge('group-test', 'group-test-nav', { count: 2 })
    })
    renderSidebar()
    const pills = screen.getAllByTestId('nav-badge-pill')
    const counts = pills.map((p) => p.textContent).sort()
    expect(counts).toEqual(['1', '2'])
  })
})
