import type { ColumnId } from './types'

export const COLUMN_CONFIG = {
  inProgress: { label: 'In Progress', emoji: '🔵' },
  todo: { label: 'Todo', emoji: '📋' },
  done: { label: 'Done', emoji: '✅' },
  confirmed: { label: 'Confirmed', emoji: '🟣' },
  blocked: { label: 'Blocked', emoji: '🔴' },
} as const

export const COLUMN_HEADERS: Record<string, ColumnId> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🟣 Confirmed': 'confirmed',
  '🔴 Blocked': 'blocked',
}

export const STATUS_DOT_COLORS: Record<ColumnId, string> = {
  inProgress: 'bg-blue-400',
  todo: 'bg-amber-400',
  done: 'bg-green-400',
  confirmed: 'bg-green-400',
  blocked: 'bg-red-400',
}

export const STATUS_BADGE_STYLES: Record<ColumnId, { bg: string; label: string }> = {
  todo: { bg: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', label: 'Todo' },
  inProgress: { bg: 'bg-blue-500/10 text-blue-400 border border-blue-500/20', label: 'In Progress' },
  done: { bg: 'bg-green-500/10 text-green-400 border border-green-500/20', label: 'Done' },
  blocked: { bg: 'bg-red-500/10 text-red-400 border border-red-500/20', label: 'Blocked' },
  confirmed: { bg: 'bg-purple-500/10 text-purple-400 border border-purple-500/20', label: 'Confirmed' },
}

export const AGENT_AVATAR_COLORS: Record<string, string> = {
  main-operator: 'bg-blue-400',
  chef: 'bg-green-400',
  pixel: 'bg-violet-400',
  rolo: 'bg-orange-400',
  patch: 'bg-zinc-400',
}
