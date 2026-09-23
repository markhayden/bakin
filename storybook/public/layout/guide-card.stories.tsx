import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Route } from 'lucide-react'

import { GuideCard } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Layout/GuideCard',
  component: GuideCard,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'GuideCard is the plain-words opener for a settings surface: what it controls, why it exists, and what to think about before touching it. An optional icon draws a tinted gutter that indents the whole body, so the title, the lead and the points share one left edge. Points render as a railed strip — the stat-strip rhythm with prose in place of numbers — and stack on narrow containers. The title is a real heading (level 2 by default, 3 when the card sits under a section) and each point carries an overline, so the outline reads as prose, not as metrics. Use it once at the top of a tab or section; it is guidance, not feedback — a condition that needs a decision belongs in an Alert or Banner.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'heading-order'],
  },
} satisfies Meta<typeof GuideCard>

export default meta
type Story = StoryObj<typeof meta>

const points = [
  { heading: 'Agent work is the real work', body: 'Scheduled, workflow and ad-hoc turns are the tasks your agents do. Route these only when a kind deserves a different quality or depth.' },
  { heading: 'Background chores are cheap and frequent', body: 'Titles, enrichment and notifications run constantly and need little intelligence. This is where a budget model saves the most.' },
  { heading: 'Thinking and tags refine it', body: 'Thinking levels trade depth for speed and cost. A tag override wins over every route for tasks carrying that tag.' },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    title: 'Match the model to the kind of work',
    lead: 'Every turn has a kind of work. A route sends that kind to a specific model and thinking level; anything unrouted uses the agent\'s model.',
    points,
    headingLevel: 2,
  },
  argTypes: {
    headingLevel: { control: 'select', options: [2, 3] },
    title: { control: 'text' },
    lead: { control: 'text' },
    // The icon and the action slot are composition; the points array is the story's subject.
    icon: { control: false },
    actions: { control: false },
    points: { control: false },
  },
  render: (args) => (
    <div style={{ width: 'min(92vw, 64rem)' }}>
      <GuideCard {...args} icon={Route} actions={<Button variant="outline" size="sm">Use recommended routes</Button>} />
    </div>
  ),
  play: async ({ canvas, args }) => {
    // The title is a real heading at the requested level; every point is an overline the outline can skip.
    await expect(canvas.getByRole('heading', { level: args.headingLevel ?? 2, name: 'Match the model to the kind of work' })).toBeVisible()
    await expect(canvas.getByText('Agent work is the real work')).toBeVisible()
    await expect(canvas.getByText(/A tag override wins/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Use recommended routes' })).toBeVisible()
  },
} satisfies Story

export const OpeningASection = {
  // Type-satisfying only: the composed example owns its props.
  args: { title: 'Match the model to the kind of work', lead: '' },
  render: () => (
    <StoryStage
      eyebrow="Settings / guidance"
      title="Say what a surface is for before showing its controls"
      description="One card at the top of a tab: the purpose stays visible, the considerations sit in a railed strip beneath it, and the page's own action for that surface rides the card instead of a second toolbar."
    >
      <StorySection title="Under a page title (heading level 2)">
        <GuideCard
          icon={Route}
          title="Match the model to the kind of work"
          lead="Every turn has a kind of work. A route sends that kind to a specific model and thinking level; anything unrouted uses the agent's model. 5 of 11 kinds are routed."
          points={points}
          actions={<Button variant="outline" size="sm">Use recommended routes</Button>}
        />
      </StorySection>
      <StorySection title="Without an icon, under a section heading (level 3), no points">
        <GuideCard
          headingLevel={3}
          title="Give one agent a different model"
          lead="Every agent runs on the default model unless you override it here. Nothing is overridden right now."
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Match the model to the kind of work' })).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 3, name: 'Give one agent a different model' })).toBeVisible()
  },
} satisfies Story
