// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PluginOwnershipRoot } from '@makinbakin/sdk/internal'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('plugin portal containment', () => {
  it('retains the host-injected plugin identity when dialog content leaves the page root', () => {
    render(
      <PluginOwnershipRoot pluginId="alpha">
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Alpha details</DialogTitle>
          </DialogContent>
        </Dialog>
      </PluginOwnershipRoot>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Alpha details' })
    const portalOwner = dialog.closest('[data-bakin-plugin-portal]')
    expect(portalOwner?.getAttribute('data-bakin-plugin')).toBe('alpha')
    expect(portalOwner?.getAttribute('data-bakin-plugin-portal')).toBe('alpha')
  })

  it('keeps modal sheet content in the owning plugin scope', () => {
    render(
      <PluginOwnershipRoot pluginId="bravo">
        <Sheet defaultOpen>
          <SheetContent>
            <SheetTitle>Bravo inspector</SheetTitle>
          </SheetContent>
        </Sheet>
      </PluginOwnershipRoot>,
    )

    const owner = screen.getByRole('dialog', { name: 'Bravo inspector' })
      .closest('[data-bakin-plugin-portal]')
    expect(owner?.getAttribute('data-bakin-plugin')).toBe('bravo')
  })

  it('lets two plugins open anchored overlays without losing either identity', async () => {
    await act(async () => { render(
      <>
        <PluginOwnershipRoot pluginId="charlie">
          <Popover defaultOpen>
            <PopoverTrigger>Open Charlie</PopoverTrigger>
            <PopoverContent><PopoverTitle>Charlie context</PopoverTitle></PopoverContent>
          </Popover>
        </PluginOwnershipRoot>
        <PluginOwnershipRoot pluginId="delta">
          <TooltipProvider delay={0}>
            <Tooltip open>
              <TooltipTrigger>Explain Delta</TooltipTrigger>
              <TooltipContent>Delta explanation</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </PluginOwnershipRoot>
      </>,
    ) })

    const popoverOwner = screen.getByText('Charlie context').closest('[data-bakin-plugin-portal]')
    const tooltipOwner = screen.getByRole('tooltip').closest('[data-bakin-plugin-portal]')
    expect(popoverOwner?.getAttribute('data-bakin-plugin')).toBe('charlie')
    expect(tooltipOwner?.getAttribute('data-bakin-plugin')).toBe('delta')
  })

  it('keeps option-list portals in the owning plugin scope', async () => {
    await act(async () => { render(
      <>
        <PluginOwnershipRoot pluginId="echo">
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Echo actions</DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem>Echo item</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </PluginOwnershipRoot>
        <PluginOwnershipRoot pluginId="foxtrot">
          <Select defaultOpen defaultValue="one">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="one">Foxtrot option</SelectItem></SelectContent>
          </Select>
        </PluginOwnershipRoot>
      </>,
    ) })

    const menuOwner = screen.getByRole('menuitem', { name: 'Echo item' })
      .closest('[data-bakin-plugin-portal]')
    const optionOwner = screen.getByRole('option', { name: 'Foxtrot option' })
      .closest('[data-bakin-plugin-portal]')
    expect(menuOwner?.getAttribute('data-bakin-plugin')).toBe('echo')
    expect(optionOwner?.getAttribute('data-bakin-plugin')).toBe('foxtrot')
  })

  it('does not invent plugin ownership for host-owned overlays', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent><DialogTitle>Host dialog</DialogTitle></DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole('dialog', { name: 'Host dialog' }).closest('[data-bakin-plugin]')).toBeNull()
  })
})
