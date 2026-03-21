import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { readTaskboard } from '@mc/tasks/taskboard'

export interface ActivityEvent {
  id: string
  ts: string
  type: 'log' | 'audit'
  agent: string
  message: string
}

const AUDIT_PATH = join(process.cwd(), 'content', 'audit.jsonl')

function mapAuditMessage(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'task.dispatched': return `Dispatched: ${data.title}`
    case 'task.triaged': return `Triaged: ${data.title}`
    case 'task.created': return `Created task: ${data.title}`
    case 'task.deleted': return `Deleted task: ${data.title}`
    case 'system.init': return 'Beacon started'
    default: return event
  }
}

export async function GET() {
  const events: ActivityEvent[] = []

  // 1. Parse audit.jsonl
  if (existsSync(AUDIT_PATH)) {
    try {
      const lines = readFileSync(AUDIT_PATH, 'utf-8').trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          events.push({
            id: `${entry.ts}-${entry.event}-${entry.agent}`,
            ts: entry.ts,
            type: 'audit',
            agent: entry.agent || 'system',
            message: mapAuditMessage(entry.event, entry.data || {}),
          })
        } catch { /* skip malformed lines */ }
      }
    } catch { /* file read error */ }
  }

  // 2. Pull task log entries from TASKBOARD.md
  try {
    const board = readTaskboard()
    const columns = board.columns
    for (const col of Object.values(columns)) {
      for (const task of col) {
        if (task.log) {
          for (const entry of task.log) {
            events.push({
              id: `${entry.timestamp}-log-${entry.author}`,
              ts: entry.timestamp,
              type: 'log',
              agent: entry.author || 'system',
              message: entry.message,
            })
          }
        }
      }
    }
  } catch { /* taskboard read error */ }

  // Sort newest first, cap at 50
  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  return NextResponse.json({ events: events.slice(0, 50) })
}
