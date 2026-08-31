import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Overlays/Popover',
  component: Popover,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Popover for a small interactive panel anchored to one trigger. It is collision-aware, viewport-bounded, labelled when it represents a distinct region, and portalled through the supported system contract.' } },
    bakinCoverage: ['desktop', 'keyboard', 'overflow'],
  },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { defaultOpen: false },
  argTypes: {
    defaultOpen: { control: 'boolean' },
    modal: { control: 'boolean' },
    // Trigger and panel are composition; the anchored content is not a control.
    children: { control: false },
  },
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger render={<Button variant="outline" />}>Inspect filters</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Active filters</PopoverTitle>
          <PopoverDescription>Changes apply immediately to the URL-backed task view.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Inspect filters' }))
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Active filters' })).toBeVisible())
    await expect(page.getByText('Changes apply immediately to the URL-backed task view.')).toBeVisible()
  },
} satisfies Story

export const Context = {
  render: () => (
    <StoryStage
      eyebrow="Anchored panel"
      title="Popover"
      description="A labelled panel stays anchored to its trigger, bounded in the viewport, and readable under detailed operational copy."
    >
      <StorySection title="Filter panel" description="The open panel is a labelled region: title, description, and immediately-applied controls.">
        <Popover defaultOpen>
          <PopoverTrigger render={<Button variant="outline" />}>Inspect filters</PopoverTrigger>
          <PopoverContent align="start">
            <PopoverHeader>
              <PopoverTitle>Active filters</PopoverTitle>
              <PopoverDescription>Changes apply immediately to the URL-backed task view.</PopoverDescription>
            </PopoverHeader>
            <label style={{ display: 'flex', minWidth: 0, alignItems: 'center', justifyContent: 'space-between', gap: 'var(--bakin-layout-gap-item)' }}>
              <span>Include archived tasks</span>
              <Switch aria-label="Include archived tasks" />
            </label>
            <p style={{ margin: 0, color: 'var(--bakin-color-text-muted)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>This intentionally long supporting sentence proves the panel remains bounded and readable when an extension supplies detailed operational context.</p>
          </PopoverContent>
        </Popover>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

/**
 * Salvaged from the retired `Foundation/Anchored overlays` entry: the one
 * scenario the per-component entries did not cover — anchored layers
 * coexisting, with a nested layer opening above an open popover without
 * dismissing it.
 */
export const AnchoredLayerCoexistence = {
  render: () => (
    <StoryStage
      eyebrow="Coexistence"
      title="One collision-safe layer"
      description="Popover, DropdownMenu, and Tooltip share the same portal and collision rules; a nested layer opens above its parent panel without dismissing it."
    >
      <StorySection title="Nested anchored layers" description="Menu and tooltip triggers stay meaningful inside an open popover.">
        <Popover defaultOpen>
          <PopoverTrigger render={<Button variant="outline" />}>Inspect filters</PopoverTrigger>
          <PopoverContent align="start">
            <PopoverHeader>
              <PopoverTitle>Active filters</PopoverTitle>
              <PopoverDescription>Sorting and help open in their own layers above this panel.</PopoverDescription>
            </PopoverHeader>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bakin-layout-gap-item)' }}>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Sort</DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Newest first</DropdownMenuItem>
                  <DropdownMenuItem>Oldest first</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TooltipProvider delay={0}>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Explain immediate filters" />}><span aria-hidden="true">?</span></TooltipTrigger>
                  <TooltipContent>Filter changes write to the URL immediately.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </PopoverContent>
        </Popover>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ userEvent }) => {
    const page = within(document.body)
    const panel = await waitFor(() => page.getByRole('dialog', { name: 'Active filters' }))
    await expect(panel).toBeVisible()
    await userEvent.click(within(panel).getByRole('button', { name: 'Sort' }))
    await waitFor(() => expect(page.getByRole('menu', { name: 'Sort' })).toBeVisible())
    await expect(panel).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('menu', { name: 'Sort' })).not.toBeInTheDocument())
    await expect(page.getByRole('dialog', { name: 'Active filters' })).toBeVisible()
  },
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>Open route context</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Route context</PopoverTitle>
        <PopoverDescription>Presentation state remains in the existing query contract.</PopoverDescription>
        <Button size="sm">Apply</Button>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open route context' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Route context' })).toBeVisible())
    await expect(page.getByText('Presentation state remains in the existing query contract.')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Route context' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
