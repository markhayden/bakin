import {
  KanbanBoard,
  KanbanCardSignal,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnHeader,
} from '@makinbakin/sdk/patterns'

export const validKanbanComposition = (
  <KanbanBoard label="Task board">
    <KanbanColumn labelledBy="todo-heading">
      <KanbanColumnHeader><h2 id="todo-heading">Todo</h2></KanbanColumnHeader>
      <KanbanColumnBody ref={(element) => void element}><p>No tasks</p></KanbanColumnBody>
    </KanbanColumn>
  </KanbanBoard>
)

export const validKanbanSignal = (
  <KanbanCardSignal tone="accent" label="Current turn">
    Writing launch copy
  </KanbanCardSignal>
)

// @ts-expect-error the horizontal board boundary needs a durable accessible name
export const invalidUnnamedKanbanBoard = <KanbanBoard><div /></KanbanBoard>

// @ts-expect-error a lane needs a durable accessible name or labelled heading
export const invalidUnnamedKanbanColumn = <KanbanColumn><div /></KanbanColumn>
