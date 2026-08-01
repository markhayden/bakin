// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

const dropRef = mock()

mock.module('@dnd-kit/react', () => ({
  useDroppable: () => ({ ref: dropRef, isDropTarget: false }),
}))

mock.module('../../../plugins/tasks/components/task-card', () => ({
  TaskCard: ({ task }: { task: { id: string; title: string } }) => (
    <article data-testid={`task-${task.id}`}>
      {task.title}
    </article>
  ),
}))

import { KanbanColumn } from '../../../plugins/tasks/components/kanban-column'
import type { Task } from '../../../plugins/tasks/types'

afterEach(() => {
  cleanup()
  dropRef.mockClear()
})

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, checked: false, ...overrides }
}

describe('Tasks KanbanColumn', () => {
  const callbacks = {
    onDelete: mock(),
    onTaskClick: mock(),
  }

  it('uses the canonical low-chrome lane and keeps an explicit empty target', () => {
    const { container } = render(<KanbanColumn id="todo" tasks={[]} {...callbacks} />)

    expect(screen.getByRole('region', { name: 'Todo' })).toBeTruthy()
    expect(container.querySelector('[data-slot="kanban-column-header"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="kanban-column-body"]')).toBeTruthy()
    expect(screen.getByText('No tasks')).toBeTruthy()
    expect(screen.getByLabelText('0 tasks')).toBeTruthy()
  })

  it('registers the complete stable lane stack without a custom target model', () => {
    const { container } = render(
      <KanbanColumn
        id="todo"
        tasks={[task('existing')]}
        {...callbacks}
      />,
    )

    const surface = container.querySelector('[data-task-drop-surface]')
    expect(surface).toBeTruthy()
    expect(surface?.contains(container.querySelector('[data-slot="kanban-column-header"]'))).toBe(true)
    expect(surface?.contains(container.querySelector('[data-slot="kanban-column-body"]'))).toBe(true)
    expect(dropRef).toHaveBeenCalledWith(surface)
    expect(container.querySelector('[data-drop-target]')).toBeNull()
    expect(container.querySelector('[data-drop-position-indicator]')).toBeNull()
  })

  it('separates future-scheduled records without hiding the ready stack', () => {
    render(
      <KanbanColumn
        id="todo"
        tasks={[
          task('ready'),
          task('scheduled', { availableAt: '2099-07-23T10:00:00.000Z' }),
        ]}
        {...callbacks}
      />,
    )

    expect(screen.getByTestId('task-ready')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Scheduled' })).toBeTruthy()
    expect(screen.getByLabelText('1 scheduled task')).toBeTruthy()
    expect(screen.getByTestId('task-scheduled')).toBeTruthy()
  })

  it('keeps archive navigation on explicit buttons instead of the whole lane', () => {
    const onHeaderClick = mock()
    render(
      <KanbanColumn
        id="archived"
        tasks={[]}
        compact
        totalCount={4}
        onHeaderClick={onHeaderClick}
        {...callbacks}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Drop here to archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'View archived items' }))
    expect(onHeaderClick).toHaveBeenCalledTimes(2)
  })
})
