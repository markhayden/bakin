import { readContentFile, writeContentFile } from './content'
import type { Task, TaskLogEntry, TaskColumns, ColumnId } from '@/types'

const LOG_RE = /^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+(\w+)\]\s*(.+)/

const COLUMN_HEADER_MAP: Record<string, ColumnId> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🔴 Blocked': 'blocked',
}

const COLUMN_TO_HEADER: Record<ColumnId, string> = {
  inProgress: '🔵 In Progress',
  todo: '📋 Todo',
  done: '✅ Done',
  blocked: '🔴 Blocked',
}

function normalizeColumn(col: string): ColumnId | null {
  const lower = col.toLowerCase().replace(/[^a-z]/g, '')
  if (lower === 'inprogress' || lower === 'in_progress') return 'inProgress'
  if (lower === 'todo') return 'todo'
  if (lower === 'done') return 'done'
  if (lower === 'blocked') return 'blocked'
  return null
}

function extractTitle(line: string): string {
  return line
    .replace(/^- \[[ x]\] /, '')
    .replace(/ @\w+/, '')
    .replace(/ — .*$/, '')
    .trim()
}

function parseLine(line: string): Task | null {
  const match = line.match(/^- \[([ x])\] (.+)/)
  if (!match) return null
  const checked = match[1] === 'x'
  const rest = match[2]
  const agentMatch = rest.match(/@(\w+)/)
  const agent = agentMatch ? agentMatch[1] : undefined
  const dateMatch = rest.match(/ — (.+)/)
  let date = dateMatch ? dateMatch[1] : undefined
  let blockedReason: string | undefined
  if (date && date.startsWith('BLOCKED:')) {
    blockedReason = date.replace('BLOCKED: ', '').trim()
    date = undefined
  }
  const title = extractTitle(line)
  return { title, agent, checked, date, blockedReason }
}

export function parseTaskboard(content: string): { columns: TaskColumns; timestamp?: string } {
  const columns: TaskColumns = { inProgress: [], todo: [], done: [], blocked: [] }
  let currentCol: ColumnId | null = null
  let currentTask: Task | null = null
  let descLines: string[] = []
  let logEntries: TaskLogEntry[] = []
  let timestamp: string | undefined

  function flushTask() {
    if (currentTask && currentCol) {
      if (descLines.length > 0) currentTask.description = descLines.join('\n')
      if (logEntries.length > 0) currentTask.log = logEntries
      columns[currentCol].push(currentTask)
    }
    currentTask = null
    descLines = []
    logEntries = []
  }

  for (const line of content.split('\n')) {
    const tsMatch = line.match(/_Last updated: (.+)_/)
    if (tsMatch) {
      timestamp = tsMatch[1]
      continue
    }
    const headerMatch = line.match(/^## (.+)/)
    if (headerMatch) {
      flushTask()
      currentCol = COLUMN_HEADER_MAP[headerMatch[1].trim()] || null
      continue
    }
    if (currentCol && line.startsWith('- [')) {
      flushTask()
      currentTask = parseLine(line)
    } else if (currentTask && /^\s{2,}/.test(line) && line.trim()) {
      const trimmed = line.trim()
      const logMatch = trimmed.match(LOG_RE)
      if (logMatch) {
        logEntries.push({ timestamp: logMatch[1], author: logMatch[2], message: logMatch[3] })
      } else {
        descLines.push(trimmed)
      }
    }
  }
  flushTask()

  return { columns, timestamp }
}

export function serializeTaskboard(columns: TaskColumns): string {
  const now = new Date()
  const ts = now.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    hour12: false,
  })
  let md = `# Task Board\n_Last updated: ${ts}_\n`

  for (const colId of ['inProgress', 'todo', 'done', 'blocked'] as ColumnId[]) {
    const header = COLUMN_TO_HEADER[colId]
    md += `\n## ${header}\n`
    for (const task of columns[colId]) {
      const check = task.checked ? 'x' : ' '
      let line = `- [${check}] ${task.title}`
      if (task.agent) line += ` @${task.agent}`
      if (task.blockedReason) line += ` — BLOCKED: ${task.blockedReason}`
      else if (task.date) line += ` — ${task.date}`
      md += line + '\n'
      if (task.description) {
        for (const descLine of task.description.split('\n')) {
          md += `  ${descLine}\n`
        }
      }
      if (task.log) {
        for (const entry of task.log) {
          md += `  [${entry.timestamp} ${entry.author}] ${entry.message}\n`
        }
      }
    }
  }
  return md
}

export function readTaskboard() {
  const content = readContentFile('TASKBOARD.md')
  if (!content) return { columns: { inProgress: [], todo: [], done: [], blocked: [] } }
  return parseTaskboard(content)
}

export function writeTaskboard(columns: TaskColumns) {
  writeContentFile('TASKBOARD.md', serializeTaskboard(columns))
}

export function createTask(title: string, column?: string, assignee?: string, description?: string) {
  const { columns } = readTaskboard()
  const colId = column ? (normalizeColumn(column) || 'todo') : 'todo'
  const task: Task = { title, agent: assignee, checked: colId === 'done', description }
  if (colId === 'inProgress' || colId === 'done') {
    task.date = new Date().toISOString().split('T')[0]
  }
  columns[colId].push(task)
  writeTaskboard(columns)
}

export function moveTask(title: string, to: string, from?: string) {
  const { columns } = readTaskboard()
  const toCol = normalizeColumn(to)
  if (!toCol) throw new Error(`Invalid column: ${to}`)
  const fromCol = from ? normalizeColumn(from) : null

  // Search the source column first, then fall back to all columns
  const searchOrder: ColumnId[] = fromCol
    ? [fromCol, ...(Object.keys(columns) as ColumnId[]).filter(c => c !== fromCol)]
    : Object.keys(columns) as ColumnId[]

  for (const colId of searchOrder) {
    const idx = columns[colId].findIndex(t => t.title === title)
    if (idx !== -1) {
      const [task] = columns[colId].splice(idx, 1)
      task.checked = toCol === 'done'
      if (toCol === 'inProgress' || toCol === 'done') {
        task.date = new Date().toISOString().split('T')[0]
      }
      if (toCol !== 'blocked') {
        task.blockedReason = undefined
      }
      columns[toCol].push(task)
      writeTaskboard(columns)
      return
    }
  }
  throw new Error(`Task not found: ${title}`)
}

export function assignTask(title: string, agent: string) {
  const { columns } = readTaskboard()
  for (const colId of Object.keys(columns) as ColumnId[]) {
    const task = columns[colId].find(t => t.title === title)
    if (task) {
      task.agent = agent || undefined
      writeTaskboard(columns)
      return
    }
  }
  throw new Error(`Task not found: ${title}`)
}

export function deleteTask(title: string) {
  const { columns } = readTaskboard()
  for (const colId of Object.keys(columns) as ColumnId[]) {
    const idx = columns[colId].findIndex(t => t.title === title)
    if (idx !== -1) {
      columns[colId].splice(idx, 1)
      writeTaskboard(columns)
      return
    }
  }
  throw new Error(`Task not found: ${title}`)
}

export function addTaskLog(title: string, author: string, message: string) {
  const { columns } = readTaskboard()
  for (const colId of Object.keys(columns) as ColumnId[]) {
    const task = columns[colId].find(t => t.title === title)
    if (task) {
      if (!task.log) task.log = []
      const ts = new Date().toISOString().split('T')[0]
      task.log.push({ timestamp: ts, author, message })
      writeTaskboard(columns)
      return
    }
  }
  throw new Error(`Task not found: ${title}`)
}

export function getAgentTasks(agentId: string): Task[] {
  const { columns } = readTaskboard()
  return columns.todo.filter(t => t.agent === agentId)
}
