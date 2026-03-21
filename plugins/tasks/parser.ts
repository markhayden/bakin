/**
 * Pure task parser — no fs/node dependencies. Safe for client components.
 */
import type { Task, TaskLogEntry, TaskColumns, TaskBoard, ColumnId } from './types'
import { generateTaskId } from './ids'

const COLUMN_HEADER_MAP: Record<string, ColumnId> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🟣 Confirmed': 'confirmed',
  '🔴 Blocked': 'blocked',
}

const LOG_RE = /^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+([\w.-]+)\]\s*(.+)/

const TRAILING_AGENT_RE = /\s+@(\w+)\s*(?=—|$)/
const TRAILING_DATE_RE = /\s+—\s+.*$/
const TASK_ID_RE = /^\[([a-f0-9]{8})\]\s*/

function extractTitle(line: string): { title: string; id?: string } {
  let text = line.replace(/^- \[[ x]\] /, '')
  let id: string | undefined
  const idMatch = text.match(TASK_ID_RE)
  if (idMatch) {
    id = idMatch[1]
    text = text.replace(TASK_ID_RE, '')
  }
  text = text.replace(TRAILING_DATE_RE, '').replace(TRAILING_AGENT_RE, '').trim()
  return { title: text, id }
}

function parseLine(line: string): Task | null {
  const match = line.match(/^- \[([ x])\] (.+)/)
  if (!match) return null
  const checked = match[1] === 'x'
  const rest = match[2]

  const agentMatch = rest.match(/\s+@(\w+)\s*(?=—|$)/)
  const agent = agentMatch ? agentMatch[1] : undefined

  const dateMatch = rest.match(/\s+—\s+(.+)/)
  let date = dateMatch ? dateMatch[1] : undefined
  let blockedReason: string | undefined
  if (date && date.startsWith('BLOCKED:')) {
    blockedReason = date.replace('BLOCKED: ', '').trim()
    date = undefined
  }

  const { title, id } = extractTitle(line)
  return { id: id || generateTaskId(), title, agent, checked, date, blockedReason }
}

export function parseTasks(content: string): TaskBoard {
  const columns: TaskColumns = { inProgress: [], todo: [], done: [], confirmed: [], blocked: [] }
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
      const depMatch = trimmed.match(/^dependsOn:\s*(\S+)/)
      const wfMatch = trimmed.match(/^workflow:\s*(\S+)/)
      if (depMatch) {
        currentTask.dependsOn = depMatch[1]
      } else if (wfMatch) {
        currentTask.workflowId = wfMatch[1]
      } else {
        const logMatch = trimmed.match(LOG_RE)
        if (logMatch) {
          logEntries.push({ timestamp: logMatch[1], author: logMatch[2], message: logMatch[3] })
        } else {
          descLines.push(trimmed)
        }
      }
    }
  }
  flushTask()

  return { columns, timestamp }
}
