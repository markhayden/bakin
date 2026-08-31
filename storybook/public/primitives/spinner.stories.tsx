import type { Meta, StoryObj } from '@storybook/react-vite'
import { Spinner } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Spinner',
  component: Spinner,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The indeterminate busy indicator. Pass `label` when the wait is the message and the spinner announces itself; omit it when adjacent text already says what is happening and the spinner is decorative. Reduced-motion is honoured automatically. Reach for `Skeleton` instead when the shape of the pending content is known.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'non-color'],
  },
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { label: 'Loading agents' },
  play: async ({ canvas, args }) => {
    // A labelled spinner is a live status, not silent decoration — the whole
    // reason this primitive exists is that hand-rolled ones were unnamed.
    const spinner = canvas.getByRole('status', { name: String(args.label) })
    await expect(spinner).toBeVisible()
  },
} satisfies Story

export const LabelledAndDecorative = {
  render: () => (
    <StoryStage
      eyebrow="Feedback primitive"
      title="Announced or decorative — never silent and visible"
      description="A label makes the spinner a live status assistive tech can describe. Without one it is hidden entirely, which is correct when neighbouring text already carries the meaning."
    >
      <StorySection title="Labelled" description="The spinner is the only signal, so it names itself.">
        <StoryCluster>
          <Spinner label="Loading agents" />
        </StoryCluster>
      </StorySection>
      <StorySection title="Decorative" description="Inside a busy button, the button's own label already says it.">
        <StoryCluster>
          <span className="inline-flex items-center gap-bakin-2">
            <Spinner size="sm" />
            Saving…
          </span>
        </StoryCluster>
      </StorySection>
      <StorySection title="Sizes" description="Small pairs with meta text and inline controls; medium is the default.">
        <StoryCluster>
          <Spinner size="sm" label="Small" />
          <Spinner size="md" label="Medium" />
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story
