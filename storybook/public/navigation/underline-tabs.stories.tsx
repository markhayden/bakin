import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { UnderlineTabs } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Navigation/UnderlineTabs',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'UnderlineTabs is the quieter page-section treatment: linked panels, roving focus, automatic keyboard activation, and narrow-width overflow inside a locally scrollable tablist, plus an optional `rightSlot` for section-level actions. `idPrefix` links each tab to a consumer-owned `${idPrefix}-panel-${id}` panel. Selection is controlled: the consumer owns `value`, and when the active section changes what a shared page link opens, it belongs in URL state via `@makinbakin/sdk/navigation`.',
      },
    },
    bakinCoverage: ['desktop', 'keyboard', 'disabled', 'long-labels', 'overflow', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ inlineSize: 'min(90vw, 36rem)' }}>
      <UnderlineTabs
        ariaLabel="Runtime sections"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'activity', label: 'Activity' },
        ]}
        value="overview"
        onValueChange={() => {}}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Runtime sections' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false')
  },
} satisfies Story

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity and recent operational history' },
  { id: 'system', label: 'System-managed details', disabled: true },
] as const

const panelStyle = {
  minBlockSize: '8rem',
  padding: 'var(--bakin-layout-space-6)',
  borderRadius: 'var(--bakin-radius-control)',
  background: 'var(--bakin-color-canvas-default)',
  lineHeight: 1.6,
} as const

function UnderlineNavigationExample() {
  const [section, setSection] = useState('overview')

  return (
    <StoryStage
      eyebrow="Page / sections"
      title="Keep page sections anchored to their content"
      description="Underline tabs provide the quieter page-level treatment while retaining linked panels, roving focus, and narrow-width overflow."
    >
      <StorySection
        title="Runtime connection"
        description="Section selection is controlled by the page and can be synchronized to query state."
      >
        <UnderlineTabs
          idPrefix="runtime"
          ariaLabel="Runtime sections"
          tabs={sections}
          value={section}
          onValueChange={setSection}
          rightSlot={<Button size="xs" variant="ghost">Export</Button>}
        />
        {sections.map((item) => (
          <div
            key={item.id}
            id={`runtime-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`runtime-tab-${item.id}`}
            hidden={section !== item.id}
            style={panelStyle}
          >
            {item.label} content remains part of the runtime page.
          </div>
        ))}
      </StorySection>
    </StoryStage>
  )
}

export const UnderlineNavigation = {
  render: () => <UnderlineNavigationExample />,
  play: async ({ canvas, userEvent }) => {
    const overview = canvas.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'Activity and recent operational history' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Activity and recent operational history')
    await userEvent.keyboard('{Home}')
    await expect(overview).toHaveAttribute('aria-selected', 'true')
  },
} satisfies Story
