export const COLUMN_CONFIG = {
  inProgress: { label: 'In Progress', emoji: '🔵' },
  todo: { label: 'Todo', emoji: '📋' },
  review: { label: 'Review', emoji: '🔍' },
  done: { label: 'Done', emoji: '✅' },
  confirmed: { label: 'Confirmed', emoji: '🟣' },
  blocked: { label: 'Blocked', emoji: '🔴' },
} as const

export const COLUMN_HEADERS: Record<string, string> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '🔍 Review': 'review',
  '✅ Done': 'done',
  '🟣 Confirmed': 'confirmed',
  '🔴 Blocked': 'blocked',
}
