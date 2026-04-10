export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
}

export interface Task {
  id: string
  title: string
  agent?: string
  createdBy?: string
  checked: boolean
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  order?: number
}

export interface TaskColumns {
  backlog: Task[]
  inProgress: Task[]
  todo: Task[]
  review: Task[]
  done: Task[]
  archived: Task[]
  blocked: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns
