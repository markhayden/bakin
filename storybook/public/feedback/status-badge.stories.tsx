import type { Meta, StoryObj } from '@storybook/react-vite'
import { Grid, Stack } from '@makinbakin/sdk/layout'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Card, CardContent, CardHeader, CardTitle } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

function CheckIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
}

function SignalIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 5.5V8l1.75 1.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
}

const meta = {
  title: 'Components/Feedback/StatusBadge',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StatusBadge is the compact state label: the visible copy carries the state on its own, `tone` selects the canonical semantic color (neutral, success, attention, danger, accent), and `variant` chooses solid, soft, or outline emphasis. Accent identifies provenance or a product signal such as Official; success is reserved for confirmed outcomes such as Installed. The optional `icon` reinforces the label and stays aria-hidden. Treatment Comparison shows the same labels across every treatment, size, icon option, and repeated dashboard context using the current kit styling.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'non-color', 'long-labels'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface StatusBadgeCanonicalArgs {
  /** Canonical semantic status color. */
  tone: 'neutral' | 'success' | 'attention' | 'danger' | 'accent'
  /** Emphasis treatment. */
  variant: 'soft' | 'solid' | 'outline'
  /** Badge density. */
  size: 'xs' | 'sm' | 'md'
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'success',
    variant: 'solid',
    size: 'sm',
  },
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'success', 'attention', 'danger', 'accent'] },
    variant: { control: 'select', options: ['soft', 'solid', 'outline'] },
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
  },
  render: (args: StatusBadgeCanonicalArgs) => (
    <StatusBadge tone={args.tone} variant={args.variant} size={args.size}>Published</StatusBadge>
  ),
  play: async ({ canvas, args }) => {
    const badge = canvas.getByText('Published').closest('[data-status-badge]')
    await expect(badge).toBeVisible()
    // The visible label is the non-color cue; tone and treatment ride data attributes.
    await expect(badge).toHaveAttribute('data-tone', args.tone)
    await expect(badge).toHaveAttribute('data-variant', args.variant)
  },
} satisfies StoryObj<StatusBadgeCanonicalArgs>

export const TreatmentComparison = {
  render: () => (
    <StoryStage
      eyebrow="Status comparison"
      title="Compare status treatments"
      description="The same labels in soft, outline, and solid treatments. These specimens show the current kit; compare the text, border, and fill before choosing a direction."
      width="wide"
    >
      <StorySection title="All tones" description="Each group repeats the same five states. Read the labels to identify meaning independently of color.">
        <Grid layout="thirds">
          {(['soft', 'outline', 'solid'] as const).map((variant) => (
            <Stack key={variant} align="start">
              <h3>{variant}</h3>
              <StatusBadge tone="neutral" variant={variant}>Last known</StatusBadge>
              <StatusBadge tone="success" variant={variant}>Healthy</StatusBadge>
              <StatusBadge tone="attention" variant={variant}>Needs review</StatusBadge>
              <StatusBadge tone="danger" variant={variant}>6 failed</StatusBadge>
              <StatusBadge tone="accent" variant={variant}>Official</StatusBadge>
            </Stack>
          ))}
        </Grid>
      </StorySection>
      <StorySection title="Size and icons" description="Compare xs, sm, and md using the same failure label. The second specimen adds an icon without changing the copy.">
        <Grid layout="thirds">
          {(['soft', 'outline', 'solid'] as const).map((variant) => (
            <Stack key={variant}>
              <h3>{variant}</h3>
              {(['xs', 'sm', 'md'] as const).map((size) => (
                <Stack key={size} gap="dense">
                  <span className="text-bakin-typography-size-meta text-bakin-text-muted">{size}</span>
                  <StoryCluster>
                    <StatusBadge tone="danger" variant={variant} size={size}>Hiccups</StatusBadge>
                    <StatusBadge tone="danger" variant={variant} size={size} icon={SignalIcon}>Hiccups</StatusBadge>
                  </StoryCluster>
                </Stack>
              ))}
            </Stack>
          ))}
        </Grid>
      </StorySection>
      <StorySection title="Repeated dashboard labels" description="The same four services repeat in each treatment so the total visual weight is easier to judge on a card surface.">
        {(['soft', 'outline', 'solid'] as const).map((variant) => (
          <Stack key={variant}>
            <h3>{variant}</h3>
            <Grid layout="quarters">
              {[
                { name: 'Bakin host', label: 'Online', detail: '0 connected sessions' },
                { name: 'Search', label: 'Healthy', detail: '4 of 4 stages ready' },
                { name: 'Installed features', label: 'Healthy', detail: '16 discovered' },
                { name: 'Health checks', label: 'Verified', detail: '49 completed checks' },
              ].map((service) => (
                <Card key={service.name} size="sm">
                  <CardHeader><CardTitle>{service.name}</CardTitle></CardHeader>
                  <CardContent>
                    <Stack align="start" gap="dense">
                      <StatusBadge tone="success" variant={variant}>{service.label}</StatusBadge>
                      <p className="text-bakin-typography-size-meta text-bakin-text-muted">{service.detail}</p>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Grid>
          </Stack>
        ))}
      </StorySection>
      <StorySection title="Long labels in a narrow space" description="The badge truncates in a narrow column. Keep the full wording available alongside it so readers can recover the meaning without hovering.">
        <StoryCluster>
          {(['soft', 'outline', 'solid'] as const).map((variant) => (
            <Stack key={variant} className="max-w-full" style={{ width: 'calc(var(--bakin-layout-space-8) * 6)' }}>
              <h3>{variant}</h3>
              <StatusBadge tone="attention" variant={variant} icon={SignalIcon}>
                Waiting for verification from the search service
              </StatusBadge>
              <p className="text-bakin-typography-size-meta text-bakin-text-muted">
                Waiting for verification from the search service
              </p>
            </Stack>
          ))}
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    for (const [index, variant] of ['soft', 'outline', 'solid'].entries()) {
      await expect(canvas.getAllByText('6 failed')[index].closest('[data-status-badge]')).toHaveAttribute('data-variant', variant)
      const label = 'Waiting for verification from the search service'
      const longLabel = canvas.getAllByText(label, { selector: '[data-status-badge] .truncate' })[index]
      await expect(longLabel).toBeVisible()
      await expect(longLabel.scrollWidth).toBeGreaterThan(longLabel.clientWidth)
      await expect(canvas.getAllByText(label, { selector: 'p' })[index]).toBeVisible()
      await expect(longLabel.closest('[data-status-badge]')?.querySelector('[aria-hidden="true"]')).toBeTruthy()
    }
  },
} satisfies Story

export const StatusVocabulary = {
  render: () => (
    <StoryStage
      eyebrow="State / compact language"
      title="Say what changed, even without color"
      description="Every chip keeps a visible state label. Tone and optional iconography reinforce the message but never replace it."
    >
      <StorySection title="Filled" description="Use a filled status by default so state scans immediately.">
        <StoryCluster>
          <StatusBadge tone="neutral" size="xs">Draft</StatusBadge>
          <StatusBadge tone="success" icon={CheckIcon}>Published</StatusBadge>
          <StatusBadge tone="attention">Needs review</StatusBadge>
          <StatusBadge tone="danger">Blocked</StatusBadge>
          <StatusBadge tone="accent" icon={SignalIcon}>Working now</StatusBadge>
        </StoryCluster>
      </StorySection>
      <StorySection title="Outline" description="Use outline for secondary, uncertain, or historical context.">
        <StoryCluster>
          <StatusBadge tone="neutral" variant="outline">Last known</StatusBadge>
          <StatusBadge tone="success" variant="outline">Checks passing</StatusBadge>
          <StatusBadge tone="attention" variant="outline">Coverage partial</StatusBadge>
          <StatusBadge tone="danger" variant="outline">Action required</StatusBadge>
        </StoryCluster>
      </StorySection>
      <StorySection title="Provenance and lifecycle" description="Accent marks provenance such as Official; success marks confirmed outcomes such as Installed.">
        <StoryCluster>
          <StatusBadge tone="accent" variant="solid" size="xs">Official</StatusBadge>
          <StatusBadge tone="success" variant="solid" size="xs" icon={CheckIcon}>Installed</StatusBadge>
        </StoryCluster>
      </StorySection>
      <StorySection title="Product lifecycle">
        <StoryCluster>
          <StatusBadge tone="success" variant="solid" size="xs">Active</StatusBadge>
          <StatusBadge tone="neutral" variant="solid" size="xs">Archived</StatusBadge>
          <StatusBadge tone="success" variant="solid" size="xs">Accepted</StatusBadge>
          <StatusBadge tone="attention" variant="solid" size="xs">In production</StatusBadge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Published').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'success')
    await expect(canvas.getByText('Needs review')).toBeVisible()
    await expect(canvas.getByText('Blocked')).toBeVisible()
    await expect(canvas.getByText('Working now').closest('[data-status-badge]')?.querySelector('[aria-hidden="true"]')).toBeTruthy()
    await expect(canvas.getByText('Official').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'accent')
    await expect(canvas.getByText('Official').closest('[data-status-badge]')).toHaveAttribute('data-variant', 'solid')
    await expect(canvas.getByText('Installed').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'success')
    await expect(canvas.getByText('Active').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'success')
    await expect(canvas.getByText('Archived').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'neutral')
    await expect(canvas.getByText('Accepted').closest('[data-status-badge]')).toHaveAttribute('data-variant', 'solid')
  },
} satisfies Story
