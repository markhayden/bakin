import type { Task, TaskLogEntry, TaskColumns, TaskBoard, ColumnId } from '@/types'

const COLUMN_HEADER_MAP: Record<string, ColumnId> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🔴 Blocked': 'blocked',
}

const LOG_RE = /^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+(\w+)\]\s*(.+)/

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
  return { title: extractTitle(line), agent, checked, date, blockedReason }
}

export function parseTasks(content: string): TaskBoard {
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
      // Check if it's a log entry: [2026-03-18 main-operator] message
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
