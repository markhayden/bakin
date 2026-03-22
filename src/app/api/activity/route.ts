import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { readTaskboard } from '@mc/tasks/taskboard'
import { getContentDir } from '@/core/content-dir'

export interface ActivityEvent {
  id: string
  ts: string
  type: 'log' | 'audit'
  agent: string
  message: string
  taskId?: string
  taskTitle?: string
  eventName?: string
}

const AUDIT_PATH = join(getContentDir(), 'audit.jsonl')

function mapAuditMessage(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'task.dispatched': return `Dispatched: ${data.title}`
    case 'task.triaged': return `Triaged: ${data.title}`
    case 'task.created': return `Created task: ${data.title}`
    case 'task.deleted': return `Deleted task: ${data.title}`
    case 'task.moved': return `Moved "${data.title}" → ${data.to}`
    case 'task.assigned': return `Assigned "${data.title}" to ${data.assignee}`
    case 'task.blocked': return `Blocked: ${data.title} — ${data.reason || 'no reason'}`
    case 'task.updated': return `Updated: ${data.title}`
    case 'system.init': return 'Beacon started'
    case 'system.dispatch_error': return `Dispatch failed: ${data.error || 'unknown error'}`
    default: return event
  }
}

/** Normalize old truncated UTC timestamps (e.g. "2026-03-21 21:37") to proper ISO 8601 */
function normalizeTimestamp(ts: string): string {
  // Already a proper ISO timestamp (has T and/or Z)
  if (ts.includes('T')) return ts
  // Old format: "YYYY-MM-DD HH:MM" — was UTC but stored without indicator
  return ts.replace(' ', 'T') + ':00Z'
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
          const data = entry.data || {}
          events.push({
            id: `${entry.ts}-${entry.event}-${entry.agent}`,
            ts: entry.ts,
            type: 'audit',
            agent: entry.agent || 'system',
            message: mapAuditMessage(entry.event, data),
            taskId: data.taskId as string | undefined,
            taskTitle: data.title as string | undefined,
            eventName: entry.event,
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
            const ts = normalizeTimestamp(entry.timestamp)
            events.push({
              id: `${ts}-log-${entry.author}`,
              ts,
              type: 'log',
              agent: entry.author || 'system',
              message: entry.message,
              taskId: task.id,
              taskTitle: task.title,
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
