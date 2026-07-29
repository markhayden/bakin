// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('anchored overlay public contracts', () => {
  it('supports a labelled, collision-sized Popover in an explicit portal container', () => {
    const portalRoot = document.createElement('div')
    document.body.appendChild(portalRoot)
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Inspect task</PopoverTrigger>
        <PopoverContent portalProps={{ container: portalRoot }}>
          <PopoverTitle>Task context</PopoverTitle>
          <PopoverDescription>Review the active route.</PopoverDescription>
        </PopoverContent>
      </Popover>,
    )

    const popover = portalRoot.querySelector('[data-slot="popover-content"]')
    expect(popover).toBeTruthy()
    expect(popover?.className).toContain('max-h-(--available-height)')
    expect(popover?.className).toContain('shadow-bakin-elevation-overlay')
    portalRoot.remove()
  })

  it('provides semantic menu items, nested-ready geometry, and silent shortcut hints', () => {
    const portalRoot = document.createElement('div')
    document.body.appendChild(portalRoot)
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Task actions</DropdownMenuTrigger>
        <DropdownMenuContent portalProps={{ container: portalRoot }}>
          <DropdownMenuItem>Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem variant="danger">
            <svg aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeTruthy()
    expect(screen.getByText('⌘D').getAttribute('aria-hidden')).toBe('true')
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    expect(deleteItem.getAttribute('data-variant')).toBe('danger')
    expect(deleteItem.className).toContain('[&_svg:not([class*="size-"])]:size-bakin-4')
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeTruthy()
    portalRoot.remove()
  })

  it('renders supplemental tooltip content through the tokenized layer contract', () => {
    const portalRoot = document.createElement('div')
    document.body.appendChild(portalRoot)
    render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger aria-label="Explain blocked state">?</TooltipTrigger>
          <TooltipContent portalProps={{ container: portalRoot }}>Waiting for an approval.</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Waiting for an approval.')
    expect(tooltip.className).toContain('bg-bakin-text-primary')
    expect(portalRoot.contains(tooltip)).toBe(true)
    portalRoot.remove()
  })

  it('gives Command a labelled search field, selected-state affordance, and silent shortcut', () => {
    render(
      <Command label="Search actions">
        <CommandInput />
        <CommandList>
          <CommandEmpty>No actions</CommandEmpty>
          <CommandGroup heading="Tasks">
            <CommandItem checked>Open task <CommandShortcut>↵</CommandShortcut></CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    expect(screen.getByRole('combobox', { name: 'Search actions' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Open task' }).getAttribute('data-checked')).toBe('true')
    expect(screen.getByText('↵').getAttribute('aria-hidden')).toBe('true')
  })
})
