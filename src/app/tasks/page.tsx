'use client'

import { Suspense } from 'react'
import { KanbanBoard } from '@bakin/tasks/components/kanban-board'

export default function TasksPage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <KanbanBoard />
      </Suspense>
    </div>
  )
}
