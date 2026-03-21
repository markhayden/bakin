export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
}

export interface Task {
  id: string
  title: string
  agent?: string
  checked: boolean
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  workflowId?: string
}

export interface TaskColumns {
  inProgress: Task[]
  todo: Task[]
  done: Task[]
  confirmed: Task[]
  blocked: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns
