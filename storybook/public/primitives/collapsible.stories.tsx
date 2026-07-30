import type { Meta, StoryObj } from '@storybook/react-vite'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@makinbakin/sdk/ui'
import { expect, waitFor } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Collapsible',
  component: Collapsible,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Collapsible for optional supporting detail. Its trigger owns the expanded state and panel relationship; required decisions and primary actions must remain visible.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard'],
  },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ width: 'min(100%, 28rem)' }}>
      <Collapsible>
        <CollapsibleTrigger>Advanced retry policy</CollapsibleTrigger>
        <CollapsibleContent>Retry twice, waiting 30 seconds and then 2 minutes before marking the dispatch blocked.</CollapsibleContent>
      </Collapsible>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Advanced retry policy' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/Retry twice/)).toBeVisible()
  },
} satisfies Story

export const Behavior = {
  render: () => (
    <StoryStage
      eyebrow="Disclosure"
      title="Collapsible"
      description="Optional advanced detail starts closed and remains completely keyboard operable."
    >
      <StorySection title="Retry policy">
        <Collapsible>
          <CollapsibleTrigger>Advanced retry policy <span aria-hidden="true">+</span></CollapsibleTrigger>
          <CollapsibleContent>Retry twice, waiting 30 seconds and then 2 minutes before marking the dispatch blocked.</CollapsibleContent>
        </Collapsible>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Advanced retry policy' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/Retry twice/)).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  },
} satisfies Story
