export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
}

export interface Task {
  title: string
  agent?: string
  checked: boolean
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
}

export interface TaskColumns {
  inProgress: Task[]
  todo: Task[]
  done: Task[]
  blocked: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns

export interface CalendarEvent {
  time?: string
  text: string
}

export interface CalendarDay {
  date: string
  label?: string
  events: CalendarEvent[]
}

export interface RecurringEvent {
  schedule: string
  text: string
}

export interface MemoryEntry {
  type: 'decision' | 'learned' | 'note'
  text: string
}

export interface MemoryDay {
  date: string
  entries: MemoryEntry[]
}

export interface AgentMeta {
  id: string
  emoji: string
  name: string
  role: string
}

export interface Heartbeat {
  status: 'working' | 'idle' | 'down'
  currentTask?: string
  timestamp: string
}

export interface ProjectMeta {
  filename: string
  title: string
  status?: string
  content: string
}

export interface DocMeta {
  filename: string
  title: string
  content: string
}

export interface OfficeData {
  asciiMap: string
  statusTable: { agent: string; status: string; task: string; heartbeat: string }[]
  history: string[]
}

export interface ContentState {
  files: Record<string, string>
  heartbeats: Record<string, Heartbeat>
  connected: boolean
}
