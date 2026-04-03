'use client'

import type { AuditEntry } from '../types'
import { useAgent } from '@bakin/team/hooks/use-agent-store'

const EVENT_ICONS: Record<string, string> = {
  'system.init': '🔄',
  'task.created': '➕',
  'task.moved': '➡️',
  'task.deleted': '🗑️',
  'task.updated': '✏️',
  'task.dispatched': '📤',
  'task.triaged': '📋',
  'task.blocked': '🚫',
  'agent.start': '🚀',
  'agent.stop': '⏹️',
}

function getEventIcon(event: string): string {
  if (EVENT_ICONS[event]) return EVENT_ICONS[event]
  if (event.startsWith('task.')) return '📝'
  if (event.startsWith('agent.')) return '🤖'
  if (event.startsWith('system.')) return '⚙️'
  return '📌'
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return ts
  }
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function summarize(entry: AuditEntry): string {
  const d = entry.data
  switch (entry.event) {
    case 'system.init':
      return (d.message as string) || 'System initialized'
    case 'task.created':
      return `Created "${d.title}"${d.assignee ? ` → @${d.assignee}` : ''}`
    case 'task.moved':
      return `Moved "${d.title}"${d.from ? ` from ${d.from}` : ''} to ${d.to}`
    case 'task.deleted':
      return `Deleted "${d.title}"`
    case 'task.updated':
      return `Updated "${d.originalTitle || d.title}"`
    case 'task.dispatched':
      return `Dispatched "${d.title}"`
    case 'task.triaged':
      return `Triaged "${d.title}"`
    case 'task.blocked':
      return `Blocked "${d.title}": ${d.reason}`
    case 'agent.start':
      return `Started ${d.target || d.agent || 'agent'}`
    case 'agent.stop':
      return `Stopped ${d.target || d.agent || 'agent'}`
    default:
      return JSON.stringify(d).slice(0, 120)
  }
}

export function TimelineEntry({ entry }: { entry: AuditEntry }) {
  const agent = useAgent(entry.agent)
  const agentLabel = agent ? `${agent.emoji} ${agent.name}` : entry.agent

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors">
      <span className="text-base mt-0.5 shrink-0" title={entry.event}>
        {getEventIcon(entry.event)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{summarize(entry)}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">{agentLabel}</span>
          <span className="text-xs text-muted-foreground/50">·</span>
          <span className="text-xs text-muted-foreground font-mono">
            {formatDate(entry.ts)} {formatTimestamp(entry.ts)}
          </span>
          <span className="text-xs text-muted-foreground/50">·</span>
          <span className="text-xs text-muted-foreground/60 font-mono">{entry.event}</span>
        </div>
      </div>
    </div>
  )
}
