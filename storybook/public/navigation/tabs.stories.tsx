import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Navigation/Tabs',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Tabs is the one tab system, styled by variant on `TabsList`. The `default` variant is the compact filled control for local view switching; `variant="underline"` is the quieter page-section treatment: linked panels, roving focus, narrow-width overflow inside a locally scrollable tablist, and — with `activateOnFocus` — automatic keyboard activation. Disabled tabs stay focusable for discoverability but never activate. For underline page sections, pin `id`/`aria-controls` on each `TabsTrigger` to link consumer-owned `${prefix}-panel-${id}` panels. Selection can be controlled: the consumer owns `value`, and when the active section changes what a shared page link opens, it belongs in URL state via `@makinbakin/sdk/navigation`.',
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
      <Tabs defaultValue="overview">
        <TabsList aria-label="Runtime sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview content</TabsContent>
        <TabsContent value="activity">Activity content</TabsContent>
      </Tabs>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Runtime sections' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Overview content')
  },
} satisfies Story

const sections: ReadonlyArray<{ id: string; label: string; disabled?: boolean }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity and recent operational history' },
  { id: 'system', label: 'System-managed details', disabled: true },
]

const panelStyle = {
  minBlockSize: '8rem',
  padding: 'var(--bakin-layout-space-6)',
  borderRadius: 'var(--bakin-radius-control)',
  background: 'var(--bakin-color-canvas-default)',
  lineHeight: 1.6,
} as const

const actionsRowStyle = {
  display: 'flex',
  minInlineSize: 0,
  maxInlineSize: '100%',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 'var(--bakin-layout-space-3)',
  borderBlockEnd: '1px solid var(--bakin-color-border-subtle)',
} as const

function UnderlineNavigationExample() {
  const [section, setSection] = useState('overview')

  return (
    <StoryStage
      eyebrow="Page / sections"
      title="Keep page sections anchored to their content"
      description="The underline variant provides the quieter page-level treatment while retaining linked panels, roving focus, and narrow-width overflow."
    >
      <StorySection
        title="Runtime connection"
        description="Section selection is controlled by the page and can be synchronized to query state."
      >
        <Tabs value={section} onValueChange={(value) => setSection(value as string)}>
          <div style={actionsRowStyle}>
            <TabsList
              variant="underline"
              activateOnFocus
              aria-label="Runtime sections"
              style={{ borderBlockEnd: 'none' }}
            >
              {sections.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  id={`runtime-tab-${item.id}`}
                  aria-controls={`runtime-panel-${item.id}`}
                  disabled={item.disabled}
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', paddingBlockEnd: 'var(--bakin-layout-space-2)' }}>
              <Button size="xs" variant="ghost">Export</Button>
            </div>
          </div>
        </Tabs>
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
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Activity and recent operational history' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Activity and recent operational history')
    // Disabled tabs stay focusable for discoverability but never activate.
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'System-managed details' })).toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.getByRole('tab', { name: 'Activity and recent operational history' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    await expect(overview).toHaveAttribute('aria-selected', 'true')
  },
} satisfies Story
