// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import {
  BakinDrawer,
  DEFAULT_WIDTH,
  DRAWER_WIDTH_STORAGE_KEY,
  MAX_WIDTH,
  MIN_WIDTH,
  getDrawerWidthStorageKey,
  getStoredDrawerWidth,
} from '@/components/bakin-drawer'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/components/ui/sheet', () => ({
  Sheet: ({ children, busy }: { children: React.ReactNode; busy?: boolean }) => <div data-testid="sheet" data-busy={busy || undefined}>{children}</div>,
  SheetContent: ({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) => (
    <div data-testid="sheet-content" style={style} className={className}>{children}</div>
  ),
  SheetHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <h2 className={className}>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props}>{children}</button>,
}))

describe('BakinDrawer', () => {
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
  })

  it('hydrates width from localStorage when available', () => {
    window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, '640')

    const { getByTestId } = render(
      <BakinDrawer open onOpenChange={() => {}}>
        <div>Body</div>
      </BakinDrawer>,
    )

    expect(getByTestId('sheet-content').style.getPropertyValue('--bakin-drawer-width')).toBe('640px')
  })

  it('persists the resized width on drag end', async () => {
    const { container, getByTestId } = render(
      <BakinDrawer open onOpenChange={() => {}}>
        <div>Body</div>
      </BakinDrawer>,
    )

    const handle = container.querySelector('[role="separator"]')
    expect(handle).toBeTruthy()

    fireEvent.mouseDown(handle as Element, { clientX: 1000 })
    fireEvent.mouseMove(document, { clientX: 900 })
    fireEvent.mouseUp(document)

    await waitFor(() => {
      expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('910')
      expect(getByTestId('sheet-content').style.getPropertyValue('--bakin-drawer-width')).toBe('910px')
    })
  })

  it('supports keyboard resizing and persists each committed width', () => {
    render(
      <BakinDrawer open onOpenChange={() => {}} defaultWidth={480}>
        <div>Body</div>
      </BakinDrawer>,
    )

    const separator = screen.getByRole('separator', { name: 'Resize panel' })
    expect(separator.getAttribute('aria-valuenow')).toBe('480')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('496')
    expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('496')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator.getAttribute('aria-valuenow')).toBe(String(MAX_WIDTH))
  })

  it('always provides a labelled close action and blocks it while busy', () => {
    const onOpenChange = mock()
    const { rerender } = render(
      <BakinDrawer open onOpenChange={onOpenChange}>
        <div>Body</div>
      </BakinDrawer>,
    )

    expect(screen.getByText('Details').className).toContain('sr-only')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    onOpenChange.mockClear()
    rerender(
      <BakinDrawer open busy onOpenChange={onOpenChange}>
        <div>Body</div>
      </BakinDrawer>,
    )
    expect(screen.getByTestId('sheet').getAttribute('data-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('supports per-context storage keys and clamps invalid stored widths', () => {
    window.localStorage.setItem(getDrawerWidthStorageKey('tasks'), '1200')
    window.localStorage.setItem(getDrawerWidthStorageKey('assets'), 'oops')

    expect(getStoredDrawerWidth(DEFAULT_WIDTH, 'tasks')).toBe(MAX_WIDTH)
    expect(getStoredDrawerWidth(DEFAULT_WIDTH, 'assets')).toBe(DEFAULT_WIDTH)
    expect(getStoredDrawerWidth(100, 'missing')).toBe(MIN_WIDTH)
  })
})
