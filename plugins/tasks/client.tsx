/**
 * Tasks plugin — client entry point.
 * Exports nav items and registers client-side slot contributions.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { KanbanBoard } from './components/kanban-board'

export const navItems: NavItem[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
]

registerSlot('page:/tasks', KanbanBoard)
