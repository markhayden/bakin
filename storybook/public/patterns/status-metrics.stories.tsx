import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, PageShell, Stack } from '@makinbakin/sdk/layout'
import { StatGroup, StatTile, StatusBadge } from '@makinbakin/sdk/patterns'

import './status-metrics.stories.css'

const meta = {
  title: 'Patterns/Status and metrics',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StatusBadge and StatTile provide one non-color status vocabulary and a compact technical metric treatment. Accent identifies provenance or a product signal such as Official; success is reserved for confirmed outcomes such as Installed. Public patterns use canonical attention/danger tones; compatibility adapters retain legacy names until official surface migration.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'non-color', 'progress', 'keyboard', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function PatternStage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="bakin-status-metrics-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-status-metrics-story__intro">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
}

function SignalIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 5.5V8l1.75 1.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
}

export const StatusLanguage = {
  render: () => (
    <PatternStage
      eyebrow="State / compact language"
      title="Say what changed, even without color"
      description="Every chip keeps a visible state label. Tone and optional iconography reinforce the message but never replace it."
    >
      <section aria-labelledby="status-language-heading" className="bakin-status-metrics-story__section">
        <div><h2 id="status-language-heading">Operational status</h2><p>Use a filled status by default so state scans immediately. Use outline for secondary, uncertain, or historical context.</p></div>
        <div className="bakin-status-metrics-story__status-groups">
          <div><span>Filled</span><div>
            <StatusBadge tone="neutral" size="xs">Draft</StatusBadge>
            <StatusBadge tone="success" icon={CheckIcon}>Published</StatusBadge>
            <StatusBadge tone="attention">Needs review</StatusBadge>
            <StatusBadge tone="danger">Blocked</StatusBadge>
            <StatusBadge tone="accent" icon={SignalIcon}>Working now</StatusBadge>
          </div></div>
          <div><span>Outline</span><div>
            <StatusBadge tone="neutral" variant="outline">Last known</StatusBadge>
            <StatusBadge tone="success" variant="outline">Checks passing</StatusBadge>
            <StatusBadge tone="attention" variant="outline">Coverage partial</StatusBadge>
            <StatusBadge tone="danger" variant="outline">Action required</StatusBadge>
          </div></div>
          <div><span>Provenance and lifecycle</span><div>
            <StatusBadge tone="accent" variant="solid" size="xs">Official</StatusBadge>
            <StatusBadge tone="success" variant="solid" size="xs" icon={CheckIcon}>Installed</StatusBadge>
          </div></div>
        </div>
      </section>
    </PatternStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Published').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'success')
    await expect(canvas.getByText('Needs review')).toBeVisible()
    await expect(canvas.getByText('Blocked')).toBeVisible()
    await expect(canvas.getByText('Working now').closest('[data-status-badge]')?.querySelector('[aria-hidden="true"]')).toBeTruthy()
    await expect(canvas.getByText('Official').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'accent')
    await expect(canvas.getByText('Official').closest('[data-status-badge]')).toHaveAttribute('data-variant', 'solid')
    await expect(canvas.getByText('Installed').closest('[data-status-badge]')).toHaveAttribute('data-tone', 'success')
  },
} satisfies Story

function MetricIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><path d="M3 12V8m5 4V3m5 9V6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
}

export const DenseMetrics = {
  render: () => (
    <PatternStage
      eyebrow="Data / scan rhythm"
      title="Keep technical metrics dense and honest"
      description="The default treatment uses type, spacing, and a quiet divider instead of placing a card around every number."
    >
      <section aria-labelledby="dense-metrics-heading" className="bakin-status-metrics-story__section">
        <div><h2 id="dense-metrics-heading">Task summary</h2><p>Exact context and coverage stay beside the value, including at narrow widths and 200% text.</p></div>
        <Grid layout="quarters" gap="dense" aria-label="Task summary metrics">
          <StatTile icon={MetricIcon} label="Active" value={42} sub="Across six agents" />
          <StatTile label="Success rate" value="91.4%" valueTone="success" sub="128 of 140 observed" progress={{ percent: 91.4, tone: 'success', label: 'Success rate' }} />
          <StatTile label="Search p95" value="184 ms" sub="Last 60 minutes" />
          <StatTile label="Plugin migration coverage across official surfaces" value="128 / 140" valueTone="attention" sub="12 surfaces remain" progress={{ percent: 91.428, tone: 'attention', label: 'Plugin migration coverage' }} />
        </Grid>
      </section>
    </PatternStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(/Active|Success rate|Search p95|Plugin migration coverage/)).toHaveLength(4)
    await expect(canvas.getByRole('progressbar', { name: 'Success rate' })).toHaveAttribute('aria-valuenow', '91.4')
    await expect(canvas.getByRole('progressbar', { name: 'Plugin migration coverage' })).toHaveAttribute('aria-valuenow', '91.428')
    for (const tile of canvas.getAllByText(/42|91.4%|184 ms|128 \/ 140/).map((node) => node.closest('[data-stat-tile]'))) {
      await expect(tile).toHaveAttribute('data-variant', 'plain')
    }
  },
} satisfies Story

export const CompactMetrics = {
  render: () => (
    <PatternStage
      eyebrow="Data / compact peer summary"
      title="Keep short peer metrics together"
      description="A compact metric group packs from the start edge and wraps as one unit instead of stretching a handful of values across the page."
    >
      <section aria-labelledby="compact-metrics-heading" className="bakin-status-metrics-story__section">
        <div><h2 id="compact-metrics-heading">Task summary</h2><p>Use this treatment for short, equally important counters above a result set.</p></div>
        <StatGroup label="Task summary metrics">
          <StatTile label="Active" value={4} valueTone="accent" />
          <StatTile label="Blocked" value={23} valueTone="danger" />
          <StatTile label="Done today" value={0} valueTone="success" />
          <StatTile label="Total" value={35} />
          <StatTile label="Agents" value={3} valueTone="accent" />
        </StatGroup>
      </section>
    </PatternStage>
  ),
  play: async ({ canvas }) => {
    const group = canvas.getByRole('group', { name: 'Task summary metrics' })
    await expect(group).toHaveAttribute('data-stat-group', '')
    await expect(group.querySelectorAll('[data-stat-tile]')).toHaveLength(5)
  },
} satisfies Story

function ActionableMetricsExample() {
  const [selected, setSelected] = useState<string | null>(null)
  const choose = (value: string) => setSelected((current) => current === value ? null : value)

  return (
    <PatternStage
      eyebrow="Data / bounded actions"
      title="Use a surface only when the metric is an object"
      description="Actionable tiles become native buttons with visible focus. Static summary numbers stay on the quieter default treatment."
    >
      <section aria-labelledby="metric-actions-heading" className="bakin-status-metrics-story__section">
        <div><h2 id="metric-actions-heading">Open a filtered task view</h2><p>The label, value, and supporting copy form one keyboard-operable action.</p></div>
        <Grid layout="cards" gap="item" aria-label="Actionable task metrics">
          <StatTile variant="surface" label="Needs review" value={8} valueTone="attention" sub="Open the review queue" onClick={() => choose('Needs review')} />
          <StatTile variant="surface" label="Blocked tasks" value={3} valueTone="danger" sub="Inspect unavailable dependencies" onClick={() => choose('Blocked tasks')} />
          <StatTile variant="surface" label="Completed today" value={27} valueTone="success" sub="Review delivered work" onClick={() => choose('Completed today')} />
        </Grid>
        <p role="status" className="bakin-status-metrics-story__selection">{selected ? `${selected} selected` : 'No metric selected'}</p>
      </section>
    </PatternStage>
  )
}

export const ActionableMetrics = {
  render: () => <ActionableMetricsExample />,
  play: async ({ canvas, userEvent }) => {
    const blocked = canvas.getByRole('button', { name: /Blocked tasks 3/ })
    blocked.focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Blocked tasks selected')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('No metric selected')
    await expect(blocked).toHaveFocus()
  },
} satisfies Story
