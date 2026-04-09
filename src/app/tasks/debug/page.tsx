'use client'

import { TaskDndDebug } from '@bakin/tasks/components/task-dnd-debug'

export default function TasksDebugPage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <TaskDndDebug />
    </div>
  )
}
