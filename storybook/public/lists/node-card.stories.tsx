import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { NodeCard } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Lists/NodeCard',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'NodeCard is the one canvas-node card — the shared paint for workflow-graph steps and any future node-graph surface. The card owns surface, border treatment (`subtle`, tone-tinted, or `strong` for emphasized shapes like gates, plus `dashed` for grouping and fan-out shapes), the attention ring for entries needing a human look, the icon-chip type row, and the text hierarchy (truncating title, consumer body rows). Consumers own the icon, the labels, extra body rows (agent assignments, excerpts, mono ids), and any graph-library plumbing — connection handles and positioning render alongside as children. Fixed node dimensions come from the graph layout, so the card fills its box (`h-full w-full`); `centered` vertically centers label-only shapes.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface NodeCardCanonicalArgs {
  /** Colors the type row and icon chip. */
  tone: 'neutral' | 'primary' | 'info' | 'accent' | 'highlight'
  /** Border treatment; `strong` suits emphasized shapes like approval gates. */
  border: 'subtle' | 'tone' | 'strong'
  /** Dashed border for grouping and fan-out shapes. */
  dashed: boolean
  /** Attention ring for entries needing a human look. */
  attention: boolean
}

function ChipIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-bakin-3 fill-none stroke-current stroke-[1.5]"
    >
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3.5 13c.7-2.3 2.4-3.5 4.5-3.5s3.8 1.2 4.5 3.5" strokeLinecap="round" />
    </svg>
  )
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'primary',
    border: 'subtle',
    dashed: false,
    attention: false,
  },
  // No meta `component` (required `typeLabel` breaks render-only stories),
  // so the knobs declare themselves.
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'primary', 'info', 'accent', 'highlight'] },
    border: { control: 'select', options: ['subtle', 'tone', 'strong'] },
    dashed: { control: 'boolean' },
    attention: { control: 'boolean' },
  },
  // Width frame: graph layouts give nodes fixed boxes; the centered canvas
  // needs a definite inline size or the card collapses.
  render: (args: NodeCardCanonicalArgs) => (
    <div style={{ inlineSize: '17.5rem', maxInlineSize: '100%' }}>
      <NodeCard
        tone={args.tone}
        border={args.border}
        dashed={args.dashed}
        attention={args.attention}
        typeLabel="Agent Task"
        icon={(
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
            <circle cx="8" cy="5" r="2.5" />
            <path d="M3.5 13c.7-2.3 2.4-3.5 4.5-3.5s3.8 1.2 4.5 3.5" strokeLinecap="round" />
          </svg>
        )}
        title="Draft launch copy"
      >
        <p className="mt-bakin-1 line-clamp-2 text-[length:var(--bakin-typography-size-meta)] leading-snug text-bakin-text-muted">
          Write the announcement post from the campaign brief.
        </p>
      </NodeCard>
    </div>
  ),
  play: async ({ canvas, args }) => {
    const card = canvas.getByText('Draft launch copy').closest('[data-slot="node-card"]')
    await expect(card).toBeTruthy()
    await expect(card).toHaveAttribute('data-tone', args.tone)
    if (args.attention) await expect(card).toHaveAttribute('data-attention')
  },
} satisfies StoryObj<NodeCardCanonicalArgs>

export const ShapesAndStates = {
  render: () => (
    <StoryStage
      eyebrow="Lists / canvas nodes"
      title="One card for every graph shape"
      description="Tones separate step families; strong borders emphasize gates; dashed borders mark grouping and fan-out shapes; the attention ring flags entries needing a human look. Long titles truncate inside the graph's fixed node box."
    >
      <StorySection title="Step families">
        <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))' }}>
          <NodeCard tone="info" centered typeLabel="Start" icon={<ChipIcon />}>
            <div className="line-clamp-2 text-[length:var(--bakin-typography-size-meta)] leading-snug text-bakin-text-muted">
              Task context passed to the first step
            </div>
          </NodeCard>
          <NodeCard tone="primary" typeLabel="Agent Task" icon={<ChipIcon />} title="Draft launch copy">
            <p className="mt-bakin-1 line-clamp-2 text-[length:var(--bakin-typography-size-meta)] leading-snug text-bakin-text-muted">
              Write the announcement post from the campaign brief.
            </p>
          </NodeCard>
          <NodeCard tone="highlight" border="strong" centered typeLabel="Approval Gate" icon={<ChipIcon />} title="Owner sign-off" />
          <NodeCard tone="accent" border="tone" typeLabel="Completion" icon={<ChipIcon />} title="Publish everywhere">
            <div className="mt-bakin-1 truncate text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
              Channels: blog, newsletter
            </div>
          </NodeCard>
          <NodeCard tone="info" border="tone" dashed centered typeLabel="Parallel Group" icon={<ChipIcon />} title="Research lanes" />
          <NodeCard
            tone="primary"
            attention
            typeLabel="Agent Task"
            icon={<ChipIcon />}
            badge={<span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-signal-highlight">Stale</span>}
            title="A deliberately long node title that must truncate inside its fixed graph box"
          />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Owner sign-off').closest('[data-slot="node-card"]')).toHaveAttribute('data-tone', 'highlight')
    const stale = canvas.getByText(/deliberately long node title/).closest('[data-slot="node-card"]')
    await expect(stale).toHaveAttribute('data-attention')
    await expect(canvas.getByText('Research lanes').closest('[data-slot="node-card"]')?.className).toContain('border-dashed')
  },
} satisfies Story
