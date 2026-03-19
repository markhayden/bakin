import type { AgentMeta } from '@/types'

export const AGENTS: AgentMeta[] = [
  { id: 'main-operator', emoji: '🐾', name: 'Main Operator', role: 'Orchestrator · Lead Agent' },
  { id: 'chef', emoji: '🥗', name: 'Chef', role: 'Nutritionist & Culinary Expert · Content Creator' },
  { id: 'pixel', emoji: '🖼️', name: 'Pixel', role: 'Image Generation · Visual Content' },
  { id: 'rolo', emoji: '🎬', name: 'Rolo', role: 'Videographer & Editor · Video Content' },
  { id: 'patch', emoji: '⚙️', name: 'Patch', role: 'Lead Developer' },
]

export const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a]))

export const COLUMN_CONFIG = {
  inProgress: { label: 'In Progress', emoji: '🔵' },
  todo: { label: 'Todo', emoji: '📋' },
  done: { label: 'Done', emoji: '✅' },
  blocked: { label: 'Blocked', emoji: '🔴' },
} as const

export const COLUMN_HEADERS: Record<string, string> = {
  '🔵 In Progress': 'inProgress',
  '📋 Todo': 'todo',
  '✅ Done': 'done',
  '🔴 Blocked': 'blocked',
}

export const CONTENT_DIR = process.env.CONTENT_DIR || 'content'
export const PORT = Number(process.env.PORT || 3737)

export const NAV_ITEMS = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar', href: '/calendar' },
  { id: 'projects', label: 'Projects', icon: 'FolderOpen', href: '/projects' },
  { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory' },
  { id: 'docs', label: 'Docs', icon: 'FileText', href: '/docs' },
  { id: 'team', label: 'Team', icon: 'Users', href: '/team' },
] as const
