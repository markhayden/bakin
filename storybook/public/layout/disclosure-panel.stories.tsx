import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent } from 'storybook/test'
import { DisclosurePanel } from '@makinbakin/sdk/layout'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Layout/DisclosurePanel',
  component: DisclosurePanel,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'DisclosurePanel is a bounded region that opens in place: native `<details>` semantics wearing the kit\'s surface paint, with one summary-row treatment, optional summary meta, and a rotating indicator. Use it for secondary evidence a page reveals on demand (inventories, raw detail, acknowledged items) — never as a substitute for overlays, and never hand-roll `<details>` styled as a card.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels'],
  },
} satisfies Meta<typeof DisclosurePanel>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    summary: 'All health checks',
    summaryMeta: '24 checks',
    children: (
      <p style={{ margin: 0 }}>
        Every registered check with its latest evidence, grouped by owner.
      </p>
    ),
  },
  render: (args) => (
    <div style={{ width: 'min(100%, 28rem)', minWidth: 0 }}>
      <DisclosurePanel {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const details = canvas.getByText('All health checks').closest('details') as HTMLDetailsElement
    await expect(details.open).toBe(false)
    // Native disclosure semantics: the summary is the one control.
    await userEvent.click(canvas.getByText('All health checks'))
    await expect(details.open).toBe(true)
    await expect(canvas.getByText(/latest evidence/)).toBeVisible()
    await userEvent.click(canvas.getByText('All health checks'))
    await expect(details.open).toBe(false)
  },
} satisfies Story

export const OpenByDefault = {
  parameters: {
    docs: {
      description: {
        story:
          'The native `open` attribute carries initial state; long summaries wrap while the meta and indicator hold the end of the row. `soft` keeps the surface fill but softens the outline (the Button secondary treatment); `ghost` drops surface, border, radius, and inset entirely so the disclosure sits in its parent content column and hugs its own label, keeping the indicator part of the control.',
      },
    },
  },
  args: { summary: null },
  render: () => (
    <StoryStage
      eyebrow="States"
      title="Open regions and long summaries"
      description="Initial state rides the native attribute; the row survives long labels."
    >
      <StorySection title="Open by default">
        <DisclosurePanel open summary="Session detail" summaryMeta="3 active">
          <p style={{ margin: 0 }}>main · copywriter · researcher</p>
        </DisclosurePanel>
      </StorySection>
      <StorySection
        title="Soft"
        description="Keeps the surface fill and softens the edge instead of asserting it — the Button secondary treatment."
      >
        <DisclosurePanel variant="soft" summary="3 progress log line(s)">
          <p style={{ margin: 0 }}>Analytics API returned 503 — backing off</p>
        </DisclosurePanel>
      </StorySection>
      <StorySection
        title="Ghost"
        description="For a surface that already owns a boundary — a timeline entry's rail, a row, a card body — where a second painted box reads as a detached widget."
      >
        <DisclosurePanel variant="ghost" summary="3 progress log line(s)">
          <p style={{ margin: 0 }}>Analytics API returned 503 — backing off</p>
        </DisclosurePanel>
      </StorySection>
      <StorySection title="Long summary">
        <DisclosurePanel
          summary="Acknowledged incidents that remain snoozed until their owning subsystem reports a state change or the snooze window lapses"
          summaryMeta="7"
        >
          <p style={{ margin: 0 }}>Snoozed incidents keep their evidence and resolution identity.</p>
        </DisclosurePanel>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const open = canvas.getByText('Session detail').closest('details') as HTMLDetailsElement
    await expect(open.open).toBe(true)
    await expect(canvas.getByText(/main · copywriter/)).toBeVisible()
    // No page-level horizontal overflow from the long summary.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
