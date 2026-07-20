import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger, Switch } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Popover',
  component: Popover,
  tags: ['public'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Use Popover for a small interactive panel anchored to one trigger. It is collision-aware, viewport-bounded, labelled when it represents a distinct region, and portalled through the supported system contract.' } } },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Context = {
  render: () => <main className="bakin-primitive-story__anchor-stage"><Popover defaultOpen><PopoverTrigger render={<Button variant="outline" />}>Inspect filters</PopoverTrigger><PopoverContent align="start"><PopoverHeader><PopoverTitle>Active filters</PopoverTitle><PopoverDescription>Changes apply immediately to the URL-backed task view.</PopoverDescription></PopoverHeader><label className="bakin-primitive-story__anchor-setting"><span>Include archived tasks</span><Switch aria-label="Include archived tasks" /></label><p className="bakin-primitive-story__long-copy">This intentionally long supporting sentence proves the panel remains bounded and readable when an extension supplies detailed operational context.</p></PopoverContent></Popover></main>,
} satisfies Story

export const Behavior = {
  render: () => <main className="bakin-primitive-story"><Popover><PopoverTrigger render={<Button variant="outline" />}>Open route context</PopoverTrigger><PopoverContent><PopoverTitle>Route context</PopoverTitle><PopoverDescription>Presentation state remains in the existing query contract.</PopoverDescription><Button size="sm">Apply</Button></PopoverContent></Popover></main>,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open route context' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByText('Presentation state remains in the existing query contract.')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
