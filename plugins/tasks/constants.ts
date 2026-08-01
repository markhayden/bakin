import type { StatusTone } from '@makinbakin/sdk/patterns'

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

/**
 * Semantic StatusTone per board column — THE status color mapping for every
 * task surface (badges, dots, markers). Raw per-status palette classes were
 * retired in the storybook refit (T6.5); render dots via `StatusMarker` and
 * pills via `StatusBadge` with these tones.
 */
export const STATUS_TONES: Record<ColumnId, StatusTone> = {
  backlog: 'neutral',
  todo: 'accent',
  inProgress: 'accent',
  review: 'attention',
  done: 'success',
  blocked: 'danger',
  archived: 'neutral',
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
