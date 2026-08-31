import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Overlays/Tooltip',
  component: Tooltip,
  tags: ['public'],
  // delay={0} is the deterministic fixture: hover/focus assertions never race a timer.
  decorators: [(Story) => <TooltipProvider delay={0}><Story /></TooltipProvider>],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Tooltip provides concise supplemental context on hover and keyboard focus. Icon-only triggers still need their own accessible name; required instructions and errors must remain visible without the tooltip.' } },
    bakinCoverage: ['desktop', 'keyboard'],
  },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>Retry guidance</TooltipTrigger>
      <TooltipContent>Retry after the runtime reconnects.</TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Retry guidance' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('tooltip')).toBeVisible())
    await expect(page.getByRole('tooltip')).toHaveTextContent('Retry after the runtime reconnects.')
  },
} satisfies Story

export const SupplementalHelp = {
  render: () => (
    <StoryStage
      eyebrow="Supplemental label"
      title="Tooltip"
      description="Concise help appears on hover and keyboard focus; the trigger keeps its own accessible name."
    >
      <StorySection title="Blocked-state help" description="The open state stays anchored and readable; required instructions never live only in the tooltip.">
        <StoryCluster>
          <Tooltip open>
            <TooltipTrigger render={<Button variant="outline" size="icon-md" aria-label="Explain blocked state" />}><span aria-hidden="true">?</span></TooltipTrigger>
            <TooltipContent side="right">Waiting for the release owner to approve this task.</TooltipContent>
          </Tooltip>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" aria-label="Show retry guidance" />}>Retry guidance</TooltipTrigger>
      <TooltipContent>Retry after the runtime reconnects.</TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    if (new URLSearchParams(window.location.search).get('bakinCrossBrowser') === '1') return
    const trigger = canvas.getByRole('button', { name: 'Show retry guidance' })
    const page = within(document.body)
    // Pointer path: hover shows, unhover hides.
    await userEvent.hover(trigger)
    await waitFor(() => expect(page.getByRole('tooltip')).toBeVisible())
    await userEvent.unhover(trigger)
    await waitFor(() => expect(page.queryByRole('tooltip')).not.toBeInTheDocument())
    // Keyboard path: focus shows without any pointer, Escape dismisses.
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await waitFor(() => expect(page.getByRole('tooltip')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('tooltip')).not.toBeInTheDocument())
  },
} satisfies Story
