/**
 * Tasks plugin — client entry point.
 * Registers client-side slot contributions via registerPlugin. Nav is
 * declared in bakin-plugin.json `contributes.nav`; slots are mirrored in
 * `contributes.slots`. Eager (`contributes.eager`) because the nav badge
 * provider must run at boot.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { KanbanBoard } from './components/kanban-board'
import { TasksBadgeProvider } from './components/tasks-badge-provider'

registerPlugin({
  id: 'tasks',
  slots: {
    'page:/tasks': KanbanBoard,
    // Background runner that keeps the Tasks nav badge (blocked/review) in
    // sync. Renders nothing; stays mounted while the plugin is registered.
    'nav-badge-providers': TasksBadgeProvider,
  },
})
