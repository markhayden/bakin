// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import {
  Drawer,
  DEFAULT_WIDTH,
  DRAWER_WIDTH_STORAGE_KEY,
  MAX_WIDTH,
  MIN_WIDTH,
  getDrawerWidthStorageKey,
} from '@/components/drawer'
import { DrawerSection } from '@makinbakin/sdk/ui'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

// The Drawer now composes the real kit Sheet + UnsavedChangesDialog, which
// portal into document.body — queries go through `screen` / `document.body`.
describe('Drawer', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        removeItem: (key: string) => {
          storage.delete(key)
        },
        clear: () => {
          storage.clear()
        },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    window.localStorage.clear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('hydrates width from localStorage when available', () => {
    window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, '640')

    render(
      <Drawer open onOpenChange={() => {}}>
        <div>Body</div>
      </Drawer>,
    )

    expect(screen.getByRole('dialog').style.getPropertyValue('--bakin-drawer-width')).toBe('640px')
  })

  it('persists the resized width on drag end', async () => {
    render(
      <Drawer open onOpenChange={() => {}}>
        <div>Body</div>
      </Drawer>,
    )

    const handle = document.body.querySelector('[role="separator"]')
    expect(handle).toBeTruthy()

    fireEvent.pointerDown(handle as Element, { pointerId: 1, clientX: 1000 })
    fireEvent.pointerMove(handle as Element, { pointerId: 1, clientX: 900 })
    fireEvent.pointerUp(handle as Element, { pointerId: 1 })

    await waitFor(() => {
      expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('910')
      expect(screen.getByRole('dialog').style.getPropertyValue('--bakin-drawer-width')).toBe('910px')
    })
  })

  it('supports keyboard resizing and persists each committed width', () => {
    render(
      <Drawer open onOpenChange={() => {}} defaultWidth={480}>
        <div>Body</div>
      </Drawer>,
    )

    const separator = screen.getByRole('separator', { name: 'Resize panel' })
    expect(separator.getAttribute('aria-valuenow')).toBe('480')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('496')
    expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('496')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator.getAttribute('aria-valuenow')).toBe(String(MAX_WIDTH))
  })

  it('releases a drag when closed and reopens without stale resize state', () => {
    const view = render(<Drawer open onOpenChange={() => {}}><div>Body</div></Drawer>)
    const handle = screen.getByRole('separator', { name: 'Resize panel' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    view.rerender(<Drawer open={false} onOpenChange={() => {}}><div>Body</div></Drawer>)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('910')
    view.rerender(<Drawer open onOpenChange={() => {}}><div>Body</div></Drawer>)
    expect(screen.getByRole('separator', { name: 'Resize panel' }).getAttribute('data-resizing')).toBe('false')
  })

  it('ignores a second pointer and restores body styles when capture is lost', () => {
    render(<Drawer open onOpenChange={() => {}}><div>Body</div></Drawer>)
    const handle = screen.getByRole('separator', { name: 'Resize panel' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000 })
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 950 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 })
    expect(handle.getAttribute('aria-valuenow')).toBe('910')
    fireEvent.lostPointerCapture(handle, { pointerId: 1 })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(handle.getAttribute('data-resizing')).toBe('false')
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 800 })
    expect(handle.getAttribute('aria-valuenow')).toBe('910')
  })

  it('always provides a labelled close action and blocks it while busy', () => {
    const onOpenChange = mock()
    const { rerender } = render(
      <Drawer open onOpenChange={onOpenChange}>
        <div>Body</div>
      </Drawer>,
    )

    expect(screen.getByText('Details').className).toContain('sr-only')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    onOpenChange.mockClear()
    rerender(
      <Drawer open busy onOpenChange={onOpenChange}>
        <div>Body</div>
      </Drawer>,
    )
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('uses valid responsive gutters and a reusable nested section inset', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Task detail">
        <DrawerSection title="Details">
          <p>Task evidence</p>
        </DrawerSection>
      </Drawer>,
    )

    const layout = document.body.querySelector('[data-slot="drawer-layout"]')
    expect(layout?.className).toContain('px-bakin-4')
    expect(layout?.className).toContain('sm:px-bakin-6')
    expect(layout?.className).toContain('pt-bakin-4')
    expect(layout?.className).toContain('pb-bakin-8')
    expect(layout?.className).toContain('gap-bakin-6')
    expect(layout?.className).toContain('shrink-0')
    expect(layout?.className).not.toContain('px-bakin-7')
    const content = document.body.querySelector('[data-slot="drawer-content"]')
    expect(content).toBeTruthy()
    expect(content?.className).not.toContain('min-h-0')
    expect(content?.className).not.toContain('flex-1')
    expect(screen.getByRole('heading', { level: 2, name: 'Task detail' }).closest('[data-inset]')?.getAttribute('data-inset')).toBe('none')
    expect(screen.getByRole('heading', { level: 3, name: 'Details' })).toBeTruthy()
    const sectionContent = document.body.querySelector('[data-slot="drawer-section-content"]')
    expect(sectionContent?.className).toContain('px-bakin-2')
    expect(sectionContent?.closest('[data-slot="drawer-section"]')?.className).toContain('gap-bakin-3')
  })

  it.each([
    ['tasks', '1200', DEFAULT_WIDTH, MAX_WIDTH],
    ['assets', 'oops', DEFAULT_WIDTH, DEFAULT_WIDTH],
    ['missing', null, 100, MIN_WIDTH],
  ] as const)('hydrates and clamps the %s context', (key, stored, defaultWidth, expected) => {
    if (stored !== null) window.localStorage.setItem(getDrawerWidthStorageKey(key), stored)
    render(<Drawer open onOpenChange={() => {}} storageKey={key} defaultWidth={defaultWidth}><div>Body</div></Drawer>)
    expect(screen.getByRole('separator', { name: 'Resize panel' }).getAttribute('aria-valuenow')).toBe(String(expected))
  })
})
