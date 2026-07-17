#!/usr/bin/env bun

export const REQUIRED_PAGE_ARCHETYPES = [
  'list-index',
  'detail',
  'settings-form',
  'dashboard-overview',
  'conversation',
  'inspector',
  'workflow-action',
] as const

export type PageArchetype = (typeof REQUIRED_PAGE_ARCHETYPES)[number]
export type BaselineOwner = 'core' | 'bits'
export type BaselineViewport = 'desktop' | 'mobile'

export interface BaselineScenario {
  id: string
  archetype: PageArchetype
  owner: BaselineOwner
  route: string
  ready: string
  viewports: readonly BaselineViewport[]
}

export interface SourceFile {
  path: string
  source: string
}

interface StyleViolationReport {
  totals: Record<string, number>
  byPath: Record<string, Record<string, number>>
}

const STYLE_DEBT_RULES = [
  { id: 'arbitrary-value', pattern: /(?:^|[\s"'])(?:-?[a-z]+:)*-?[a-z]+-\[[^\]]+\]/g },
  { id: 'inline-style', pattern: /\bstyle\s*=\s*\{\{/g },
  { id: 'native-control', pattern: /<(?:button|input|select|textarea)\b/g },
  {
    id: 'raw-color',
    pattern: /#[0-9a-fA-F]{3,8}\b|(?:^|[\s"'])(?:[a-z]+:)*(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
] as const

function matchCount(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length
}

export function countStyleViolations(files: readonly SourceFile[]): StyleViolationReport {
  const totals = Object.fromEntries(STYLE_DEBT_RULES.map((rule) => [rule.id, 0]))
  const byPath: Record<string, Record<string, number>> = {}

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const counts: Record<string, number> = {}
    for (const rule of STYLE_DEBT_RULES) {
      const count = matchCount(file.source, rule.pattern)
      if (count === 0) continue
      counts[rule.id] = count
      totals[rule.id] += count
    }
    if (Object.keys(counts).length > 0) byPath[file.path] = counts
  }

  return { totals, byPath }
}

export function validateBaselineScenarios(scenarios: readonly BaselineScenario[]): string[] {
  const errors: string[] = []
  const seenIds = new Set<string>()

  for (const scenario of scenarios) {
    if (seenIds.has(scenario.id)) errors.push(`duplicate scenario id "${scenario.id}"`)
    seenIds.add(scenario.id)

    if (!scenario.route.startsWith('/') || scenario.route.startsWith('//') || scenario.route.includes('://')) {
      errors.push(`scenario "${scenario.id}" route must be a root-relative application path`)
    }
  }

  for (const archetype of REQUIRED_PAGE_ARCHETYPES) {
    const matching = scenarios.filter((scenario) => scenario.archetype === archetype)
    for (const viewport of ['desktop', 'mobile'] as const) {
      if (!matching.some((scenario) => scenario.viewports.includes(viewport))) {
        errors.push(`archetype "${archetype}" is missing ${viewport} coverage`)
      }
    }
  }

  if (!scenarios.some((scenario) => scenario.owner === 'bits')) {
    errors.push('at least one official Bits scenario is required')
  }

  return errors
}

const UNIX_MACHINE_PATH = /^\/(?:Users|home|private|tmp|var|opt|Volumes)(?:\/|$)/
const WINDOWS_MACHINE_PATH = /^[A-Za-z]:\\/

export function findPortabilityViolations(value: unknown): string[] {
  const violations: string[] = []

  const visit = (current: unknown, keyPath: string): void => {
    if (typeof current === 'string') {
      if (UNIX_MACHINE_PATH.test(current) || WINDOWS_MACHINE_PATH.test(current)) {
        violations.push(`${keyPath} contains an absolute filesystem path`)
      }
      return
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${keyPath}[${index}]`))
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, entry] of Object.entries(current)) {
      visit(entry, keyPath ? `${keyPath}.${key}` : key)
    }
  }

  visit(value, '')
  return violations
}
