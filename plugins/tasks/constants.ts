import type { ColumnId } from './types'

export const COLUMN_CONFIG = {
  backlog: { label: 'Backlog', emoji: '📦' },
  inProgress: { label: 'In Progress', emoji: '🔵' },
  todo: { label: 'Todo', emoji: '📋' },
  review: { label: 'Review', emoji: '🔍' },
  done: { label: 'Done', emoji: '✅' },
  archived: { label: 'Archived', emoji: '📦' },
  blocked: { label: 'Blocked', emoji: '🔴' },
} as const

export const COLUMN_HEADERS: Record<string, ColumnId> = {
  '📦 Backlog': 'backlog',
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '🔍 Review': 'review',
  '✅ Done': 'done',
  '📦 Archived': 'archived',
  '🔴 Blocked': 'blocked',
}

export const STATUS_DOT_COLORS: Record<ColumnId, string> = {
  backlog:    'bg-status-backlog',
  inProgress: 'bg-status-in-progress',
  todo:       'bg-status-todo',
  review:     'bg-status-review',
  done:       'bg-status-done',
  archived:   'bg-zinc-500',
  blocked:    'bg-status-blocked',
}

export const VALID_TRANSITIONS: Record<ColumnId, ColumnId[]> = {
  backlog:    ['todo'],
  todo:       ['inProgress', 'blocked', 'done', 'backlog'],
  inProgress: ['review', 'done', 'blocked', 'todo'],
  blocked:    ['todo', 'inProgress', 'backlog'],
  review:     ['done', 'inProgress', 'todo'],
  done:       ['archived', 'todo', 'inProgress'],
  archived:   ['done', 'todo'],
}

export const STATUS_BADGE_STYLES: Record<ColumnId, { bg: string; label: string }> = {
  backlog:    { bg: 'bg-status-backlog/10 text-status-backlog border border-status-backlog/20', label: 'Backlog' },
  todo:       { bg: 'bg-status-todo/10 text-status-todo border border-status-todo/20', label: 'Todo' },
  inProgress: { bg: 'bg-status-in-progress/10 text-status-in-progress border border-status-in-progress/20', label: 'In Progress' },
  review:     { bg: 'bg-status-review/10 text-status-review border border-status-review/20', label: 'Review' },
  done:       { bg: 'bg-status-done/10 text-status-done border border-status-done/20', label: 'Done' },
  blocked:    { bg: 'bg-status-blocked/10 text-status-blocked border border-status-blocked/20', label: 'Blocked' },
  archived:   { bg: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20', label: 'Archived' },
}
