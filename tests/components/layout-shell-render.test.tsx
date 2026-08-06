// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}))

mock.module('../../src/components/tasks/activity-feed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}))

import { ActivityContext } from '@/context/activity-context'
import { SidebarContext } from '@/context/sidebar-context'
import { LayoutShell } from '../../packages/host/src/components/layout/layout-shell'

function renderShell({ collapsed = false } = {}) {
  const toggle = mock()
  const view = render(
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      <ActivityContext.Provider value={{ open: false, toggle: mock(), close: mock() }}>
        <LayoutShell sidebar={<div data-testid="nav-content" />}>
          <div data-testid="page-content" />
        </LayoutShell>
      </ActivityContext.Provider>
    </SidebarContext.Provider>,
  )
  return { ...view, toggle }
}

afterEach(() => {
  cleanup()
})

describe('LayoutShell (Phase 4 kit rail)', () => {
  it('renders the sidebar as the kit collapsible PageAside in content mode', () => {
    const { container } = renderShell()
    const aside = container.querySelector('[data-slot=page-aside]')
    expect(aside).not.toBeNull()
    expect(aside?.getAttribute('data-rail')).toBe('')
    expect(aside?.getAttribute('aria-label')).toBe('App sidebar')
    expect(aside?.hasAttribute('data-collapsed')).toBe(false)
    // Content mode: the nav children stay mounted — no kit strip ever.
    expect(container.querySelector('[data-testid=nav-content]')).not.toBeNull()
    expect(container.querySelector('[data-slot=page-aside-strip]')).toBeNull()
  })

  it('collapsed state rides the kit width attribute, children stay mounted', () => {
    const { container } = renderShell({ collapsed: true })
    const aside = container.querySelector('[data-slot=page-aside]')
    expect(aside?.hasAttribute('data-collapsed')).toBe(true)
    expect(container.querySelector('[data-testid=nav-content]')).not.toBeNull()
  })

  it('keeps the app scroll container and the activity aside intact', () => {
    const { container } = renderShell()
    expect(container.querySelector('[data-scroll-restoration-id=bakin-main]')).not.toBeNull()
    expect(container.querySelector('[data-slot=activity-panel]')).not.toBeNull()
    expect(container.querySelector('main')).not.toBeNull()
  })
})
