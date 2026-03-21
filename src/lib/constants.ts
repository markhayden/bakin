import { AGENT_PROFILES, AGENT_MAP } from './agents-data'
import type { AgentMeta } from '@/types'

/** Lightweight agent list for badges/dropdowns (derived from single source) */
export const AGENTS: AgentMeta[] = AGENT_PROFILES.map(a => ({
  id: a.id,
  emoji: a.emoji,
  name: a.name,
  role: a.role,
}))

export { AGENT_MAP }

export const COLUMN_CONFIG = {
  inProgress: { label: 'In Progress', emoji: '🔵' },
  todo: { label: 'Todo', emoji: '📋' },
  done: { label: 'Done', emoji: '✅' },
  confirmed: { label: 'Confirmed', emoji: '🟣' },
  blocked: { label: 'Blocked', emoji: '🔴' },
} as const

export const COLUMN_HEADERS: Record<string, string> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🟣 Confirmed': 'confirmed',
  '🔴 Blocked': 'blocked',
}

/** @deprecated Use allNavItems from plugin-manifest.ts instead */
export const NAV_ITEMS = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar', href: '/calendar' },
  { id: 'projects', label: 'Projects', icon: 'FolderOpen', href: '/projects' },
  { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory' },
  { id: 'docs', label: 'Docs', icon: 'FileText', href: '/docs' },
  { id: 'team', label: 'Team', icon: 'Users', href: '/team' },
] as const
