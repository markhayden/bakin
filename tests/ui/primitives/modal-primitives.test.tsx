// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Dialog public contract', () => {
  it('provides labelling, description, focus-ready styling, and a default close action', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete runtime</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>Actions</DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Delete runtime' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(dialog.className).toContain('rounded-bakin-overlay')
    expect(dialog.className).toContain('shadow-bakin-elevation-overlay')
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Delete runtime' }).className).toContain('--bakin-typography-size-title')
  })

  it('blocks close controls while busy and exposes the busy state', () => {
    const onOpenChange = mock(() => {})
    render(
      <Dialog open busy onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Publishing changes</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole('dialog', { name: 'Publishing changes' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('supports an explicit portal container for future plugin containment', () => {
    const portalRoot = document.createElement('div')
    portalRoot.dataset.testid = 'portal-root'
    document.body.appendChild(portalRoot)

    render(
      <Dialog defaultOpen>
        <DialogContent portalProps={{ container: portalRoot }}>
          <DialogTitle>Contained dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    expect(portalRoot.querySelector('[role="dialog"]')).toBeTruthy()
    portalRoot.remove()
  })
})

describe('Sheet public contract', () => {
  it('can delegate its inset to a containing composition', () => {
    render(<SheetHeader inset="none" data-testid="flush-sheet-header">Header</SheetHeader>)

    const header = screen.getByTestId('flush-sheet-header')
    expect(header.className).not.toContain('p-bakin-6')
    expect(header.className).not.toContain('pr-bakin-12')
  })

  it('uses a labelled full-height side-overlay contract', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Task details</SheetTitle>
            <SheetDescription>Inspect and update this task.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    )

    const sheet = screen.getByRole('dialog', { name: 'Task details' })
    expect(sheet.getAttribute('data-side')).toBe('left')
    expect(sheet.className).toContain('h-dvh')
    expect(sheet.className).toContain('max-w-full')
    expect(screen.getByRole('heading', { name: 'Task details' }).className).toContain('--bakin-typography-size-title')
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy()
  })

  it('shares the busy close contract with dialogs', () => {
    render(
      <Sheet defaultOpen busy>
        <SheetContent>
          <SheetTitle>Saving task</SheetTitle>
          <SheetClose>Close now</SheetClose>
        </SheetContent>
      </Sheet>,
    )

    expect(screen.getByRole('dialog', { name: 'Saving task' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close now' })).toHaveProperty('disabled', true)
  })
})
