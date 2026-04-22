/**
 * Messaging plugin — client entry point.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { ContentCalendar } from './components/content-calendar'
import { BrainstormView } from './components/brainstorm-view'

const navItems: NavItem[] = [
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

registerPlugin({
  id: 'messaging',
  navItems,
  slots: {
    'page:/messaging/calendar': ContentCalendar,
    'page:/messaging/brainstorm': BrainstormView,
  },
})
