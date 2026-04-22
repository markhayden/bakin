/**
 * Schedule plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { SchedulePage } from './components/schedule-page'

export const navItems: NavItem[] = [
  { id: 'schedule', label: 'Schedule', icon: 'AlarmClock', href: '/schedule', order: 22 },
]

registerSlot('page:/schedule', SchedulePage)
