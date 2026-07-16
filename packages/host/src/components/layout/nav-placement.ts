// Pure sidebar organization kept router/Lucide-free for cheap, isolated tests.
import type { NavItem, NavSection } from '@makinbakin/sdk'

export type SidebarSectionId = NavSection | 'mix-ins'

export interface SidebarNavSection {
  id: SidebarSectionId
  label: string
  items: NavItem[]
}

export interface SidebarNavModel {
  primary: NavItem[]
  sections: SidebarNavSection[]
}

const PRIMARY_IDS = ['chat', 'tasks'] as const
const RESERVED_IDS = new Set<string>([...PRIMARY_IDS, 'explore'])

const SECTION_DEFINITIONS: ReadonlyArray<{ id: SidebarSectionId; label: string }> = [
  { id: 'plan-and-automate', label: 'Plan & Automate' },
  { id: 'create', label: 'Create' },
  { id: 'operations', label: 'Operations' },
  { id: 'mix-ins', label: 'Mix-ins' },
]

const DEFINED_SECTIONS = new Set<NavSection>(['plan-and-automate', 'create', 'operations'])

const OFFICIAL_ORDER: Readonly<Record<NavSection, readonly string[]>> = {
  'plan-and-automate': ['projects', 'schedule', 'workflows'],
  create: ['brands', 'assets', 'messaging'],
  operations: ['health', 'team', 'models', 'memory'],
}

function compareText(a: string, b: string): number {
  const normalizedA = a.trim().toLowerCase()
  const normalizedB = b.trim().toLowerCase()
  if (normalizedA < normalizedB) return -1
  if (normalizedA > normalizedB) return 1
  return 0
}

function compareCustomItems(a: NavItem, b: NavItem): number {
  const orderDelta = (a.order ?? 100) - (b.order ?? 100)
  if (orderDelta !== 0) return orderDelta
  const labelDelta = compareText(a.label, b.label)
  if (labelDelta !== 0) return labelDelta
  return compareText(a.id, b.id)
}

function sortSectionItems(sectionId: SidebarSectionId, items: readonly NavItem[]): NavItem[] {
  if (sectionId === 'mix-ins') return [...items].sort(compareCustomItems)

  const officialRanks = new Map(OFFICIAL_ORDER[sectionId].map((id, index) => [id, index]))
  const official: NavItem[] = []
  const custom: NavItem[] = []
  for (const item of items) {
    if (officialRanks.has(item.id)) official.push(item)
    else custom.push(item)
  }
  official.sort((a, b) => officialRanks.get(a.id)! - officialRanks.get(b.id)!)
  custom.sort(compareCustomItems)
  return [...official, ...custom]
}

function sectionFor(item: NavItem): SidebarSectionId {
  return item.section && DEFINED_SECTIONS.has(item.section) ? item.section : 'mix-ins'
}

/** Build the host-owned sidebar story from the flat plugin registry snapshot. */
export function buildSidebarNavModel(items: readonly NavItem[]): SidebarNavModel {
  const primary = PRIMARY_IDS.flatMap((id) => {
    const item = items.find((candidate) => candidate.id === id)
    return item ? [item] : []
  })

  const bySection = new Map<SidebarSectionId, NavItem[]>()
  for (const item of items) {
    if (RESERVED_IDS.has(item.id)) continue
    const sectionId = sectionFor(item)
    const sectionItems = bySection.get(sectionId) ?? []
    sectionItems.push(item)
    bySection.set(sectionId, sectionItems)
  }

  const sections = SECTION_DEFINITIONS.flatMap(({ id, label }) => {
    const sectionItems = bySection.get(id) ?? []
    if (sectionItems.length === 0) return []
    return [{ id, label, items: sortSectionItems(id, sectionItems) }]
  })

  return { primary, sections }
}
