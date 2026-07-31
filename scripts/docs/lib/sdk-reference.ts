/**
 * Docs generator — SDK reference.
 *
 * Walks the @makinbakin/sdk barrel files with the TypeScript compiler API to
 * extract exported symbols + JSDoc, then renders the per-subpath SDK reference
 * page (sdk.md). Owns the core-type / hook / domain grouping tables and the
 * coverage warnings. readSdkExports is also consumed by the coverage report.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as ts from 'typescript'
import { relativeSource } from '../source-scan'
import { escapeMd, generatedPageNote } from './doc-utils'

const repoRoot = new URL('../../..', import.meta.url).pathname

export interface SdkSymbol {
  name: string
  kind: 'function' | 'type' | 'interface' | 'const' | 'enum' | 'class' | 'variable'
  jsdoc: string
  members?: SdkMember[]
  /** Optional generated-reference group for a symbol resolved from a star-exported leaf. */
  docGroup?: string
}

export interface SdkMember {
  name: string
  type: string
  jsdoc: string
  optional: boolean
}

export interface SdkSubpath {
  importPath: string
  source: string
  symbols: SdkSymbol[]
}

const CORE_TYPES = new Set([
  'BakinPlugin',
  'PluginContext',
  'PluginManifest',
  'ExecToolDefinition',
  'PluginToolContext',
  'NavItem',
  'APIRoute',
  'PluginSettingsSchema',
  'BakinConfig',
  'PluginContributions',
])

const HOOKS_GROUPS: Record<string, string> = {
  useAssets: 'Data & State',
  useTrash: 'Data & State',
  useContentStore: 'Data & State',
  useScheduleJobs: 'Data & State',
  useRunHistory: 'Data & State',
  ScheduleJob: 'Data & State',
  RunEntry: 'Data & State',
  useSearch: 'Search',
  reorderBySearchResults: 'Search',
  SearchResult: 'Search',
  SearchResponse: 'Search',
  UseSearchOptions: 'Search',
  UseSearchReturn: 'Search',
  useQueryState: 'Navigation & URL',
  useQueryArrayState: 'Navigation & URL',
  useRouter: 'Navigation & URL',
  usePathname: 'Navigation & URL',
  useSearchParams: 'Navigation & URL',
  useParams: 'Navigation & URL',
  useSidebar: 'Navigation & URL',
  useAgentStore: 'Agent Data',
  useAgent: 'Agent Data',
  useAgentList: 'Agent Data',
  useAgentColor: 'Agent Data',
  useAgentDisplayName: 'Agent Data',
  useAgentIds: 'Agent Data',
  useMainAgentId: 'Agent Data',
  usePackageState: 'Agent Data',
  hexToMuted: 'Agent Data',
  useNotificationChannels: 'Notification Channels',
  getChannelLabel: 'Notification Channels',
  getChannelInitials: 'Notification Channels',
  useDebug: 'UI Controls',
  useFormGuard: 'UI Controls',
  useVerticalResize: 'UI Controls',
  toast: 'UI Controls',
  useToastStore: 'UI Controls',
  useRuntimeStatus: 'Runtime',
  useSSE: 'Runtime',
}

const TYPE_DOMAIN_GROUPS: Record<string, string> = {
  // Shared primitives
  HttpMethod: 'Shared Primitives',
  ContractVisibility: 'Shared Primitives',
  ContractStability: 'Shared Primitives',
  SchemaLike: 'Shared Primitives',
  SourceLocation: 'Shared Primitives',
  DocsExample: 'Shared Primitives',
  // Manifest
  PluginPermission: 'Manifest Contracts',
  RuntimeCapability: 'Manifest Contracts',
  SecretDeclaration: 'Manifest Contracts',
  ApiRouteContribution: 'Manifest Contracts',
  JsonSchemaContribution: 'Manifest Contracts',
  ApiParameterContribution: 'Manifest Contracts',
  ApiRequestBodyContribution: 'Manifest Contracts',
  ApiResponseContribution: 'Manifest Contracts',
  ClientRouteContribution: 'Manifest Contracts',
  ExecToolContribution: 'Manifest Contracts',
  CliCommandContribution: 'Manifest Contracts',
  SettingsContribution: 'Manifest Contracts',
  DocsContribution: 'Manifest Contracts',
  PluginManifestSignature: 'Manifest Contracts',
  // Storage / Events
  StorageStat: 'Storage & Events',
  StorageAdapter: 'Storage & Events',
  EventBus: 'Storage & Events',
  ActivityAPI: 'Storage & Events',
  PluginLogger: 'Storage & Events',
  HookAPI: 'Storage & Events',
  HookRegistrationMetadata: 'Storage & Events',
  HookKind: 'Storage & Events',
  // Navigation & routes (NavItem/APIRoute are core, handled separately)
  UISlotRegistration: 'UI & Navigation',
  ContentFile: 'UI & Navigation',
  NavBadge: 'UI & Navigation',
  NavBadgeTone: 'UI & Navigation',
  // Runtime
  RuntimeAgent: 'Runtime',
  RuntimeChannel: 'Runtime',
  RuntimeMessageToolsMode: 'Runtime',
  RuntimeMessageToolPolicy: 'Runtime',
  RuntimeMessageArgs: 'Runtime',
  RuntimeMessageResult: 'Runtime',
  RuntimeToolActivity: 'Runtime',
  RuntimeChatChunk: 'Runtime',
  CronJob: 'Runtime',
  CronRun: 'Runtime',
  RuntimeSkill: 'Runtime',
  WorkspaceFile: 'Runtime',
  AgentRuntimeAdapter: 'Runtime',
  // Tasks
  TaskLogEntry: 'Tasks',
  Task: 'Tasks',
  TaskSource: 'Tasks',
  TaskColumns: 'Tasks',
  TaskBoard: 'Tasks',
  ColumnId: 'Tasks',
  TaskCreateInput: 'Tasks',
  TaskUpdateInput: 'Tasks',
  TaskService: 'Tasks',
  // Search
  SearchSchemaField: 'Search',
  SearchIndexDefinition: 'Search',
  SearchContentTypeDefinition: 'Search',
  FilePatternMapper: 'Search',
  FileBackedContentTypeDefinition: 'Search',
  SearchQueryParams: 'Search',
  SearchResult: 'Search',
  SearchResponse: 'Search',
  SearchHealthSnapshot: 'Search',
  SearchTransformOp: 'Search',
  SearchAPI: 'Search',
  // Assets
  AssetTypeName: 'Assets',
  AssetSummary: 'Assets',
  AssetGenerationInfo: 'Assets',
  AssetCreateInput: 'Assets',
  AssetVersionCreateInput: 'Assets',
  AssetExportRequest: 'Assets',
  VersionedAssetRef: 'Assets',
  AssetVersionFileRef: 'Assets',
  AssetsAPI: 'Assets',
  // Exec tools / Skills / Workflows / Health
  ExecToolResult: 'Exec Tools & Workflows',
  SkillDefinition: 'Exec Tools & Workflows',
  WorkflowLayoutInput: 'Exec Tools & Workflows',
  WorkflowDefinitionInput: 'Exec Tools & Workflows',
  FormFieldType: 'Exec Tools & Workflows',
  FormField: 'Exec Tools & Workflows',
  EdgeRules: 'Exec Tools & Workflows',
  PluginNodeTypeInput: 'Exec Tools & Workflows',
  PluginNotificationChannelInput: 'Exec Tools & Workflows',
  // Health
  HealthRepairSafety: 'Health',
  HealthRepairChange: 'Health',
  HealthRepairPlanItem: 'Health',
  HealthRepairApplyResult: 'Health',
  // Settings
  StringSettingsField: 'Settings',
  NumberSettingsField: 'Settings',
  BooleanSettingsField: 'Settings',
  SelectSettingsField: 'Settings',
  ListSettingsField: 'Settings',
  SettingsField: 'Settings',
  // Misc domain types
  CalendarEvent: 'Calendar & Memory',
  CalendarDay: 'Calendar & Memory',
  RecurringEvent: 'Calendar & Memory',
  MemoryEntry: 'Calendar & Memory',
  MemoryDay: 'Calendar & Memory',
  Heartbeat: 'Calendar & Memory',
  ProjectMeta: 'Projects & Models',
  AvailableModel: 'Projects & Models',
  WorkflowDefinition: 'Workflows',
  WorkflowInstance: 'Workflows',
  WorkflowStep: 'Workflows',
  WorkflowTemplate: 'Workflows',
  PluginEntry: 'Configuration',
}

export function readSdkExports(): SdkSubpath[] {
  const pkgPath = join(repoRoot, 'packages/sdk/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, string> }

  const subpathSources: Array<{ subpath: string; importPath: string; sourcePath: string }> = []
  for (const [subpath, source] of Object.entries(pkg.exports)) {
    // Host-shell plumbing, not author API — deliberately absent from the
    // generated SDK reference (see packages/sdk/src/internal/index.ts).
    if (subpath === './internal') continue
    const importPath = subpath === '.' ? '@makinbakin/sdk' : `@makinbakin/sdk${subpath.slice(1)}`
    const sourcePath = join(repoRoot, 'packages/sdk', source.replace(/^\.\//, ''))
    subpathSources.push({ subpath, importPath, sourcePath })
  }

  const program = ts.createProgram({
    rootNames: subpathSources.map((s) => s.sourcePath),
    options: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      allowJs: false,
      baseUrl: repoRoot,
      paths: {
        '@/*': ['src/*'],
        '@bakin/*': ['packages/*'],
      },
    },
  })

  // Binds the program so node.getSourceFile()/getText() resolve while walking
  // declarations below. The checker value itself is unused — only this side
  // effect matters — so it is not threaded through the extract helpers.
  program.getTypeChecker()
  const result: SdkSubpath[] = []

  for (const { importPath, sourcePath } of subpathSources) {
    const sourceFile = program.getSourceFile(sourcePath)
    if (!sourceFile) {
      result.push({ importPath, source: relativeSource(sourcePath), symbols: [] })
      continue
    }
    const symbols = extractSdkSymbols(sourceFile)
    // `@makinbakin/sdk/types` intentionally uses `export *`. Resolve only the
    // canonical Health leaf here so the changed public contract is visible
    // without turning this generator into a general module resolver.
    if (importPath === '@makinbakin/sdk/types') {
      const healthSource = program.getSourceFile(join(dirname(sourcePath), 'health.ts'))
      if (healthSource) {
        const known = new Set(symbols.map(symbol => symbol.name))
        for (const symbol of extractSdkSymbols(healthSource, 'Health')) {
          if (!known.has(symbol.name)) symbols.push(symbol)
        }
      }
    }
    result.push({ importPath, source: relativeSource(sourcePath), symbols })
  }
  return result
}

function jsdocTextOf(node: ts.Node): string {
  const tags = ts.getJSDocCommentsAndTags(node)
  for (const tag of tags) {
    if (ts.isJSDoc(tag)) {
      const c = tag.comment
      if (typeof c === 'string' && c.trim()) return c.trim().split(/\r?\n/)[0]
      if (Array.isArray(c) && c.length > 0) {
        const first = c[0]
        const text = typeof first === 'string' ? first : ('text' in first ? first.text : '')
        if (text.trim()) return text.trim().split(/\r?\n/)[0]
      }
    }
  }
  return ''
}

function extractSdkSymbols(sourceFile: ts.SourceFile, docGroup?: string): SdkSymbol[] {
  const symbols: SdkSymbol[] = []

  ts.forEachChild(sourceFile, (node) => {
    // ExportDeclaration is its own syntax kind, not modifier-flagged.
    // All other declarations need the `export` modifier to count.
    const isReExport = ts.isExportDeclaration(node)
    if (!isReExport && !hasExportModifier(node)) return

    // export interface Foo { ... }
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text
      const sym: SdkSymbol = {
        name,
        kind: 'interface',
        jsdoc: jsdocTextOf(node),
      }
      if (CORE_TYPES.has(name)) {
        sym.members = extractInterfaceMembers(node)
      }
      symbols.push(sym)
      return
    }

    // export type Foo = ...
    if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({
        name: node.name.text,
        kind: 'type',
        jsdoc: jsdocTextOf(node),
      })
      return
    }

    // export function foo(...) {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        kind: 'function',
        jsdoc: jsdocTextOf(node),
      })
      return
    }

    // export class Foo {}
    if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        kind: 'class',
        jsdoc: jsdocTextOf(node),
      })
      return
    }

    // export enum Foo {}
    if (ts.isEnumDeclaration(node)) {
      symbols.push({
        name: node.name.text,
        kind: 'enum',
        jsdoc: jsdocTextOf(node),
      })
      return
    }

    // export const foo = ...
    if (ts.isVariableStatement(node)) {
      const jsdoc = jsdocTextOf(node)
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({
            name: decl.name.text,
            kind: 'const',
            jsdoc,
          })
        }
      }
      return
    }

    // export { foo, bar } from '...' or export { foo, bar }
    if (ts.isExportDeclaration(node)) {
      const jsdoc = jsdocTextOf(node)
      const isTypeOnly = node.isTypeOnly
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          symbols.push({
            name: spec.name.text,
            kind: isTypeOnly ? 'type' : inferKindFromName(spec.name.text),
            jsdoc,
          })
        }
      }
      // export * from '...' — handled by checker.getExportsOfModule at the consumer level
      // For our purposes (root index.ts has `export * from './types'`), we skip these
      // and rely on the types subpath rendering directly.
      return
    }
  })

  return docGroup ? symbols.map(symbol => ({ ...symbol, docGroup })) : symbols
}

function hasExportModifier(node: ts.Node): boolean {
  if (!('modifiers' in node) || !node.modifiers) return false
  const mods = node.modifiers as ts.NodeArray<ts.ModifierLike>
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function inferKindFromName(name: string): SdkSymbol['kind'] {
  // Convention: PascalCase names are types/components, lowercase are functions/hooks/consts.
  if (/^[A-Z]/.test(name)) {
    // React component name OR a type — treat as variable (we'll display as "Component")
    // For re-export {} blocks, type-only is already detected via isTypeOnly upstream.
    return 'variable'
  }
  return 'function'
}

function extractInterfaceMembers(node: ts.InterfaceDeclaration): SdkMember[] {
  const members: SdkMember[] = []
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue
    if (!member.name) continue

    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
      ? (member.name as ts.Identifier | ts.StringLiteral).text
      : member.name.getText()
    const jsdoc = jsdocTextOf(member)
    const optional = !!member.questionToken
    let typeText = ''

    if (ts.isPropertySignature(member) && member.type) {
      typeText = member.type.getText(node.getSourceFile())
    } else if (ts.isMethodSignature(member)) {
      // Render method signature as a brief shape
      const params = member.parameters
        .map((p) => p.getText(node.getSourceFile()))
        .join(', ')
      const ret = member.type ? member.type.getText(node.getSourceFile()) : 'void'
      typeText = `(${params}) => ${ret}`
    }

    // Compress whitespace
    typeText = typeText.replace(/\s+/g, ' ').trim()

    members.push({ name, type: typeText, jsdoc, optional })
  }
  return members
}

export function renderSdkReference(): string {
  const subpaths = readSdkExports()
  const lines: string[] = [
    '---',
    'title: SDK Reference',
    'description: Public API surface of @makinbakin/sdk — hooks, components, types, and utilities for plugin authors.',
    '---',
    '',
    'The Bakin SDK is a single package with multiple subpaths. Plugin authors mark `@makinbakin/sdk` (and `react`/`react-dom`) as externals at build time; the host serves a single shared instance at runtime.',
    '',
    '```ts',
    "import { registerPlugin } from '@makinbakin/sdk'",
    "import { useSearch } from '@makinbakin/sdk/hooks'",
    "import { Button } from '@makinbakin/sdk/ui'",
    "import type { BakinPlugin, PluginContext } from '@makinbakin/sdk/types'",
    '```',
    '',
  ]

  const bySubpath = new Map<string, SdkSubpath>()
  for (const sp of subpaths) bySubpath.set(sp.importPath, sp)

  // Main entry
  renderMainSubpath(lines, bySubpath.get('@makinbakin/sdk'))
  // Hooks
  renderHooks(lines, bySubpath.get('@makinbakin/sdk/hooks'))
  // UI
  renderUi(lines, bySubpath.get('@makinbakin/sdk/ui'))
  // Focused visual boundaries (populated by their owned migration tasks)
  renderFocusedVisualEntrypoint(lines, bySubpath.get('@makinbakin/sdk/layout'), 'Canonical page and responsive composition.')
  renderFocusedVisualEntrypoint(lines, bySubpath.get('@makinbakin/sdk/patterns'), 'Reusable application-aware presentation patterns.')
  renderFocusedVisualEntrypoint(lines, bySubpath.get('@makinbakin/sdk/charts'), 'Isolated data-visualization components and contracts.')
  renderFocusedVisualEntrypoint(lines, bySubpath.get('@makinbakin/sdk/conversation'), 'Isolated conversation UI and models.')
  renderFocusedVisualEntrypoint(lines, bySubpath.get('@makinbakin/sdk/content'), 'Opt-in rich content rendering and editing.')
  // Slots
  renderSimpleTable(lines, bySubpath.get('@makinbakin/sdk/slots'), 'Slot system')
  // Types (special case: core types + domain grouping)
  renderTypes(lines, bySubpath.get('@makinbakin/sdk/types'))
  // Utils
  renderSimpleTable(lines, bySubpath.get('@makinbakin/sdk/utils'), 'Utility')
  // Metadata
  renderSimpleTable(lines, bySubpath.get('@makinbakin/sdk/metadata'), 'Contract helper')
  // Routing
  renderSimpleTable(lines, bySubpath.get('@makinbakin/sdk/routing'), 'Routing')
  // Browser navigation
  renderSimpleTable(lines, bySubpath.get('@makinbakin/sdk/navigation'), 'Browser navigation')

  validateSdkCoverage(subpaths)

  lines.push(generatedPageNote(), '')
  return lines.join('\n')
}

function renderMainSubpath(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk`', '')
  lines.push(`The main entry. Re-exports the plugin contract types (\`./types\`) plus the high-traffic plugin lifecycle helpers (\`registerPlugin\`, \`defineRoute\`, \`definePlugin\`). Source: \`${sp.source}\`.`, '')
  const filtered = sp.symbols.filter((s) => !TYPE_DOMAIN_GROUPS[s.name] && !CORE_TYPES.has(s.name))
  if (filtered.length === 0) return
  lines.push('| Export | Description |')
  lines.push('| --- | --- |')
  for (const sym of filtered) {
    lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
  }
  lines.push('')
}

function renderHooks(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk/hooks`', '')
  lines.push(`Source: \`${sp.source}\`.`, '')
  lines.push('```ts')
  lines.push("import { useSearch, useDebug } from '@makinbakin/sdk/hooks'")
  lines.push('```', '')

  const groups = new Map<string, SdkSymbol[]>()
  const ungrouped: SdkSymbol[] = []
  for (const sym of sp.symbols) {
    const group = HOOKS_GROUPS[sym.name]
    if (group) {
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push(sym)
    } else {
      ungrouped.push(sym)
    }
  }

  const groupOrder = ['Data & State', 'Search', 'Navigation & URL', 'Agent Data', 'Notification Channels', 'UI Controls', 'Runtime']
  for (const groupName of groupOrder) {
    const groupSyms = groups.get(groupName)
    if (!groupSyms || groupSyms.length === 0) continue
    lines.push(`### ${groupName}`, '')
    lines.push('| Hook | Description |')
    lines.push('| --- | --- |')
    for (const sym of groupSyms) {
      lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
    }
    lines.push('')
  }

  if (ungrouped.length > 0) {
    lines.push('### Other', '')
    lines.push('| Hook | Description |')
    lines.push('| --- | --- |')
    for (const sym of ungrouped) {
      lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
    }
    lines.push('')
  }
}

function renderFocusedVisualEntrypoint(
  lines: string[],
  sp: SdkSubpath | undefined,
  description: string,
): void {
  if (!sp) return
  lines.push(`## \`${sp.importPath}\``, '')
  lines.push(`${description} Source: \`${sp.source}\`.`, '')
  if (sp.symbols.length === 0) {
    lines.push('The boundary is established; public exports arrive with its owned component migration.', '')
    return
  }
  lines.push('| Export | Description |')
  lines.push('| --- | --- |')
  for (const sym of sp.symbols) lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
  lines.push('')
}

function renderUi(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk/ui`', '')
  lines.push(`Source: \`${sp.source}\`. Supported Bakin primitives backed by the canonical design-system stylesheet. Use semantic props and the [UI style guide](/docs/extending/ui/) rather than relying on upstream-library APIs or arbitrary utility classes.`, '')
  lines.push('```ts')
  lines.push("import { Alert, Badge, Button, Progress } from '@makinbakin/sdk/ui'")
  lines.push('```', '')
  if (sp.symbols.length > 0) {
    const names = sp.symbols.map((s) => `\`${s.name}\``).join(', ')
    lines.push(`Available: ${names}.`, '')
  }
}

function renderSimpleTable(lines: string[], sp: SdkSubpath | undefined, colHeader: string): void {
  if (!sp) return
  lines.push(`## \`${sp.importPath}\``, '')
  lines.push(`Source: \`${sp.source}\`.`, '')
  if (sp.symbols.length === 0) {
    lines.push('No direct exports detected.', '')
    return
  }
  lines.push(`| ${colHeader} | Description |`)
  lines.push('| --- | --- |')
  for (const sym of sp.symbols) {
    lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
  }
  lines.push('')
}

function renderTypes(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk/types`', '')
  lines.push(`Source: \`${sp.source}\`. The full plugin contract surface. Below: detailed field-level docs for the types most plugin authors directly implement, then summary tables grouped by domain.`, '')
  lines.push('```ts')
  lines.push("import type { BakinPlugin, PluginContext, ExecToolDefinition } from '@makinbakin/sdk/types'")
  lines.push('```', '')

  // Core types — detailed
  lines.push('### Core types (full field docs)', '')
  const coreOrder = [
    'BakinPlugin',
    'PluginContext',
    'PluginManifest',
    'PluginContributions',
    'ExecToolDefinition',
    'PluginToolContext',
    'NavItem',
    'APIRoute',
    'PluginSettingsSchema',
    'BakinConfig',
  ]
  for (const name of coreOrder) {
    const sym = sp.symbols.find((s) => s.name === name)
    if (!sym) continue
    lines.push(`#### \`${sym.name}\``, '')
    if (sym.jsdoc) lines.push(sym.jsdoc, '')
    if (sym.members && sym.members.length > 0) {
      lines.push('| Field | Type | Description |')
      lines.push('| --- | --- | --- |')
      for (const m of sym.members) {
        const fieldName = m.optional ? `\`${m.name}?\`` : `\`${m.name}\``
        lines.push(`| ${fieldName} | \`${escapeMd(m.type)}\` | ${escapeMd(m.jsdoc || '—')} |`)
      }
      lines.push('')
    }
  }

  // Domain-grouped summary tables
  const groups = new Map<string, SdkSymbol[]>()
  for (const sym of sp.symbols) {
    if (CORE_TYPES.has(sym.name)) continue
    const group = sym.docGroup || TYPE_DOMAIN_GROUPS[sym.name] || 'Other'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(sym)
  }

  const groupOrder = [
    'Shared Primitives',
    'Manifest Contracts',
    'Storage & Events',
    'UI & Navigation',
    'Runtime',
    'Tasks',
    'Search',
    'Assets',
    'Exec Tools & Workflows',
    'Health',
    'Settings',
    'Workflows',
    'Calendar & Memory',
    'Projects & Models',
    'Configuration',
    'Other',
  ]
  for (const groupName of groupOrder) {
    const groupSyms = groups.get(groupName)
    if (!groupSyms || groupSyms.length === 0) continue
    lines.push(`### ${groupName}`, '')
    lines.push('| Type | Description |')
    lines.push('| --- | --- |')
    for (const sym of groupSyms) {
      lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
    }
    lines.push('')
  }
}

function validateSdkCoverage(subpaths: SdkSubpath[]): void {
  const missingJsdoc: string[] = []
  const missingCoreMembers: string[] = []
  const missingTypeGroup: string[] = []

  for (const sp of subpaths) {
    // UI subpath: shadcn re-exports rendered as compact list, no JSDoc required.
    if (sp.importPath === '@makinbakin/sdk/ui') continue

    for (const sym of sp.symbols) {
      // Block re-exports (`export type { A, B, C } from '...'`) share one JSDoc
      // tag at the block level. We only flag missing JSDoc on subpaths that
      // render in the docs as their own rows; type-only sub-symbols inside
      // a re-export block don't get individual descriptions today.
      if (!sym.jsdoc && sym.kind !== 'type') {
        missingJsdoc.push(`${sp.importPath}: ${sym.name}`)
      }
      // Core type member validation only applies on the canonical types subpath
      // — re-exports from other subpaths don't carry the interface body.
      if (sp.importPath === '@makinbakin/sdk/types' && CORE_TYPES.has(sym.name)) {
        if (!sym.members || sym.members.length === 0) {
          missingCoreMembers.push(sym.name)
        } else {
          for (const m of sym.members) {
            if (!m.jsdoc) missingCoreMembers.push(`${sym.name}.${m.name}`)
          }
        }
      }
      if (sp.importPath === '@makinbakin/sdk/types' && !CORE_TYPES.has(sym.name) && !sym.docGroup && !TYPE_DOMAIN_GROUPS[sym.name]) {
        missingTypeGroup.push(sym.name)
      }
    }
  }

  if (missingJsdoc.length > 0) {
    console.warn(`[sdk-coverage] ${missingJsdoc.length} export(s) missing JSDoc:`)
    for (const item of missingJsdoc) console.warn(`  - ${item}`)
  }
  if (missingCoreMembers.length > 0) {
    console.warn(`[sdk-coverage] ${missingCoreMembers.length} core-type member(s) missing JSDoc:`)
    for (const item of missingCoreMembers) console.warn(`  - ${item}`)
  }
  if (missingTypeGroup.length > 0) {
    console.warn(`[sdk-coverage] ${missingTypeGroup.length} type(s) missing TYPE_DOMAIN_GROUPS entry:`)
    for (const item of missingTypeGroup) console.warn(`  - ${item}`)
  }
}
