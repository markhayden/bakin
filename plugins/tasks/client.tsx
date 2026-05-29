/**
 * Tasks plugin — client entry point.
 * Registers nav items and client-side slot contributions via registerPlugin.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
import { KanbanBoard } from './components/kanban-board'
import { TasksBadgeProvider } from './components/tasks-badge-provider'

const navItems: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
]

registerPlugin({
  id: 'tasks',
  navItems,
  slots: {
    'page:/tasks': KanbanBoard,
    // Background runner that keeps the Tasks nav badge (blocked/review) in
    // sync. Renders nothing; stays mounted while the plugin is registered.
    'nav-badge-providers': TasksBadgeProvider,
  },
})
