/**
 * Messaging plugin — client entry point.
 */
import type { NavItem } from '../../src/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { ContentCalendar } from './components/content-calendar'
import { BrainstormView } from './components/brainstorm-view'

export const navItems: NavItem[] = [
  {
    id: 'messaging',
    label: 'Messaging',
    icon: 'MessageSquare',
    href: '/messaging',
    order: 25,
    alwaysExpanded: true,
    children: [
      { id: 'messaging-calendar', label: 'Calendar', icon: 'CalendarDays', href: '/messaging/calendar' },
      { id: 'messaging-brainstorm', label: 'Brainstorm', icon: 'Sparkles', href: '/messaging/brainstorm' },
    ],
  },
]

registerSlot('page:/messaging/calendar', ContentCalendar)
registerSlot('page:/messaging/brainstorm', BrainstormView)
