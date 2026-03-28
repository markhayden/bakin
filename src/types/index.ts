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
  headshot: string
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

export interface AssetVariantMeta {
  role: 'thumbnail' | 'optimized' | 'webp'
  path: string
  filename: string
  size: number
  mimeType: string
}

export interface AssetMeta {
  path: string
  filename: string
  type: 'text' | 'images' | 'video' | 'audio' | 'plans' | 'data' | 'other'
  mimeType: string
  size: number
  mtimeMs?: number
  metadata: {
    agent: string
    taskId: string | null
    created: string
    tool?: string
    description?: string
    tags?: string[]
    originalFilename?: string
  }
  variants?: AssetVariantMeta[]
}

export interface TrashedAssetMeta {
  filename: string           // trash filename (with __deleted- suffix)
  originalFilename: string
  type: string
  mimeType: string
  size: number
  deletedAt: string
  expiresAt: string
  metadata: {
    agent: string
    taskId: string | null
    created: string
    tool?: string
    description?: string
    tags?: string[]
  } | null
}

export interface OfficeData {
  asciiMap: string
  statusTable: { agent: string; status: string; task: string; heartbeat: string }[]
  history: string[]
}

export interface ActivityEvent {
  id: string
  ts: string
  type: 'log' | 'audit' | 'alert'
  agent: string
  message: string
  taskId?: string
  taskTitle?: string
  eventName?: string
}

export interface ContentState {
  files: Record<string, string>
  heartbeats: Record<string, Heartbeat>
  connected: boolean
}
