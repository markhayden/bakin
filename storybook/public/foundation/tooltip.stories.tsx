import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Tooltip',
  component: Tooltip,
  tags: ['public'],
  decorators: [(Story) => <TooltipProvider delay={0}><Story /></TooltipProvider>],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Tooltip provides concise supplemental context on hover and keyboard focus. Icon-only triggers still need their own accessible name; required instructions and errors must remain visible without the tooltip.' } } },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const SupplementalHelp = {
  render: () => <main className="bakin-primitive-story__anchor-stage"><Tooltip open><TooltipTrigger render={<Button variant="outline" size="icon" aria-label="Explain blocked state" />}><span aria-hidden="true">?</span></TooltipTrigger><TooltipContent side="right">Waiting for the release owner to approve this task.</TooltipContent></Tooltip></main>,
} satisfies Story

export const Behavior = {
  render: () => <main className="bakin-primitive-story"><Tooltip><TooltipTrigger render={<Button variant="outline" aria-label="Show retry guidance" />}>Retry guidance</TooltipTrigger><TooltipContent>Retry after the runtime reconnects.</TooltipContent></Tooltip></main>,
  play: async ({ canvas, userEvent }) => {
    if (new URLSearchParams(window.location.search).get('bakinCrossBrowser') === '1') return
    const trigger = canvas.getByRole('button', { name: 'Show retry guidance' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('tooltip')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('tooltip')).not.toBeInTheDocument())
  },
} satisfies Story
