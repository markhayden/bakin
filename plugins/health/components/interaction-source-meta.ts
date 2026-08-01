import { Bot, Braces, Wrench, type LucideIcon } from 'lucide-react'
import type { InteractionCategory, UsageKind } from '../types'

export interface InteractionSourceMeta {
  label: 'Tools' | 'API' | 'Agents'
  icon: LucideIcon
  iconColorClass: string
}

/**
 * Canonical presentation for the three kinds of Bakin interaction. Source
 * identity is carried by the label and icon; chart colors come from the chart
 * kit's palette assignment, and destructive red stays reserved for failures.
 */
export const INTERACTION_SOURCE_META: Readonly<Record<UsageKind, InteractionSourceMeta>> = {
  mcp: {
    label: 'Tools',
    icon: Wrench,
    iconColorClass: 'text-bakin-text-muted',
  },
  rest: {
    label: 'API',
    icon: Braces,
    iconColorClass: 'text-bakin-text-muted',
  },
  agent: {
    label: 'Agents',
    icon: Bot,
    iconColorClass: 'text-bakin-text-muted',
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
