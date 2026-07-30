import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatusMarker } from '@makinbakin/sdk/patterns'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/StatusMarker',
  component: StatusMarker,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StatusMarker is the compact status dot for dense views. Provide `label` when the marker is the only status cue — it then renders with role img and the label as its accessible name. Omit `label` when adjacent visible text carries the state; the dot becomes aria-hidden decoration. Tones share the canonical status vocabulary (neutral, success, attention, danger, accent).',
      },
    },
    bakinCoverage: ['desktop', 'non-color', 'dense-data'],
  },
} satisfies Meta<typeof StatusMarker>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => <StatusMarker tone="success" label="Published" />,
  play: async ({ canvas }) => {
    // With a label the marker is a named image — the state survives without color.
    const marker = canvas.getByRole('img', { name: 'Published' })
    await expect(marker).toBeVisible()
    await expect(marker).toHaveAttribute('data-tone', 'success')
  },
} satisfies Story

export const DenseViewMarkers = {
  render: () => (
    <StoryStage
      eyebrow="State / dense views"
      title="Mark state where a chip is too loud"
      description="Markers carry the canonical status tones into dense rows. A labelled marker announces its own state; an unlabelled marker defers to the visible text beside it."
    >
      <StorySection title="Labelled markers" description="Each dot exposes its state as an accessible image name.">
        <StoryCluster>
          <StatusMarker tone="neutral" label="Draft" />
          <StatusMarker tone="success" label="Published" />
          <StatusMarker tone="attention" label="Needs review" />
          <StatusMarker tone="danger" label="Failed" />
          <StatusMarker tone="accent" label="Working now" />
        </StoryCluster>
      </StorySection>
      <StorySection title="Beside visible text" description="When the row already states the status, the marker stays decorative and hidden from assistive technology.">
        <StoryCluster>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <StatusMarker tone="danger" data-testid="decorative-marker" />
            <span>Failed — retry scheduled</span>
          </span>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Published' })).toHaveAttribute('data-tone', 'success')
    await expect(canvas.getByRole('img', { name: 'Failed' })).toHaveAttribute('data-tone', 'danger')
    await expect(canvas.getByRole('img', { name: 'Working now' })).toHaveAttribute('data-tone', 'accent')
    // The unlabelled marker is decoration: hidden from assistive technology, state carried by the text.
    await expect(canvas.getByTestId('decorative-marker')).toHaveAttribute('aria-hidden', 'true')
    await expect(canvas.getByText('Failed — retry scheduled')).toBeVisible()
  },
} satisfies Story
