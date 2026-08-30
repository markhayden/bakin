import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, within } from 'storybook/test'

import { FacetFilter } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Navigation/FacetFilter',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'FacetFilter is the searchable multi-select filter for result sets. Search appears once the option count passes `searchThreshold`, per-option counts stay visible in every result, and selected values can be removed individually or cleared together. The component is fully controlled: the consumer owns `selected` and, on a routed page, keeps it linkable through the existing URL-state hooks in `@makinbakin/sdk/navigation` — the pattern itself never touches the URL.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'interaction', 'counts', 'clearing', 'long-labels', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const states = [
  { value: 'running', label: 'Running' },
  { value: 'blocked', label: 'Needs attention because a dependency is unavailable' },
  { value: 'queued', label: 'Queued' },
  { value: 'complete', label: 'Complete' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
] as const

const stateCounts = {
  running: 12,
  blocked: 3,
  queued: 8,
  complete: 42,
  paused: 2,
  draft: 7,
  archived: 14,
}

interface FacetFilterCanonicalArgs {
  /** Facet name shown on the trigger and announced with the selection count. */
  label: string
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    label: 'State',
  },
  // The controlled selected/onChange pair stays fixed, so the knob declares itself.
  argTypes: {
    label: { control: 'text' },
  },
  render: (args: FacetFilterCanonicalArgs) => (
    <FacetFilter
      label={args.label}
      options={[
        { value: 'running', label: 'Running' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'complete', label: 'Complete' },
      ]}
      selected={['blocked']}
      onChange={() => {}}
    />
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: `${args.label}, 1 selected` })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Remove Blocked filter' })).toBeVisible()
  },
} satisfies StoryObj<FacetFilterCanonicalArgs>

function FacetFilteringExample() {
  const [selected, setSelected] = useState<string[]>(['blocked'])

  return (
    <StoryStage
      eyebrow="Results / multi-select"
      title="Keep filter state visible and reversible"
      description="Search appears for a longer option set, counts remain available in every result, and selected values can be removed individually or cleared together. A routed page stores the controlled value in query state."
    >
      <StorySection
        title="Task filters"
        description="42 active tasks across agents, schedules, assets, and workflows."
      >
        <FacetFilter
          label="State"
          options={states}
          selected={selected}
          counts={stateCounts}
          onChange={setSelected}
        />
        <p role="status" style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
          {selected.length === 0 ? 'Showing every task state' : `Filtering by ${selected.join(', ')}`}
        </p>
      </StorySection>
    </StoryStage>
  )
}

export const FacetFiltering = {
  render: () => <FacetFilteringExample />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: 'State, 1 selected' }))
    const search = page.getByRole('combobox', { name: 'Search State' })
    await userEvent.type(search, 'Running')
    await userEvent.click(page.getByRole('option', { name: 'Running 12' }))
    await expect(canvas.getByRole('button', { name: 'State, 2 selected' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clear State filters' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Showing every task state')
    await userEvent.clear(search)
    await userEvent.click(page.getByRole('option', { name: 'Needs attention because a dependency is unavailable 3' }))
    await expect(canvas.getByRole('button', { name: 'State, 1 selected' })).toBeVisible()
  },
} satisfies Story
