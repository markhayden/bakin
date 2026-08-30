import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type CSSProperties } from 'react'
import { expect } from 'storybook/test'

import { SortableHead, type SortDir } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Navigation/SortableHead',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SortableHead puts sort meaning on the native table column header: the `th` carries `aria-sort` for the active direction while the nested button remains the keyboard-operable action, so sort state stays explicit even when color and iconography are unavailable. Sorting is controlled: the consumer owns `current` and `dir` and, on a routed page, keeps a shareable sort in URL state via `@makinbakin/sdk/navigation`.',
      },
    },
    bakinCoverage: ['desktop', 'interaction', 'non-color', 'overflow', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <table style={{ inlineSize: 'min(90vw, 30rem)', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <SortableHead field="task" current="updated" dir="desc" onSort={() => {}}>Task</SortableHead>
          <SortableHead field="updated" current="updated" dir="desc" onSort={() => {}}>Updated</SortableHead>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Review plugin migration guidance</td>
          <td>8 minutes ago</td>
        </tr>
      </tbody>
    </table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
    await expect(canvas.getByRole('columnheader', { name: 'Task' })).not.toHaveAttribute('aria-sort')
    await expect(canvas.getByRole('button', { name: 'Updated' })).toBeEnabled()
  },
} satisfies Story

type SortField = 'task' | 'owner' | 'updated'

const rows = [
  { task: 'Review plugin migration guidance', owner: 'Patch', updated: '8 minutes ago' },
  { task: 'Verify workflow fallback actions', owner: 'Rolo', updated: '22 minutes ago' },
  { task: 'Reconcile provider usage', owner: 'Pixel', updated: '1 hour ago' },
]

const tableScrollStyle: CSSProperties = {
  maxInlineSize: '100%',
  overflowX: 'auto',
  overscrollBehaviorInline: 'contain',
}

const tableStyle: CSSProperties = {
  inlineSize: '100%',
  minInlineSize: '38rem',
  borderCollapse: 'collapse',
}

const bodyCellStyle: CSSProperties = {
  padding: 'var(--bakin-layout-space-3) var(--bakin-layout-space-2)',
  borderBlockStart: '1px solid var(--bakin-color-border-subtle)',
  textAlign: 'start',
  overflowWrap: 'anywhere',
}

const bodyHeadStyle: CSSProperties = {
  ...bodyCellStyle,
  fontWeight: 'var(--bakin-typography-weight-semibold)' as CSSProperties['fontWeight'],
}

const mutedCellStyle: CSSProperties = {
  ...bodyCellStyle,
  color: 'var(--bakin-color-text-muted)',
}

function SortableTableExample() {
  const [field, setField] = useState<SortField>('updated')
  const [direction, setDirection] = useState<SortDir>('desc')
  const sort = (next: SortField) => {
    setDirection(next === field && direction === 'desc' ? 'asc' : 'desc')
    setField(next)
  }

  return (
    <StoryStage
      eyebrow="Table / ordering"
      title="Put sort meaning on the column header"
      description="The native header exposes the active direction while the nested button remains the keyboard-operable action."
    >
      <StorySection
        title="Active work"
        description="Sort state stays explicit even when color and iconography are unavailable."
      >
        <div style={tableScrollStyle} data-testid="sortable-table-scroll">
          <table style={tableStyle}>
            <thead>
              <tr>
                <SortableHead field="task" current={field} dir={direction} onSort={sort}>Task</SortableHead>
                <SortableHead field="owner" current={field} dir={direction} onSort={sort}>Owner</SortableHead>
                <SortableHead field="updated" current={field} dir={direction} onSort={sort}>Updated</SortableHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.task}>
                  <th scope="row" style={bodyHeadStyle}>{row.task}</th>
                  <td style={mutedCellStyle}>{row.owner}</td>
                  <td style={mutedCellStyle}>{row.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StorySection>
    </StoryStage>
  )
}

export const SortableTable = {
  render: () => <SortableTableExample />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(canvas.getByRole('button', { name: 'Updated' }))
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(canvas.getByRole('button', { name: 'Task' }))
    await expect(canvas.getByRole('columnheader', { name: 'Task' })).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(canvas.getByRole('button', { name: 'Updated' }))
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'descending')
    const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="sortable-table-scroll"]')
    if (scroller) scroller.scrollLeft = 0
  },
} satisfies Story
