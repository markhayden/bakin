// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  KanbanBoard,
  KanbanCardSignal,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnHeader,
} from '@makinbakin/sdk/patterns'

afterEach(cleanup)

describe('kanban composition patterns', () => {
  it('owns one labelled horizontal boundary with low-chrome named columns', () => {
    const { container } = render(
      <KanbanBoard label="Task board">
        <KanbanColumn label="Todo">
          <KanbanColumnHeader><h2>Todo</h2><span>2</span></KanbanColumnHeader>
          <KanbanColumnBody><article>First task</article></KanbanColumnBody>
        </KanbanColumn>
        <KanbanColumn label="Done">
          <KanbanColumnHeader><h2>Done</h2><span>0</span></KanbanColumnHeader>
          <KanbanColumnBody><p>No tasks</p></KanbanColumnBody>
        </KanbanColumn>
      </KanbanBoard>,
    )

    expect(screen.getByRole('region', { name: 'Task board' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Task board' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getAllByRole('region', { name: /Todo|Done/ })).toHaveLength(2)
    expect(container.querySelector('[data-slot="kanban-board-track"]')?.className).toContain('min-w-max')
    expect(container.querySelector('[data-slot="kanban-column-header"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="kanban-column-body"]')?.className).toContain('flex-col')
  })

  it('uses full-width filled rows for card-level operational signals', () => {
    const { container } = render(
      <KanbanCardSignal tone="attention" label="Needs approval">
        Approve final copy
      </KanbanCardSignal>,
    )

    const signal = container.querySelector('[data-slot="kanban-card-signal"]')
    expect(signal).toBeTruthy()
    expect(signal?.getAttribute('data-tone')).toBe('attention')
    expect(signal?.className).toContain('bg-bakin-signal-highlight/15')
    expect(screen.getByText('Needs approval')).toBeTruthy()
    expect(screen.getByText('Approve final copy')).toBeTruthy()
  })
})
