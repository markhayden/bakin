import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Panel } from '@makinbakin/sdk/layout'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Layout/Panel',
  component: Panel,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Panel is the bounded content region: one painted boundary (surface, border, radius, padding) for grouped content that is not an object Card. `tone` paints the canonical status rail; `variant="code"` is the mono, canvas-toned frame for command and output content; `scroll` bounds internal scrolling behind a consumer-set max-height. Page rhythm still belongs to Section — Panel only paints the box. Never hand-roll `rounded + border + bg` region boxes.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels', 'overflow'],
  },
} satisfies Meta<typeof Panel>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    tone: { control: 'select', options: [undefined, 'neutral', 'success', 'attention', 'danger', 'accent'] },
    variant: { control: 'select', options: ['default', 'code'] },
    padding: { control: 'select', options: ['default', 'compact'] },
  },
  render: (args) => (
    <div style={{ width: 'min(100%, 26rem)', minWidth: 0 }}>
      <Panel {...args} aria-labelledby="panel-heading">
        <h3 id="panel-heading" style={{ margin: 0, fontSize: 'inherit' }}>Runtime & package</h3>
        <p style={{ margin: '0.5rem 0 0' }}>
          Managed by the copywriter package · runtime identity synced 4 minutes ago.
        </p>
      </Panel>
    </div>
  ),
  play: async ({ canvas }) => {
    const panel = canvas.getByText('Runtime & package').closest('[data-slot="panel"]') as HTMLElement
    await expect(panel).not.toBeNull()
    // The panel paints its own boundary — consumers never re-roll border/bg.
    const style = getComputedStyle(panel)
    await expect(style.borderStyle).toBe('solid')
    await expect(style.overflow).toBe('hidden')
  },
} satisfies Story

export const ToneRail = {
  parameters: {
    docs: {
      description: {
        story:
          'The status rail is the one spelling of "this region carries a status" — the same rail Card uses. Never re-create it with border-l-2 or before: pseudo-elements in consumer code.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Tone"
      title="Status-railed regions"
      description="One rail treatment across every toned region."
    >
      <StorySection title="Attention note">
        <Panel tone="attention">
          <strong>Skill drift detected.</strong> Two steps reference a stale local workflow skill; open the highlighted steps to repair.
        </Panel>
      </StorySection>
      <StorySection title="Danger note">
        <Panel tone="danger">
          <strong>Reject path.</strong> The workflow stops and the owner is notified with the collected outputs.
        </Panel>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const toned = canvas.getByText('Skill drift detected.').closest('[data-slot="panel"]') as HTMLElement
    await expect(toned).toHaveAttribute('data-tone', 'attention')
    const rail = getComputedStyle(toned, '::before')
    await expect(rail.position).toBe('absolute')
    // The rail must actually paint — a missing token renders transparent.
    await expect(rail.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  },
} satisfies Story

export const CodeFrame = {
  parameters: {
    docs: {
      description: {
        story:
          'variant="code" is the painted command/output frame — mono, canvas-toned, wrap-safe. It replaces the fleet\'s hand-rolled pre/code boxes.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Code"
      title="Command and output frames"
      description="One frame for CLI hints, raw output, and machine text."
    >
      <StorySection title="Command hint">
        <Panel variant="code" padding="compact">
          bakin agents sync --check copywriter
        </Panel>
      </StorySection>
      <StorySection title="Raw output">
        <Panel variant="code">
          <pre>{`{
  "status": "drifted",
  "files": ["SOUL.md", "TOOLS.md"],
  "lastSync": "2026-07-30T15:02:11Z"
}`}</pre>
        </Panel>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const frame = canvas.getByText(/bakin agents sync/).closest('[data-slot="panel"]') as HTMLElement
    await expect(frame).toHaveAttribute('data-variant', 'code')
    await expect(getComputedStyle(frame).fontFamily).toContain('mono')
  },
} satisfies Story

export const BoundedScroll = {
  parameters: {
    docs: {
      description: {
        story:
          'scroll bounds long content inside the region: the consumer sets the max-height, the panel owns overflow behavior and scrollbar gutter. The page never grows a second scrollbar.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Scroll"
      title="Bounded internal scrolling"
      description="Long evidence scrolls inside its region."
    >
      <StorySection title="Transcript excerpt">
        <Panel scroll aria-label="Transcript excerpt" className="max-h-40">
          {Array.from({ length: 14 }, (_, index) => (
            <p key={index} style={{ margin: index === 0 ? 0 : '0.5rem 0 0' }}>
              {index + 1}. Indexed 240 rows into bakin_memory_v3 and acknowledged the outbox batch.
            </p>
          ))}
        </Panel>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const panel = canvas.getAllByText(/Indexed 240 rows/)[0].closest('[data-slot="panel"]') as HTMLElement
    await expect(panel).toHaveAttribute('data-scroll')
    await expect(getComputedStyle(panel).overflowY).toBe('auto')
    await expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight)
  },
} satisfies Story
