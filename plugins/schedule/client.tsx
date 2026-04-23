/**
 * Schedule plugin — client entry point.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { SchedulePage } from './components/schedule-page'

const navItems: NavItem[] = [
  { id: 'schedule', label: 'Schedule', icon: 'AlarmClock', href: '/schedule', order: 22 },
]

registerPlugin({
  id: 'schedule',
  navItems,
  slots: {
    'page:/schedule': SchedulePage,
  },
})
