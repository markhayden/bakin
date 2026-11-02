// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import '../rtl-settle'

import * as realSdkHooks from '@makinbakin/sdk/hooks'
const location = { pathname: '/terminal/one' }
mock.module('@makinbakin/sdk/hooks', () => ({ ...realSdkHooks, usePathname: () => location.pathname }))
mock.module('@tanstack/react-router', () => ({ Outlet: () => <div data-testid="page" /> }))
mock.module('../../packages/host/src/components/layout/header', () => ({ Header: () => <header data-testid="header" /> }))
mock.module('../../packages/host/src/components/layout/app-sidebar', () => ({ AppSidebar: () => <nav data-testid="sidebar" /> }))
mock.module('../../packages/host/src/components/layout/layout-shell', () => ({
  LayoutShell: ({ children, fullscreen }: { children: React.ReactNode; fullscreen?: boolean }) => <main data-fullscreen={fullscreen ? '' : undefined}>{children}</main>,
}))

import { useHostStore } from '@makinbakin/sdk/hooks'
import { FullscreenShell } from '../../packages/host/src/components/layout/fullscreen-shell'

afterEach(() => {
  cleanup()
  useHostStore.setState({ fullscreen: null })
  location.pathname = '/terminal/one'
})

describe('FullscreenShell (the host side of useFullscreen)', () => {
  it('hides the header while a page holds full screen, and ends it when the page changes', async () => {
    const view = render(<FullscreenShell />)
    expect(view.queryByTestId('header')).not.toBeNull()
    await act(async () => { useHostStore.setState({ fullscreen: '/terminal/one' }) })
    expect(view.queryByTestId('header')).toBeNull()
    expect(view.container.querySelector('main')!.hasAttribute('data-fullscreen')).toBe(true)
    location.pathname = '/terminal/two'
    await act(async () => { view.rerender(<FullscreenShell />) })
    expect(useHostStore.getState().fullscreen).toBeNull()
    expect(view.queryByTestId('header')).not.toBeNull()
  })
  it('ends when the browser leaves its own full screen (Esc held, F11)', async () => {
    const view = render(<FullscreenShell />)
    await act(async () => { useHostStore.setState({ fullscreen: '/terminal/one' }) })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(useHostStore.getState().fullscreen).toBeNull()
    expect(view.queryByTestId('header')).not.toBeNull()
  })
})
