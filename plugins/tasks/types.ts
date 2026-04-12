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
  /** Wall-clock ms of the last DB row update — used by the watchdog as a fallback "last activity" when a task has no log entries yet. */
  updatedAt?: number
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
