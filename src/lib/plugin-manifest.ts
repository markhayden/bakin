/**
 * Client-side static plugin manifest.
 * No dynamic imports — adding a plugin = adding one import line here.
 */
import { navItems as taskNav } from '../../plugins/tasks/client'
import { navItems as memoryNav } from '../../plugins/memory/client'
import { navItems as workflowsNav } from '../../plugins/workflows/client'
import { navItems as modelsNav } from '../../plugins/models/client'
import { navItems as calendarNav } from '../../plugins/calendar/client'
import { navItems as assetsNav } from '../../plugins/assets/client'
import type { NavItem } from './plugin-types'

export const allNavItems: NavItem[] = [
  ...taskNav,
  ...memoryNav,
  ...modelsNav,
  ...calendarNav,
  ...workflowsNav,
  ...assetsNav,
].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
