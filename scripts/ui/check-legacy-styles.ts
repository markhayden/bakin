#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, posix, relative, resolve } from 'node:path'
import Ajv from 'ajv'
import postcss, { type Node, type Rule } from 'postcss'
import ts from 'typescript'

import { externalSourceRoots } from '../docs/source-scan'
import type { CensusDocument, CensusEntry } from './census'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const MIGRATIONS_PATH = join(REPO_ROOT, 'design-system/migrations.json')
const MIGRATIONS_SCHEMA_PATH = join(REPO_ROOT, 'design-system/migrations.schema.json')
const CENSUS_PATH = join(REPO_ROOT, 'design-system/census.json')
const EXCEPTIONS_PATH = join(REPO_ROOT, 'design-system/exceptions.json')

export const LEGACY_STYLE_RULES = [
  'raw-palette',
  'arbitrary-size',
  'raw-control',
  'inline-style',
  'generic-token',
  'unscoped-css',
  'private-import',
] as const

export type LegacyStyleRule = (typeof LEGACY_STYLE_RULES)[number]
export type LegacyStyleCounts = Partial<Record<LegacyStyleRule, number>>

export interface LegacyStyleSource {
  path: string
  repository: 'bakin' | 'bakin-bits-official'
  source: string
}

export interface LegacyStyleReport {
  totals: LegacyStyleCounts
  byPath: Record<string, LegacyStyleCounts>
}

export interface LegacyStyleMigrations {
  schemaVersion: 1
  generatedBy: 'bun run ui:legacy-styles:generate'
  scope: {
    mode: 'official'
    repositories: ['bakin', 'bakin-bits-official']
    compatibilityMatrix: 'design-system/compatibility.json'
  }
  rules: LegacyStyleRule[]
  summary: {
    paths: number
    totals: LegacyStyleCounts
  }
  entries: Array<{
    path: string
    owner: CensusEntry['owner']
    censusEntryId: string
    migrationTask: string
    archetype:
      | 'shell'
      | 'list-index'
      | 'detail'
      | 'settings-form'
      | 'dashboard-overview'
      | 'conversation'
      | 'inspector'
      | 'workflow-action'
      | 'shared-ui'
      | 'plugin-contract'
    target: string
    status: 'legacy-allowed'
    allowances: LegacyStyleCounts
  }>
}

const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules', 'tests', '__tests__'])
const RAW_PALETTE_NAMES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose',
].join('|')
const COLOR_UTILITY_PREFIXES = 'bg|text|border|ring|outline|divide|placeholder|caret|accent|fill|stroke|from|via|to'
const GENERIC_TOKEN_NAMES = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'accent',
  'accent-foreground', 'accent-dim', 'accent-container', 'muted', 'muted-foreground',
  'destructive', 'warning', 'warning-foreground', 'info', 'info-foreground', 'success',
  'success-foreground', 'border', 'outline', 'outline-variant', 'input', 'ring',
  'surface', 'surface-low', 'surface-container', 'surface-high', 'surface-highest',
  'surface-bright', 'surface-elevated', 'selection', 'selection-foreground', 'sidebar',
  'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
  'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring', 'chart-1', 'chart-2',
  'chart-3', 'chart-4', 'chart-5', 'status-backlog', 'status-todo', 'status-in-progress',
  'status-review', 'status-done', 'status-blocked',
]
const GENERIC_TOKEN_PATTERN = GENERIC_TOKEN_NAMES.join('|')

function zeroCounts(): Record<LegacyStyleRule, number> {
  return Object.fromEntries(LEGACY_STYLE_RULES.map((rule) => [rule, 0])) as Record<LegacyStyleRule, number>
}

function matchCount(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length
}

function scriptKind(path: string): ts.ScriptKind {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function sourceFile(file: LegacyStyleSource): ts.SourceFile {
  return ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, scriptKind(file.path))
}

function pluginIdentity(path: string): { root: string; id: string } | null {
  const officialMatch = path.match(/^bakin-bits-official\/plugins\/([^/]+)\//)
  if (officialMatch) return { root: `bakin-bits-official/plugins/${officialMatch[1]}`, id: officialMatch[1] }
  const coreMatch = path.match(/^plugins\/([^/]+)\//)
  if (coreMatch) return { root: `plugins/${coreMatch[1]}`, id: coreMatch[1] }
  if (path.startsWith('examples/reference-plugin/')) {
    return { root: 'examples/reference-plugin', id: 'reference-bookmarks' }
  }
  return null
}

function privateImportCount(file: LegacyStyleSource, parsed: ts.SourceFile): number {
  const plugin = pluginIdentity(file.path)
  if (!plugin) return 0
  let count = 0

  const isPrivate = (specifier: string): boolean => {
    if (specifier.startsWith('@/') || specifier.startsWith('@bakin/')) return true
    if (specifier.startsWith('src/') || specifier.startsWith('packages/')) return true
    if (!specifier.startsWith('.')) return false
    const resolved = posix.normalize(posix.join(posix.dirname(file.path), specifier))
    return resolved !== plugin.root && !resolved.startsWith(`${plugin.root}/`)
  }
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && isPrivate(node.moduleSpecifier.text)
    ) count++
    if (
      ts.isCallExpression(node)
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      )
      && isPrivate(node.arguments[0].text)
    ) count++
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return count
}

function jsxCounts(parsed: ts.SourceFile): Pick<Record<LegacyStyleRule, number>, 'raw-control' | 'inline-style'> {
  let rawControls = 0
  let inlineStyles = 0
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && ['button', 'input', 'select', 'textarea'].includes(node.tagName.text)) {
        rawControls++
      }
      inlineStyles += node.attributes.properties.filter((attribute) => (
        ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === 'style'
      )).length
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return { 'raw-control': rawControls, 'inline-style': inlineStyles }
}

function ruleHasPluginScope(rule: Rule, pluginId: string): boolean {
  const escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const owner = new RegExp(`\\[data-bakin-plugin\\s*=\\s*(?:["']${escapedId}["']|${escapedId})\\]`)
  let current: Node | undefined = rule
  while (current) {
    if (current.type === 'rule' && (current as Rule).selectors.some((selector) => owner.test(selector))) return true
    current = current.parent
  }
  return false
}

function unscopedCssCount(file: LegacyStyleSource): number {
  if (extname(file.path) !== '.css') return 0
  const plugin = pluginIdentity(file.path)
  if (!plugin) return 0
  let count = 0
  const root = postcss.parse(file.source, { from: file.path })
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    if (!ruleHasPluginScope(rule, plugin.id)) count++
  })
  return count
}

function scanSource(file: LegacyStyleSource): Record<LegacyStyleRule, number> {
  const counts = zeroCounts()
  counts['raw-palette'] += matchCount(
    file.source,
    new RegExp(`(?:^|[\\s"'\\x60])(?:[a-z-]+:)*(?:${COLOR_UTILITY_PREFIXES})-(?:${RAW_PALETTE_NAMES})-(?:[1-9]\\d{1,2})(?:\\/\\d+)?(?=$|[\\s"'\\x60}])`, 'gm'),
  )
  counts['raw-palette'] += matchCount(
    file.source,
    new RegExp(`(?:^|[\\s"'\\x60])(?:[a-z-]+:)*(?:${COLOR_UTILITY_PREFIXES})-(?:black|white)(?:\\/\\d+)?(?=$|[\\s"'\\x60}])`, 'gm'),
  )
  counts['raw-palette'] += matchCount(
    file.source,
    /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|#(?=[0-9a-fA-F]{3,4}\b)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,4}\b|\b(?:rgb|hsl)a?\([^)]*\)/g,
  )
  counts['arbitrary-size'] = matchCount(
    file.source,
    /(?:^|[\s"'`])(?:[a-z-]+:)*(?:-?(?:w|h|min-w|max-w|min-h|max-h|size|p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|space-[xy]|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|basis|grid-cols|grid-rows|text|leading|tracking|rounded|border))-\[[^\]]+\](?=$|[\s"'`}])/gm,
  )
  counts['generic-token'] += matchCount(
    file.source,
    new RegExp(`(?:^|[\\s"'\\x60])(?:[a-z-]+:)*(?:${COLOR_UTILITY_PREFIXES})-(?:${GENERIC_TOKEN_PATTERN})(?:\\/\\d+)?(?=$|[\\s"'\\x60}])`, 'gm'),
  )
  counts['generic-token'] += matchCount(
    file.source,
    new RegExp(`--(?:${GENERIC_TOKEN_PATTERN})(?=\\s*[:,)])`, 'g'),
  )
  counts['unscoped-css'] = unscopedCssCount(file)

  if (extname(file.path) === '.ts' || extname(file.path) === '.tsx') {
    const parsed = sourceFile(file)
    Object.assign(counts, jsxCounts(parsed))
    counts['private-import'] = privateImportCount(file, parsed)
  }
  return counts
}

export function scanLegacyStyles(files: readonly LegacyStyleSource[]): LegacyStyleReport {
  const totals = zeroCounts()
  const byPath: Record<string, LegacyStyleCounts> = {}
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const counts = scanSource(file)
    const nonzero = Object.fromEntries(
      LEGACY_STYLE_RULES.flatMap((rule) => counts[rule] > 0 ? [[rule, counts[rule]]] : []),
    ) as LegacyStyleCounts
    if (Object.keys(nonzero).length === 0) continue
    byPath[file.path] = nonzero
    for (const rule of LEGACY_STYLE_RULES) totals[rule] += counts[rule]
  }
  return { totals, byPath }
}

function walkFiles(root: string, include: (path: string) => boolean): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && include(path)) files.push(path)
    }
  }
  visit(root)
  return files
}

function isTestOrStory(path: string): boolean {
  return /(?:^|\/)(?:tests|__tests__)(?:\/|$)|\.(?:test|spec|stories)\.[^.]+$/.test(path)
}

function hostBrowserSource(path: string): boolean {
  if (isTestOrStory(path)) return false
  if (path.endsWith('.tsx') || path.endsWith('.css')) return !path.includes('/api/')
  return path.endsWith('.ts') && /\/(?:components|providers|routes|plugin-host)\//.test(path)
}

function sharedBrowserSource(path: string): boolean {
  return !isTestOrStory(path) && ['.css', '.ts', '.tsx'].includes(extname(path))
}

function pluginBrowserSource(path: string): boolean {
  if (isTestOrStory(path)) return false
  if (path.endsWith('.tsx') || path.endsWith('.css')) return true
  if (!path.endsWith('.ts')) return false
  if (path.includes('/components/')) return true
  if (/\/client\.ts$/.test(path)) return true
  return /(?:^|\/)plugins\/[^/]+\/(?:constants|colors|styles|theme)\.ts$/.test(path)
}

function portablePath(root: string, path: string, prefix = ''): string {
  const suffix = relative(root, path).split('\\').join('/')
  return prefix ? `${prefix}/${suffix}` : suffix
}

export function collectLegacyStyleSources(root: string, bitsPluginsRoot: string): LegacyStyleSource[] {
  if (!existsSync(bitsPluginsRoot)) {
    throw new Error(
      'Official Bits plugins input is unavailable. Use BAKIN_DOCS_EXTERNAL_SOURCES or clone bakin-bits-official beside Bakin.',
    )
  }
  const coreRoots = [
    { path: join(root, 'packages/host/src'), include: hostBrowserSource },
    { path: join(root, 'packages/sdk/src'), include: sharedBrowserSource },
    { path: join(root, 'src/components'), include: sharedBrowserSource },
    { path: join(root, 'plugins'), include: pluginBrowserSource },
    { path: join(root, 'examples/reference-plugin'), include: pluginBrowserSource },
  ]
  const sources: LegacyStyleSource[] = coreRoots.flatMap((sourceRoot) => (
    walkFiles(sourceRoot.path, sourceRoot.include).map((path) => ({
      path: portablePath(root, path),
      repository: 'bakin' as const,
      source: readFileSync(path, 'utf-8'),
    }))
  ))
  sources.push(...walkFiles(bitsPluginsRoot, pluginBrowserSource).map((path) => ({
    path: portablePath(bitsPluginsRoot, path, 'bakin-bits-official/plugins'),
    repository: 'bakin-bits-official' as const,
    source: readFileSync(path, 'utf-8'),
  })))
  return sources.sort((left, right) => left.path.localeCompare(right.path))
}

export interface LegacyStyleExceptionDocument {
  schemaVersion: 1
  policy: string
  exceptions: Array<{
    id: string
    scope: string[]
    allowances?: Record<string, LegacyStyleCounts>
  }>
}

/**
 * Approved deviations are validated against their RECORDED scope — never
 * ignored wholesale. Each exception may pin per-path, per-rule finding counts
 * (`allowances`); the scanner subtracts exactly those counts before the
 * migrations ratchet applies. A finding above the recorded count is new debt;
 * a recorded count above the actual findings is a stale exception and fails,
 * so the ledger can only tell the truth.
 */
export function applyLegacyStyleExceptions(
  report: LegacyStyleReport,
  document: LegacyStyleExceptionDocument,
): { remaining: LegacyStyleReport; excepted: number; errors: string[] } {
  const errors: string[] = []
  const exceptedByPath = new Map<string, Map<LegacyStyleRule, { count: number; ids: Set<string> }>>()

  for (const exception of document.exceptions ?? []) {
    if (!exception.allowances) continue
    for (const [path, counts] of Object.entries(exception.allowances)) {
      if (!exception.scope?.includes(path)) {
        errors.push(`exception ${exception.id} records allowances for a path outside its scope: ${path}`)
        continue
      }
      for (const [rule, count] of Object.entries(counts) as Array<[LegacyStyleRule, number]>) {
        if (!LEGACY_STYLE_RULES.includes(rule)) {
          errors.push(`exception ${exception.id} records an unknown legacy-style rule "${rule}" for ${path}`)
          continue
        }
        if (!Number.isInteger(count) || count <= 0) {
          errors.push(`exception ${exception.id} records a non-positive allowance for ${path} ${rule}`)
          continue
        }
        const byRule = exceptedByPath.get(path) ?? new Map()
        const entry = byRule.get(rule) ?? { count: 0, ids: new Set<string>() }
        entry.count += count
        entry.ids.add(exception.id)
        byRule.set(rule, entry)
        exceptedByPath.set(path, byRule)
      }
    }
  }

  const remainingByPath: Record<string, LegacyStyleCounts> = {}
  const remainingTotals = zeroCounts()
  let excepted = 0
  const consumedPaths = new Set<string>()

  for (const [path, counts] of Object.entries(report.byPath)) {
    consumedPaths.add(path)
    const byRule = exceptedByPath.get(path)
    const remaining: LegacyStyleCounts = {}
    for (const rule of LEGACY_STYLE_RULES) {
      const actual = counts[rule] ?? 0
      const allowance = byRule?.get(rule)
      const covered = allowance?.count ?? 0
      if (covered > actual) {
        errors.push(
          `stale exception allowance: ${path} ${rule} records ${covered} but only ${actual} remain `
          + `(${[...(allowance?.ids ?? [])].sort().join(', ')}); update design-system/exceptions.json`,
        )
      }
      excepted += Math.min(covered, actual)
      const left = actual - Math.min(covered, actual)
      if (left > 0) {
        remaining[rule] = left
        remainingTotals[rule] += left
      }
    }
    if (Object.keys(remaining).length > 0) remainingByPath[path] = remaining
  }

  for (const [path, byRule] of exceptedByPath) {
    if (consumedPaths.has(path)) continue
    for (const [rule, allowance] of byRule) {
      errors.push(
        `stale exception allowance: ${path} ${rule} records ${allowance.count} but the scanner finds none `
        + `(${[...allowance.ids].sort().join(', ')}); update design-system/exceptions.json`,
      )
    }
  }

  return { remaining: { totals: remainingTotals, byPath: remainingByPath }, excepted, errors }
}

function readLegacyStyleExceptions(): LegacyStyleExceptionDocument {
  if (!existsSync(EXCEPTIONS_PATH)) {
    return { schemaVersion: 1, policy: '', exceptions: [] }
  }
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf-8')) as LegacyStyleExceptionDocument
}

export function diffLegacyStyleReport(
  migrations: LegacyStyleMigrations,
  actual: LegacyStyleReport,
): string[] {
  const expectedByPath = new Map(migrations.entries.map((entry) => [entry.path, entry.allowances]))
  const errors: string[] = []
  for (const path of Object.keys(actual.byPath).sort()) {
    const expected = expectedByPath.get(path) ?? {}
    for (const rule of LEGACY_STYLE_RULES) {
      const actualCount = actual.byPath[path][rule] ?? 0
      if (actualCount === 0) continue
      const allowedCount = expected[rule]
      if (allowedCount === undefined) errors.push(`new legacy style debt: ${path} ${rule} (${actualCount})`)
      else if (actualCount > allowedCount) {
        errors.push(`legacy style debt increased: ${path} ${rule} ${allowedCount} -> ${actualCount}`)
      }
    }
  }
  return errors
}

interface MigrationMetadata {
  migrationTask: string
  archetype: LegacyStyleMigrations['entries'][number]['archetype']
  target: string
}

const PLUGIN_MIGRATIONS: Record<string, MigrationMetadata> = {
  assets: { migrationTask: 'T50-T51', archetype: 'detail', target: 'asset list/detail archetypes and supported SDK UI' },
  brands: { migrationTask: 'T52-T53', archetype: 'detail', target: 'brand list/detail/form archetypes and supported SDK UI' },
  chat: { migrationTask: 'T63-T64', archetype: 'conversation', target: 'canonical conversation patterns and supported SDK UI' },
  explore: { migrationTask: 'T54', archetype: 'list-index', target: 'catalog archetype and supported SDK UI' },
  health: { migrationTask: 'T61-T62', archetype: 'dashboard-overview', target: 'diagnostic dashboard archetypes and semantic data visualization' },
  memory: { migrationTask: 'T59', archetype: 'list-index', target: 'search/list/detail archetypes and supported SDK UI' },
  messaging: { migrationTask: 'T67-T68', archetype: 'conversation', target: 'official Messaging archetypes and supported SDK UI' },
  models: { migrationTask: 'T60', archetype: 'list-index', target: 'catalog/settings archetypes and supported SDK UI' },
  projects: { migrationTask: 'T69-T70', archetype: 'detail', target: 'official Projects list/detail/form archetypes and supported SDK UI' },
  schedule: { migrationTask: 'T55-T56', archetype: 'list-index', target: 'schedule list/calendar/form archetypes and supported SDK UI' },
  tasks: { migrationTask: 'T48-T49', archetype: 'workflow-action', target: 'task board/detail archetypes and supported SDK UI' },
  team: { migrationTask: 'T57-T58', archetype: 'detail', target: 'team/agent list/detail/form archetypes and supported SDK UI' },
  workflows: { migrationTask: 'T65-T66', archetype: 'workflow-action', target: 'workflow pages/canvas archetypes and supported SDK UI' },
  _template: { migrationTask: 'T42b', archetype: 'plugin-contract', target: 'official plugin template using only public SDK UI and scoped CSS' },
  'reference-bookmarks': { migrationTask: 'T42a', archetype: 'plugin-contract', target: 'reference plugin using only public SDK UI and scoped CSS' },
}

function metadataForPath(path: string): MigrationMetadata {
  const plugin = pluginIdentity(path)
  if (plugin) return PLUGIN_MIGRATIONS[plugin.id] ?? {
    migrationTask: 'T71a',
    archetype: 'plugin-contract',
    target: 'audited plugin contribution using supported SDK UI',
  }
  if (path.includes('/conversation/')) {
    return { migrationTask: 'T34', archetype: 'conversation', target: 'canonical conversation patterns and focused SDK entrypoint' }
  }
  if (path.includes('/runtime/')) {
    return { migrationTask: 'T46b', archetype: 'settings-form', target: 'runtime settings archetype and supported SDK UI' }
  }
  if (path.includes('/search/')) {
    return { migrationTask: 'T45a', archetype: 'list-index', target: 'canonical global-search overlay and supported SDK UI' }
  }
  if (path.includes('/layout/') || path.endsWith('/globals.css')) {
    return { migrationTask: 'T44', archetype: 'shell', target: 'canonical shell layout and namespaced semantic tokens' }
  }
  if (path.startsWith('packages/sdk/') || path.startsWith('src/components/')) {
    return { migrationTask: 'T21-T35', archetype: 'shared-ui', target: 'focused SDK primitive/pattern and namespaced semantic tokens' }
  }
  return { migrationTask: 'T47', archetype: 'shell', target: 'supported host UI and namespaced semantic tokens' }
}

function ownerForPath(path: string): CensusEntry['owner'] {
  const plugin = pluginIdentity(path)
  if (plugin) {
    return {
      repository: path.startsWith('bakin-bits-official/') ? 'bakin-bits-official' : 'bakin',
      area: 'plugin',
      pluginId: plugin.id,
    }
  }
  if (path.startsWith('packages/host/')) return { repository: 'bakin', area: 'host' }
  return { repository: 'bakin', area: 'sdk' }
}

function censusEntryForPath(path: string, census: CensusDocument): CensusEntry | undefined {
  const exact = census.entries.filter((entry) => entry.sourcePath === path).sort((a, b) => a.id.localeCompare(b.id))
  if (exact.length > 0) return exact.find((entry) => entry.kind === 'shared-component') ?? exact[0]
  const plugin = pluginIdentity(path)
  if (plugin) {
    if (plugin.id === 'reference-bookmarks') {
      return census.entries.find((entry) => entry.id === 'plugin-template:reference-plugin')
    }
    const candidates = census.entries.filter((entry) => (
      entry.owner.pluginId === plugin.id
      && entry.classification !== 'non-visual-alias'
      && (entry.kind === 'plugin-route' || entry.kind === 'plugin-slot' || entry.kind === 'plugin-template')
    )).sort((a, b) => a.id.localeCompare(b.id))
    if (basename(path).toLowerCase().includes('badge')) {
      const badgeSurface = candidates.find((entry) => entry.identity.slot === 'nav-badge-providers')
      if (badgeSurface) return badgeSurface
    }
    const officialSurfaceHints: Array<[RegExp, string]> = [
      [/^bakin-bits-official\/plugins\/messaging\/components\/brainstorm-view\.tsx$/, 'plugin-route:messaging:/messaging/brainstorm'],
      [/^bakin-bits-official\/plugins\/messaging\/components\/content-calendar\.tsx$/, 'plugin-route:messaging:/messaging/calendar'],
      [/^bakin-bits-official\/plugins\/messaging\/(?:components\/(?:deliverable-drawer|plan-list|plan-workspace|quick-post-button)\.tsx|constants\.ts)$/, 'plugin-route:messaging:/messaging/plans'],
      [/^bakin-bits-official\/plugins\/projects\/components\/(?:project-checklist|project-detail|project-status-badge)\.tsx$/, 'plugin-route:projects:/projects/[id]'],
      [/^bakin-bits-official\/plugins\/projects\/(?:client\.tsx|components\/(?:new-project-dialog|project-card|project-grid)\.tsx)$/, 'plugin-route:projects:/projects'],
    ]
    const hintedId = officialSurfaceHints.find(([pattern]) => pattern.test(path))?.[1]
    if (hintedId) return candidates.find((entry) => entry.id === hintedId)
    return candidates.find((entry) => entry.identity.route) ?? candidates[0]
  }
  if (path.startsWith('src/components/')) {
    const directory = `${posix.dirname(path)}/`
    return census.entries.find((entry) => entry.kind === 'shared-component' && entry.sourcePath.startsWith(directory))
  }
  if (path.includes('/runtime/')) return census.entries.find((entry) => entry.id === 'host-route:runtime')
  if (path.includes('/search/')) return census.entries.find((entry) => entry.id === 'host-route:__root')
  return census.entries.find((entry) => entry.id === 'host-route:__root')
}

export function buildLegacyStyleMigrations(
  census: CensusDocument,
  report: LegacyStyleReport,
): LegacyStyleMigrations {
  const entries = Object.entries(report.byPath).sort(([left], [right]) => left.localeCompare(right)).map(([path, allowances]) => {
    const censusEntry = censusEntryForPath(path, census)
    if (!censusEntry) throw new Error(`Legacy style path has no census surface: ${path}`)
    return {
      path,
      owner: ownerForPath(path),
      censusEntryId: censusEntry.id,
      ...metadataForPath(path),
      status: 'legacy-allowed' as const,
      allowances,
    }
  })
  const totals = zeroCounts()
  for (const entry of entries) {
    for (const rule of LEGACY_STYLE_RULES) totals[rule] += entry.allowances[rule] ?? 0
  }
  return {
    schemaVersion: 1,
    generatedBy: 'bun run ui:legacy-styles:generate',
    scope: {
      mode: 'official',
      repositories: ['bakin', 'bakin-bits-official'],
      compatibilityMatrix: 'design-system/compatibility.json',
    },
    rules: [...LEGACY_STYLE_RULES],
    summary: { paths: entries.length, totals },
    entries,
  }
}

export function validateLegacyStyleMigrations(
  migrations: LegacyStyleMigrations,
  census: CensusDocument,
): string[] {
  const errors: string[] = []
  const censusIds = new Set(census.entries.map((entry) => entry.id))
  const paths = new Set<string>()
  let previousPath = ''
  for (const entry of migrations.entries) {
    if (paths.has(entry.path)) errors.push(`duplicate legacy style path: ${entry.path}`)
    paths.add(entry.path)
    if (previousPath && previousPath.localeCompare(entry.path) > 0) errors.push(`legacy style entries are not sorted at: ${entry.path}`)
    previousPath = entry.path
    if (!censusIds.has(entry.censusEntryId)) errors.push(`${entry.path} references unknown census entry ${entry.censusEntryId}`)
    const censusEntry = census.entries.find((candidate) => candidate.id === entry.censusEntryId)
    if (censusEntry && censusEntry.owner.repository !== entry.owner.repository) {
      errors.push(`${entry.path} owner does not match census entry ${entry.censusEntryId}`)
    }
    if (
      censusEntry?.owner.pluginId
      && entry.owner.pluginId
      && censusEntry.owner.pluginId !== entry.owner.pluginId
    ) errors.push(`${entry.path} plugin owner does not match census entry ${entry.censusEntryId}`)
    if (!/^T\d+(?:[a-z])?(?:-T?\d+(?:[a-z])?)?$/.test(entry.migrationTask)) {
      errors.push(`${entry.path} has invalid migration task ${entry.migrationTask}`)
    }
    if (Object.values(entry.allowances).some((count) => !Number.isInteger(count) || count! <= 0)) {
      errors.push(`${entry.path} has a non-positive legacy allowance`)
    }
  }
  const rebuilt = buildLegacyStyleMigrations(census, {
    totals: migrations.summary.totals,
    byPath: Object.fromEntries(migrations.entries.map((entry) => [entry.path, entry.allowances])),
  })
  if (JSON.stringify(rebuilt.summary) !== JSON.stringify(migrations.summary)) {
    errors.push('legacy style summary does not match allowances')
  }
  return errors
}

function officialBitsPluginsRoot(): string {
  for (const root of externalSourceRoots()) {
    const candidates = [root, join(root, 'plugins')]
    for (const candidate of candidates) {
      if (['messaging', 'projects', '_template'].every((plugin) => existsSync(join(candidate, plugin, 'bakin-plugin.json')))) {
        return candidate
      }
    }
  }
  throw new Error(
    'Official Bits plugins input is unavailable. Use the existing BAKIN_DOCS_EXTERNAL_SOURCES plugins root or clone bakin-bits-official beside Bakin.',
  )
}

function readCensus(): CensusDocument {
  if (!existsSync(CENSUS_PATH)) throw new Error('Missing design-system/census.json; run bun run ui:census:generate')
  return JSON.parse(readFileSync(CENSUS_PATH, 'utf-8')) as CensusDocument
}

function validateAgainstSchema(value: unknown): string[] {
  const schema = JSON.parse(readFileSync(MIGRATIONS_SCHEMA_PATH, 'utf-8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (validate(value)) return []
  return (validate.errors ?? []).map((error) => `${error.instancePath || '<root>'} ${error.message}`)
}

function generate(): void {
  const census = readCensus()
  const scanned = scanLegacyStyles(collectLegacyStyleSources(REPO_ROOT, officialBitsPluginsRoot()))
  const applied = applyLegacyStyleExceptions(scanned, readLegacyStyleExceptions())
  if (applied.errors.length > 0) {
    throw new Error(`Invalid legacy-style exception coverage:\n- ${applied.errors.join('\n- ')}`)
  }
  const migrations = buildLegacyStyleMigrations(census, applied.remaining)
  const errors = [...validateLegacyStyleMigrations(migrations, census), ...validateAgainstSchema(migrations)]
  if (errors.length > 0) throw new Error(`Invalid generated legacy-style ratchet:\n- ${errors.join('\n- ')}`)
  mkdirSync(dirname(MIGRATIONS_PATH), { recursive: true })
  writeFileSync(MIGRATIONS_PATH, `${JSON.stringify(migrations, null, 2)}\n`)
  console.log(
    `Generated ${relative(REPO_ROOT, MIGRATIONS_PATH)} with ${migrations.entries.length} path allowances `
    + `(${applied.excepted} findings covered by approved exceptions)`,
  )
}

function check(): void {
  if (!existsSync(MIGRATIONS_PATH)) {
    throw new Error('Missing design-system/migrations.json; run bun run ui:legacy-styles:generate')
  }
  const migrations = JSON.parse(readFileSync(MIGRATIONS_PATH, 'utf-8')) as LegacyStyleMigrations
  const census = readCensus()
  const scanned = scanLegacyStyles(collectLegacyStyleSources(REPO_ROOT, officialBitsPluginsRoot()))
  const applied = applyLegacyStyleExceptions(scanned, readLegacyStyleExceptions())
  const errors = [
    ...applied.errors,
    ...validateLegacyStyleMigrations(migrations, census),
    ...validateAgainstSchema(migrations),
    ...diffLegacyStyleReport(migrations, applied.remaining),
  ]
  if (errors.length > 0) throw new Error(`Legacy UI style ratchet failed:\n- ${[...new Set(errors)].join('\n- ')}`)
  console.log(
    `Legacy UI style ratchet valid: ${migrations.entries.length} paths; `
    + `${applied.excepted} findings covered by approved exceptions; no new or increased debt`,
  )
}

function main(): void {
  const command = process.argv[2]
  if (process.argv.length > 3 || (command !== 'generate' && command !== 'check')) {
    throw new Error('Usage: bun run scripts/ui/check-legacy-styles.ts <generate|check>')
  }
  if (command === 'generate') generate()
  else check()
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
