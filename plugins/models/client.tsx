/**
 * Models plugin — client entry point.
 */
import type { NavItem } from '@/lib/plugin-types'
import { registerSlot } from '@bakin/sdk/slots'
import { ModelsPage } from './components/models-page'

export const navItems: NavItem[] = [
  { id: 'models', label: 'Models', icon: 'Cpu', href: '/models', order: 70 },
]

registerSlot('page:/models', ModelsPage)
