import { Bot, Braces, Wrench, type LucideIcon } from 'lucide-react'
import type { InteractionCategory, UsageKind } from '../types'

export interface InteractionSourceMeta {
  label: 'Tools' | 'API' | 'Agents'
  icon: LucideIcon
  iconColorClass: string
  backgroundClass: string
  barColor: string
}

/**
 * Canonical presentation for the three kinds of Bakin interaction.
 * Source colors describe where a call went; destructive red is layered on
 * separately wherever a call failed.
 */
export const INTERACTION_SOURCE_META: Readonly<Record<UsageKind, InteractionSourceMeta>> = {
  mcp: {
    label: 'Tools',
    icon: Wrench,
    iconColorClass: 'text-chart-1',
    backgroundClass: 'bg-chart-1',
    barColor: 'var(--chart-1)',
  },
  rest: {
    label: 'API',
    icon: Braces,
    iconColorClass: 'text-chart-2',
    backgroundClass: 'bg-chart-2',
    barColor: 'var(--chart-2)',
  },
  agent: {
    label: 'Agents',
    icon: Bot,
    iconColorClass: 'text-chart-3',
    backgroundClass: 'bg-chart-3',
    barColor: 'var(--chart-3)',
  },
}

const INTERACTION_CATEGORY_KIND: Readonly<Record<InteractionCategory, UsageKind>> = {
  tools: 'mcp',
  api: 'rest',
  agents: 'agent',
}

export function interactionCategoryMeta(category: InteractionCategory): InteractionSourceMeta {
  return INTERACTION_SOURCE_META[INTERACTION_CATEGORY_KIND[category]]
}
