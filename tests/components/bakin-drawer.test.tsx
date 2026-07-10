// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
  Sheet: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet">{children}</div>,
  SheetContent: ({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) => (
    <div data-testid="sheet-content" style={style} className={className}>{children}</div>
  ),
  SheetHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
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
    cleanup()
    window.localStorage.clear()
  })

  it('hydrates width from localStorage when available', () => {
    window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, '640')

    const { getByTestId } = render(
      <BakinDrawer open onOpenChange={() => {}}>
        <div>Body</div>
      </BakinDrawer>,
    )

    expect(getByTestId('sheet-content').style.width).toBe('640px')
  })

  it('persists the resized width on drag end', async () => {
    const { container, getByTestId } = render(
      <BakinDrawer open onOpenChange={() => {}}>
        <div>Body</div>
      </BakinDrawer>,
    )

    const handle = container.querySelector('.cursor-col-resize')
    expect(handle).toBeTruthy()

    fireEvent.mouseDown(handle as Element, { clientX: 1000 })
    fireEvent.mouseMove(document, { clientX: 900 })
    fireEvent.mouseUp(document)

    await waitFor(() => {
      expect(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('910')
      expect(getByTestId('sheet-content').style.width).toBe('910px')
    })
  })

  it('supports per-context storage keys and clamps invalid stored widths', () => {
    window.localStorage.setItem(getDrawerWidthStorageKey('tasks'), '1200')
    window.localStorage.setItem(getDrawerWidthStorageKey('assets'), 'oops')

    expect(getStoredDrawerWidth(DEFAULT_WIDTH, 'tasks')).toBe(MAX_WIDTH)
    expect(getStoredDrawerWidth(DEFAULT_WIDTH, 'assets')).toBe(DEFAULT_WIDTH)
    expect(getStoredDrawerWidth(100, 'missing')).toBe(MIN_WIDTH)
  })
})
