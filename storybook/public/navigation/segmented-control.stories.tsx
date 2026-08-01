import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { SegmentedControl } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Navigation/SegmentedControl',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SegmentedControl is the compact view/mode switcher with tab semantics and automatic horizontal keyboard activation. Long labels remain intact inside a locally scrollable tablist, and disabled modes are skipped by arrow-key movement. `idPrefix` links each tab to a consumer-owned `${idPrefix}-panel-${value}` panel. The control is controlled: the consumer owns `value`, and when the active mode changes what a shared page link opens, it belongs in URL state via `@makinbakin/sdk/navigation`.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction', 'disabled', 'long-labels', 'overflow', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface SegmentedControlCanonicalArgs {
  /** Control density: `sm` is the compact default; `md` carries page-level switchers. */
  size: 'sm' | 'md'
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'sm',
  },
  // SegmentedControl is generic over its option values, so docgen cannot
  // infer its props; the knob declares itself.
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
  },
  render: (args: SegmentedControlCanonicalArgs) => (
    <SegmentedControl
      ariaLabel="Task view"
      size={args.size}
      options={[
        { value: 'board', label: 'Board' },
        { value: 'list', label: 'List' },
      ]}
      value="board"
      onValueChange={() => {}}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tablist', { name: 'Task view' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'false')
  },
} satisfies StoryObj<SegmentedControlCanonicalArgs>

const views = [
  { value: 'board', label: 'Board' },
  { value: 'timeline', label: 'Timeline', disabled: true },
  { value: 'operations', label: 'Operational log with preserved context' },
] as const

const panelStyle = {
  minBlockSize: '8rem',
  padding: 'var(--bakin-layout-space-6)',
  borderRadius: 'var(--bakin-radius-control)',
  background: 'var(--bakin-color-canvas-default)',
  lineHeight: 1.6,
} as const

function SegmentedNavigationExample() {
  const [view, setView] = useState<(typeof views)[number]['value']>('board')

  return (
    <StoryStage
      eyebrow="View / compact modes"
      title="Switch modes with one compact control"
      description="Long labels remain intact inside a locally scrollable tablist. Disabled modes are skipped by automatic arrow-key activation."
    >
      <StorySection
        title="Task view"
        description="The active view belongs in the URL when it changes what a shared page link opens."
      >
        <SegmentedControl
          idPrefix="task-view"
          ariaLabel="Task view"
          options={views}
          value={view}
          onValueChange={setView}
        />
        {views.map((option) => (
          <div
            key={option.value}
            id={`task-view-panel-${option.value}`}
            role="tabpanel"
            aria-labelledby={`task-view-tab-${option.value}`}
            hidden={view !== option.value}
            style={panelStyle}
          >
            {option.label} is the active task view.
          </div>
        ))}
      </StorySection>
    </StoryStage>
  )
}

export const SegmentedNavigation = {
  render: () => <SegmentedNavigationExample />,
  play: async ({ canvas, userEvent }) => {
    const board = canvas.getByRole('tab', { name: 'Board' })
    board.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Operational log with preserved context' })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Operational log')
    await userEvent.keyboard('{Home}')
    await expect(board).toHaveAttribute('aria-selected', 'true')
  },
} satisfies Story
