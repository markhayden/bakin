/**
 * Models plugin — client entry point.
 */
import { registerPlugin } from '@bakin/sdk'
import type { NavItem } from '@bakin/sdk'
import { ModelsPage } from './components/models-page'

const navItems: NavItem[] = [
  { id: 'models', label: 'Models', icon: 'Cpu', href: '/models', order: 70 },
]

registerPlugin({
  id: 'models',
  navItems,
  slots: {
    'page:/models': ModelsPage,
  },
})
