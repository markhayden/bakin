import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { NavList, StatusBadge } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Navigation/NavList',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'NavList is the master-detail selection list: a vertical stack of options where choosing one swaps the adjacent detail surface. It is state-backed by design — the consumer owns `selectedId`/`onSelect`, and the active entry is announced with `aria-current="true"` inside a labeled `<nav>`. ArrowUp/ArrowDown/Home/End move focus and skip disabled entries; activation stays on click/Enter. Items carry a label plus optional leading identity, trailing meta, and a secondary description line; `sections` adds group headings. Route-backed navigators — where every entry is a real URL — should use `PluginLink` with `aria-current="page"` via `@makinbakin/sdk/navigation` instead, and a selection that changes what a shared page link opens belongs in URL state.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction', 'disabled', 'long-labels'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <NavList
      label="Plugin settings"
      selectedId="tasks"
      onSelect={() => {}}
      items={[
        { id: 'tasks', label: 'Tasks' },
        { id: 'schedule', label: 'Schedule' },
        { id: 'health', label: 'Health' },
      ]}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Plugin settings' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'true')
    await expect(canvas.getByRole('button', { name: 'Schedule' })).not.toHaveAttribute('aria-current')
  },
} satisfies Story

const sections = [
  {
    label: 'Core',
    items: [
      { id: 'tasks', label: 'Tasks', meta: <StatusBadge tone="neutral" variant="outline">12</StatusBadge> },
      { id: 'schedule', label: 'Schedule' },
      {
        id: 'workflows',
        label: 'Workflows with an unusually long display name that truncates',
        description: 'Multi-step orchestration, gates, and fan-out configuration.',
      },
    ],
  },
  {
    label: 'Extensions',
    items: [
      { id: 'lint', label: 'Lint reports' },
      { id: 'archived', label: 'Archived plugin', disabled: true },
      { id: 'weather', label: 'Weather', meta: <StatusBadge tone="success" variant="outline">New</StatusBadge> },
    ],
  },
]

function MasterDetailExample() {
  const [selected, setSelected] = useState('tasks')

  return (
    <StoryStage
      eyebrow="Navigation / master-detail"
      title="Select an entry, swap the detail surface"
      description="Selection lives in consumer state and is announced with aria-current. Arrow keys move focus and skip disabled entries; activation stays on click or Enter."
    >
      <StorySection
        title="Plugin settings"
        description="Sections group entries under uppercase headings; meta badges and description lines stay consumer-owned."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(12rem, 16rem) minmax(0, 1fr)',
            gap: 'var(--bakin-layout-space-6)',
            alignItems: 'start',
          }}
        >
          <NavList
            label="Plugin settings"
            sections={sections}
            selectedId={selected}
            onSelect={setSelected}
          />
          <div
            style={{
              minBlockSize: '10rem',
              padding: 'var(--bakin-layout-space-6)',
              borderRadius: 'var(--bakin-radius-surface)',
              border: '1px solid var(--bakin-color-border-subtle)',
              background: 'var(--bakin-color-canvas-default)',
            }}
          >
            Settings for <strong>{selected}</strong> render here.
          </div>
        </div>
      </StorySection>
    </StoryStage>
  )
}

export const SelectionAndKeyboard = {
  render: () => <MasterDetailExample />,
  play: async ({ canvas, userEvent }) => {
    const schedule = canvas.getByRole('button', { name: 'Schedule' })
    await userEvent.click(schedule)
    await expect(schedule).toHaveAttribute('aria-current', 'true')
    await expect(canvas.getByText('Settings for', { exact: false })).toHaveTextContent('schedule')

    // Arrow movement wraps and skips the disabled entry.
    canvas.getByRole('button', { name: 'Lint reports' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('button', { name: /Weather/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('button', { name: /^Tasks/ })).toHaveFocus()
    // Focus moved without changing the selection.
    await expect(schedule).toHaveAttribute('aria-current', 'true')
  },
} satisfies Story
