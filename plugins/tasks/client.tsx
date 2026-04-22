/**
 * Tasks plugin — client entry point.
 * Registers nav items and client-side slot contributions via registerPlugin.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { KanbanBoard } from './components/kanban-board'

const navItems: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
]

registerPlugin({
  id: 'tasks',
  navItems,
  slots: {
    'page:/tasks': KanbanBoard,
  },
})
