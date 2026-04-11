/**
 * Client-side static plugin manifest.
 * No dynamic imports — adding a plugin = adding one import line here.
 */
import { navItems as taskNav } from '../../plugins/tasks/client'
import { navItems as memoryNav } from '../../plugins/memory/client'
import { navItems as workflowsNav } from '../../plugins/workflows/client'
import { navItems as modelsNav } from '../../plugins/models/client'
import { navItems as messagingNav } from '../../plugins/messaging/client'
import { navItems as assetsNav } from '../../plugins/assets/client'
import { navItems as scheduleNav } from '../../plugins/schedule/client'
import { navItems as healthNav } from '../../plugins/health/client'
import { navItems as projectsNav } from '../../plugins/projects/client'
import { navItems as teamNav } from '../../plugins/team/client'
import type { NavItem } from './plugin-types'

export const allNavItems: NavItem[] = [
  ...teamNav,
  ...taskNav,
  ...memoryNav,
  ...modelsNav,
  ...messagingNav,
  ...workflowsNav,
  ...assetsNav,
  ...scheduleNav,
  ...healthNav,
  ...projectsNav,
].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
