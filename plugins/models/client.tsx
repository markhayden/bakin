/**
 * Models plugin — client entry point.
 */
import { registerPlugin } from '@makinbakin/sdk'
import type { NavItem } from '@makinbakin/sdk'
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
