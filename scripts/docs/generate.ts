import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as ts from 'typescript'
import {
  extractExecTools,
  extractPluginSettings,
  getApiRoutes,
  getCliCommands,
  externalSourceRoots,
  listPluginManifests,
  relativeSource,
  renderExecToolsSnippet,
  sourceFiles,
} from './source-scan'
import type { ApiRouteContribution } from './source-scan'
import { dirname, join } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import { getAllRoutes } from '../../src/core/api-docs'
import type { RouteDoc } from '../../src/core/api-docs'
import { PERMISSION_DESCRIPTIONS, PermissionSchema } from '../../packages/core/src/plugins/permissions'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'docs')
const generatedRoot = join(docsRoot, '.generated')
const docsOrigin = 'https://makinbakin.com'
const docsBasePath = '/docs'
const docsUrl = `${docsOrigin}${docsBasePath}`
const llmBundleFiles = [
  'llms.txt',
  'llms-full.txt',
  'llms/plugin-authoring.md',
  'llms/agent-authoring.md',
  'llms/sdk-reference.md',
  'llms/api.md',
  'llms/cli.md',
  'llms/hooks.md',
  'llms/exec-tools.md',
  'llms/core-plugins.md',
  'llms/settings.md',
]
const docsSnippetFiles = [
  'snippets/plugin-basic/bakin-plugin.json',
  'snippets/plugin-basic/index.ts',
  'snippets/plugin-basic/client.tsx',
  'snippets/agent-package-basic/bakin-package.json',
]
const publicSlotNames = [
  'asset-preview',
  'asset-detail-modal',
  'task-assets',
  'task-sidebar',
  'home-widget',
  'page:/<route>',
]
const commandSnippets = {
  tasks: ['tasks list', 'tasks create', 'tasks move', 'tasks log', 'tasks block', 'tasks depend', 'tasks complete'],
  workflows: ['workflows list', 'workflows start', 'workflows step', 'workflows submit'],
  health: ['doctor', 'status'],
  schedule: ['schedule'],
}
const cliQuickLinks: Record<string, string> = {
  start: 'bakin start',
  onboard: 'bakin onboard',
  doctor: 'bakin doctor',
  'tasks list': 'bakin tasks list',
  'tasks create': 'bakin tasks create <title>',
  'plugins install': 'bakin plugins install <source>',
  search: 'bakin search <query>',
}
const docsSnippetBlocks = {
  'plugin-basic-manifest': {
    file: 'snippets/plugin-basic/bakin-plugin.json',
    language: 'json',
  },
  'plugin-basic-server': {
    file: 'snippets/plugin-basic/index.ts',
    language: 'ts',
  },
  'plugin-basic-client': {
    file: 'snippets/plugin-basic/client.tsx',
    language: 'tsx',
  },
  'agent-package-basic-manifest': {
    file: 'snippets/agent-package-basic/bakin-package.json',
    language: 'json',
  },
} satisfies Record<string, { file: string; language: string }>

function writeStableFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const stableContents = path.includes('/docs/src/content/docs/')
    ? contents.replace(/^(---\n[\s\S]*?\n---\n\n)# [^\n]+\n\n/, '$1')
    : contents
  writeFileSync(path, stableContents.trimEnd() + '\n', 'utf8')
}

function docsPath(path: string): string {
  return `${docsBasePath}${path.startsWith('/') ? path : `/${path}`}`
}

function renderCommandSnippet(marker: string): string {
  // 1. Manifest-first: plugins that declare contributes.cliCommands win.
  const manifestCommands = getCliCommands(marker)
  if (manifestCommands.length) {
    const lines = [
      `<!-- docs:cli-commands ${marker} -->`,
      '| Command | Purpose |',
      '| --- | --- |',
    ]
    for (const command of manifestCommands) {
      lines.push(`| \`${command.usage.replace(/\|/g, '\\|')}\` | ${command.summary} |`)
    }
    lines.push('<!-- /docs:cli-commands -->')
    return lines.join('\n')
  }

  // 2. Legacy hardcoded grouping for in-repo plugins that haven't backfilled.
  const names = commandSnippets[marker as keyof typeof commandSnippets]
  if (!names) throw new Error(`Unknown CLI command snippet: ${marker}`)

  const byName = new Map(CLI_COMMANDS.map(command => [command.name, command]))
  const lines = [
    `<!-- docs:cli-commands ${marker} -->`,
    '| Command | Purpose |',
    '| --- | --- |',
  ]

  for (const name of names) {
    const command = byName.get(name)
    if (!command) throw new Error(`Missing CLI command for docs snippet "${marker}": ${name}`)
    lines.push(`| \`${command.usage.replace(/\|/g, '\\|')}\` | ${command.summary} |`)
  }

  lines.push('<!-- /docs:cli-commands -->')
  return lines.join('\n')
}

function renderApiRoutesSnippet(marker: string): string {
  const routes = getApiRoutes(marker)
  if (!routes.length) throw new Error(`No api-routes for marker: ${marker}`)
  const lines = [
    `<!-- docs:api-routes ${marker} -->`,
    '| Method | Path | Purpose |',
    '| --- | --- | --- |',
  ]
  for (const route of routes) {
    lines.push(`| \`${route.method}\` | \`${route.path}\` | ${route.summary} |`)
  }
  lines.push('<!-- /docs:api-routes -->')
  return lines.join('\n')
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function renderSettingsSnippet(marker: string): string {
  const fields = extractPluginSettings(marker)
  if (!fields.length) throw new Error(`No settings for marker: ${marker}`)
  const lines = [
    `<!-- docs:settings ${marker} -->`,
    '<div class="settings-table">',
    '',
    '| Setting | Type | Default | What it does |',
    '| --- | --- | --- | --- |',
  ]
  for (const field of fields) {
    const name = escapeTableCell(field.label || field.key)
    const type = `\`${field.type}\``
    const def = field.default ? `\`${escapeTableCell(field.default)}\`` : ''
    const desc = escapeTableCell(field.description || '')
    lines.push(`| ${name} | ${type} | ${def} | ${desc} |`)
  }
  lines.push('')
  lines.push('</div>')
  lines.push('<!-- /docs:settings -->')
  return lines.join('\n')
}

function renderPluginPermissionsSnippet(): string {
  const lines = [
    '<!-- docs:plugin-permissions -->',
    '<div class="table-light-full table-label-wrap permissions-table">',
    '',
    '| Permission | Typical use |',
    '| --- | --- |',
  ]
  for (const permission of PermissionSchema.options) {
    lines.push(`| \`${permission}\` | ${escapeTableCell(PERMISSION_DESCRIPTIONS[permission])} |`)
  }
  lines.push('')
  lines.push('</div>')
  lines.push('<!-- /docs:plugin-permissions -->')
  return lines.join('\n')
}

function renderDocsSnippetBlock(marker: string): string {
  const snippet = docsSnippetBlocks[marker as keyof typeof docsSnippetBlocks]
  if (!snippet) throw new Error(`Unknown docs snippet block: ${marker}`)

  const sourcePath = join(docsRoot, snippet.file)
  const contents = readFileSync(sourcePath, 'utf8').trimEnd()
  return [
    `<!-- docs:snippet ${marker} -->`,
    `Source: \`docs/${snippet.file}\``,
    '',
    `\`\`\`${snippet.language}`,
    contents,
    '```',
    '<!-- /docs:snippet -->',
  ].join('\n')
}

function updateGeneratedContentBlocks(): void {
  const docsContentRoot = join(docsRoot, 'src/content/docs')
  const markdownFiles: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) markdownFiles.push(path)
    }
  }
  walk(docsContentRoot)

  const commandMarkerPattern = /<!-- docs:cli-commands ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:cli-commands -->/g
  const snippetMarkerPattern = /<!-- docs:snippet ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:snippet -->/g
  const execToolsMarkerPattern = /<!-- docs:exec-tools ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:exec-tools -->/g
  const apiRoutesMarkerPattern = /<!-- docs:api-routes ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:api-routes -->/g
  const settingsMarkerPattern = /<!-- docs:settings ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:settings -->/g
  const pluginPermissionsMarkerPattern = /<!-- docs:plugin-permissions -->[\s\S]*?<!-- \/docs:plugin-permissions -->/g
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8')
    const next = text
      .replace(commandMarkerPattern, (_match, marker: string) => renderCommandSnippet(marker))
      .replace(snippetMarkerPattern, (_match, marker: string) => renderDocsSnippetBlock(marker))
      .replace(execToolsMarkerPattern, (_match, marker: string) => renderExecToolsSnippet(marker))
      .replace(apiRoutesMarkerPattern, (_match, marker: string) => renderApiRoutesSnippet(marker))
      .replace(settingsMarkerPattern, (_match, marker: string) => renderSettingsSnippet(marker))
      .replace(pluginPermissionsMarkerPattern, renderPluginPermissionsSnippet())
    if (next !== text) writeStableFile(file, next)
  }
}

type HookRegistrationDoc = {
  name: string
  file: string
  line: number
  label?: string
  summary?: string
  description?: string
  hookKind?: string
  visibility?: string
  stability?: string
}

function extractHookRegistrations(): HookRegistrationDoc[] {
  const hooks: HookRegistrationDoc[] = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/hooks\.register\(['"`]([^'"`]+)['"`]/)
      if (match) {
        const block = lines.slice(i, Math.min(lines.length, i + 45)).join('\n')
        const label = block.match(/label:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2]
        const summary = block.match(/summary:\s*(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/)?.[2]
        const hookKind = block.match(/hookKind:\s*['"`]([^'"`]+)['"`]/)?.[1]
        const visibility = block.match(/visibility:\s*['"`]([^'"`]+)['"`]/)?.[1]
        const stability = block.match(/stability:\s*['"`]([^'"`]+)['"`]/)?.[1]
        hooks.push({
          name: match[1],
          file: relativeSource(file),
          line: i + 1,
          label: label?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').trim(),
          summary: summary?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').trim(),
          hookKind,
          visibility,
          stability,
        })
      }
    }
  }
  return hooks.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

function extractSlotRegistrations(): Array<{ name: string; file: string; line: number }> {
  const slots: Array<{ name: string; file: string; line: number }> = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const direct = lines[i].match(/registerSlot\(['"`]([^'"`]+)['"`]/)
      if (direct) slots.push({ name: direct[1], file: relativeSource(file), line: i + 1 })

      const server = lines[i].match(/slot:\s*['"`]([^'"`]+)['"`]/)
      if (server && lines.slice(Math.max(0, i - 8), i + 8).some(line => line.includes('registerSlot'))) {
        slots.push({ name: server[1], file: relativeSource(file), line: i + 1 })
      }
    }
  }
  const byKey = new Map<string, { name: string; file: string; line: number }>()
  for (const slot of slots) byKey.set(`${slot.name}:${slot.file}:${slot.line}`, slot)
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

interface PluginManifestDoc {
  id: string
  name: string
  version: string
  description?: string
  bakin?: string
  permissions?: string[]
  dependencies?: string[]
  origin: 'Core' | 'Official'
  file: string
}

interface SdkSymbol {
  name: string
  kind: 'function' | 'type' | 'interface' | 'const' | 'enum' | 'class' | 'variable'
  jsdoc: string
  members?: SdkMember[]
}

interface SdkMember {
  name: string
  type: string
  jsdoc: string
  optional: boolean
}

interface SdkSubpath {
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
  'HealthCheckResult',
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
  PluginEntryPoints: 'Manifest Contracts',
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
  AssetVariantMeta: 'Assets',
  AssetGenerationMeta: 'Assets',
  AssetMeta: 'Assets',
  TrashedAssetMeta: 'Assets',
  AssetFileRef: 'Assets',
  AssetSaveInput: 'Assets',
  AssetSaveResult: 'Assets',
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
  HealthRepairHandler: 'Health',
  PluginHealthCheckInput: 'Health',
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

function readPluginManifestDirectory(pluginsDir: string, origin: PluginManifestDoc['origin']): PluginManifestDoc[] {
  const manifests: PluginManifestDoc[] = []
  for (const entry of readdirSync(pluginsDir).sort()) {
    if (entry.startsWith('_')) continue
    const manifestPath = join(pluginsDir, entry, 'bakin-plugin.json')
    try {
      const raw = readFileSync(manifestPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PluginManifestDoc>
      if (!parsed.id || !parsed.name || !parsed.version) continue
      manifests.push({
        id: parsed.id,
        name: parsed.name,
        version: parsed.version,
        description: parsed.description,
        bakin: parsed.bakin,
        permissions: parsed.permissions ?? [],
        dependencies: parsed.dependencies ?? [],
        origin,
        file: relativeSource(manifestPath),
      })
    } catch {
      // Not every directory under plugins/ must be a plugin.
    }
  }
  return manifests
}

function readCorePluginManifests(): PluginManifestDoc[] {
  return readPluginManifestDirectory(join(repoRoot, 'plugins'), 'Core')
}

function readOfficialPluginManifests(): PluginManifestDoc[] {
  const seen = new Set<string>()
  const manifests: PluginManifestDoc[] = []
  for (const root of externalSourceRoots()) {
    for (const manifest of readPluginManifestDirectory(root, 'Official')) {
      if (seen.has(manifest.id)) continue
      seen.add(manifest.id)
      manifests.push(manifest)
    }
  }
  return manifests
}

function readOfficialPluginCatalog(): PluginManifestDoc[] {
  return [...readCorePluginManifests(), ...readOfficialPluginManifests()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function readSdkExports(): SdkSubpath[] {
  const pkgPath = join(repoRoot, 'packages/sdk/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, string> }

  const subpathSources: Array<{ subpath: string; importPath: string; sourcePath: string }> = []
  for (const [subpath, source] of Object.entries(pkg.exports)) {
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

  const checker = program.getTypeChecker()
  const result: SdkSubpath[] = []

  for (const { importPath, sourcePath } of subpathSources) {
    const sourceFile = program.getSourceFile(sourcePath)
    if (!sourceFile) {
      result.push({ importPath, source: relativeSource(sourcePath), symbols: [] })
      continue
    }
    const symbols = extractSdkSymbols(sourceFile, checker)
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

function extractSdkSymbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker): SdkSymbol[] {
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
        sym.members = extractInterfaceMembers(node, checker)
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

  return symbols
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

function extractInterfaceMembers(node: ts.InterfaceDeclaration, checker: ts.TypeChecker): SdkMember[] {
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

function flattenObject(value: unknown, prefix = ''): Array<{ key: string; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ key: prefix, value }]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) return flattenObject(child, next)
    return [{ key: next, value: child }]
  })
}

const versionLine = `Docs version: Bakin ${APP_VERSION}`
function generatedPageNote(): string {
  const generatedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
  return [
    '<aside class="generated-page-note" aria-label="Generated page metadata">',
    `  <span>Generated ${generatedDate} · Bakin ${APP_VERSION}</span>`,
    '</aside>',
  ].filter(Boolean).join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function parseCliUsage(command: CliCommand): Array<{ token: string; displayToken: string; choices: string[]; kind: 'argument' | 'option' | 'choice'; required: boolean; description: string }> {
  const usageParts = command.usage.match(/\[[^\]]+\]|<[^>]+>|\S+/g) ?? []
  const commandWords = ['bakin', ...command.name.split(/\s+/)]
  const parts = usageParts.slice(commandWords.length).filter((token) => token !== '...')

  return parts.flatMap((token) => {
    const required = token.startsWith('<')
    const optional = token.startsWith('[')
    const bracketless = token.replace(/^\[/, '').replace(/\]$/, '')
    const inner = required && bracketless.startsWith('<') && bracketless.endsWith('>')
      ? bracketless.slice(1, -1)
      : bracketless
    const isOption = inner.startsWith('--') || inner.startsWith('-')
    const hasChoice = inner.includes('|')
    const choices = hasChoice ? inner.split('|') : []
    if (optional && choices.length && choices.every(choice => choice.startsWith('--') || choice.startsWith('-'))) {
      return choices.map(choice => ({
        token: `[${choice}]`,
        displayToken: `[${choice}]`,
        choices: [],
        kind: 'option' as const,
        required: false,
        description: describeCliPart(choice, 'option', false),
      }))
    }
    const kind = hasChoice ? 'choice' : isOption ? 'option' : 'argument'
    const description = describeCliPart(inner, kind, required)
    return [{
      token,
      displayToken: kind === 'choice' ? displayCliPartToken(inner, kind, required && !optional, optional) : token,
      choices,
      kind,
      required: required && !optional,
      description,
    }]
  })
}

function displayCliPartToken(token: string, kind: 'argument' | 'option' | 'choice', required: boolean, optional: boolean): string {
  if (kind !== 'choice') return `${optional ? '[' : ''}${required ? '<' : ''}${token}${required ? '>' : ''}${optional ? ']' : ''}`
  const labels: Record<string, string> = {
    'runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all': 'target',
    'search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins': 'component',
    'list|enable|disable': 'action',
    'list|add|pause|resume|remove|run|runs': 'action',
    'list|restore|empty': 'action',
    'path|github:user/repo': 'source',
    'path|github:user/repo[@ref]': 'source',
    'path|github:user/repo[@ref][#subpath]': 'source',
  }
  const label = labels[token] ?? 'value'
  return required ? `<${label}>` : optional ? `[${label}]` : label
}

function describeCliPart(token: string, kind: 'argument' | 'option' | 'choice', required: boolean): string {
  const normalized = token.replace(/[<>[\]]/g, '').replace(/\s+/g, ' ')
  const descriptions: Record<string, string> = {
    id: 'Resource identifier.',
    agent: 'Agent id to assign or target.',
    'agent-id': 'Agent id to install, update, remove, or inspect.',
    title: 'Human-readable title.',
    message: 'Message text.',
    column: 'Task board column.',
    reason: 'Human-readable reason.',
    summary: 'Completion summary.',
    dependsOn: 'Task id this task depends on.',
    taskId: 'Task id.',
    workflowId: 'Workflow definition id.',
    stepId: 'Workflow step id.',
    json: 'JSON payload.',
    key: 'Dot-notation settings key.',
    value: 'Value to write.',
    query: 'Search query.',
    filter: 'Optional log filter.',
    filename: 'Asset trash filename.',
    name: 'Name to create.',
    packageId: 'Package id.',
    'package-id': 'Package id.',
    localPath: 'Local filesystem path.',
    path: 'Local filesystem path.',
    'path|github:user/repo': 'Local path or GitHub source.',
    'path|github:user/repo[@ref]': 'Local path or pinned GitHub source.',
    'path|github:user/repo[@ref][#subpath]': 'Local path or GitHub source, optionally pinned and scoped to a subpath.',
    'runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all': 'Check target.',
    'search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins': 'Install target.',
    'list|enable|disable': 'Lesson action.',
    'list|add|pause|resume|remove|run|runs': 'Schedule action.',
    'list|restore|empty': 'Trash action.',
    '--column=<column>': 'Filter by task column.',
    '--workflow=<id>': 'Attach a workflow by id.',
    '--no-workflow=<reason>': 'Skip workflow matching with a reason.',
    '--packages': 'Show package state instead of the runtime roster.',
    '--adopt': 'Adopt an existing runtime agent.',
    '--install-as <id>': 'Install under a specific id.',
    '--replace': 'Replace an existing install.',
    '--keep-blocks': 'Leave managed blocks on disk.',
    '--delete-agent': 'Delete the runtime agent too.',
    '--force': 'Bypass the normal safety guard.',
    '--refresh-template': 'Refresh generated package template files.',
    '--check': 'Dry-run; report what would change.',
    '--yes': 'Accept all defaults non-interactively.',
    '--json': 'Emit machine-readable output.',
    '--dev': 'Install in local development mode.',
    '--ref <ref>': 'Pin a Git ref.',
    '--table=<name>': 'Limit the operation to one search table.',
    '--rebuild': 'Drop and rebuild indexes.',
    '--agent=<id>': 'Filter by agent id.',
    '--limit=<n>': 'Maximum number of results.',
    '--facets=<list>': 'Comma-separated facet names.',
    '--apply': 'Apply the managed block.',
    '--apply-all': 'Apply managed blocks for all agents.',
    '--check-all': 'Check managed blocks for all agents.',
    '--uninstall': 'Remove the installed service.',
  }
  if (descriptions[normalized]) return descriptions[normalized]
  if (kind === 'choice') return 'Choose one of these values.'
  if (kind === 'option') return normalized.includes(' <') || normalized.includes('=') ? 'Optional flag with a value.' : 'Optional flag.'
  return required ? 'Required value.' : 'Optional value.'
}

function buildCoverageReport(): Record<string, unknown> {
  const routes = getAllRoutes()
  return {
    version: APP_VERSION,
    generatedBy: 'scripts/docs/generate.ts',
    surfaces: {
      cliCommands: {
        status: 'active',
        count: CLI_COMMANDS.length,
        examples: CLI_COMMANDS.reduce((count, command) => count + (command.examples?.length ?? 0), 0),
        source: 'src/core/cli/registry.ts',
      },
      httpRoutes: {
        status: 'active',
        count: routes.length,
        withInputSchema: routes.filter(route => Boolean(route.input)).length,
        withOutputSchema: routes.filter(route => Boolean(route.output)).length,
        withExamples: routes.filter(route => (route.examples?.length ?? 0) > 0).length,
        source: 'src/core/api-docs.ts',
      },
      pluginRoutes: {
        status: 'partial',
        count: routes.filter(route => route.pluginId !== 'core').length,
        source: 'runtime route registration metadata',
      },
      hookRegistrations: {
        status: 'audited',
        count: extractHookRegistrations().length,
        source: 'source scan',
      },
      slots: {
        status: 'documented',
        count: publicSlotNames.length,
        auditedRegistrations: extractSlotRegistrations().length,
        source: 'packages/sdk/src/register.ts and slot source scan',
      },
      execTools: {
        status: 'audited',
        count: extractExecTools().length,
        source: 'source scan',
      },
      corePlugins: {
        status: 'active',
        count: readCorePluginManifests().length,
        source: 'plugins/*/bakin-plugin.json',
      },
      settings: {
        status: 'active',
        count: flattenObject(DEFAULT_SETTINGS).length,
        source: 'packages/core/src/settings.ts',
      },
      sdkSubpaths: {
        status: 'active',
        count: readSdkExports().length,
        source: 'packages/sdk/package.json',
      },
      agentPackageKinds: {
        status: 'active',
        count: 4,
        source: 'packages/core/src/agent-packages/manifest.ts',
      },
      docsSnippets: {
        status: 'active',
        count: docsSnippetFiles.length,
        source: 'docs/snippets',
      },
      llmBundles: {
        status: 'active',
        count: llmBundleFiles.length,
        source: 'scripts/docs/generate.ts',
      },
    },
  }
}

type CliCommand = typeof CLI_COMMANDS[number]

const cliReferenceGroups: Array<{
  title: string
  description: string
  matches(command: CliCommand): boolean
}> = [
  {
    title: 'Lifecycle',
    description: 'Use these commands to run the local server, check whether it is healthy, restart it after configuration changes, and keep the installed CLI current.',
    matches: (command) => ['start', 'stop', 'restart', 'status', 'dev', 'version', 'update', 'setup service'].includes(command.name),
  },
  {
    title: 'First-Time Setup',
    description: 'These commands create the local directories and baseline settings Bakin needs before normal operation. They are most useful on a fresh machine or when repairing a partially configured install.',
    matches: (command) => ['onboard', 'check', 'install', 'mkdir'].includes(command.name),
  },
  {
    title: 'Task Management',
    description: 'Task commands cover the day-to-day board workflow: creating work, changing status, recording notes, expressing dependencies, and sending ready tasks to agents.',
    matches: (command) => command.name === 'dispatch' || command.name.startsWith('tasks '),
  },
  {
    title: 'Workflows',
    description: 'Workflow commands are for guided, multi-step task execution. Use them to discover available flows, start one against a task, advance steps, and submit required inputs.',
    matches: (command) => command.name.startsWith('workflows '),
  },
  {
    title: 'Agents',
    description: 'Use these commands to inspect registered agents, review their status and assignments, and send direct messages without opening the dashboard.',
    matches: (command) => ['agents list', 'agents status', 'agents tasks', 'agents send'].includes(command.name),
  },
  {
    title: 'Agent Packages',
    description: 'Agent package commands install and maintain reusable agent definitions, bundled lessons, prompts, and rules that Bakin manages as local agent state.',
    matches: (command) => ['agents install', 'agents remove', 'agents update', 'agents lessons'].includes(command.name) || command.name.startsWith('packages '),
  },
  {
    title: 'Plugins',
    description: 'Plugin commands manage Bakin extensions from the command line, including installing official packages, linking local development plugins, and scaffolding new plugin projects.',
    matches: (command) => command.name.startsWith('plugins '),
  },
  {
    title: 'Schedule',
    description: 'Use the schedule command to list and manage recurring jobs that create tasks automatically on a configured cadence.',
    matches: (command) => command.name === 'schedule',
  },
  {
    title: 'Search',
    description: 'Search commands query indexed Bakin content, report index health, and rebuild indexes after adapter or data changes.',
    matches: (command) => ['search', 'search:stats', 'reindex'].includes(command.name),
  },
  {
    title: 'Assets',
    description: 'Asset maintenance currently focuses on the trash flow: reviewing soft-deleted assets, restoring them, or purging them permanently.',
    matches: (command) => command.name === 'trash',
  },
  {
    title: 'Settings',
    description: 'Settings commands are the scriptable path for reading, changing, and seeding local configuration values.',
    matches: (command) => command.name.startsWith('settings '),
  },
  {
    title: 'Diagnostics and Paths',
    description: 'Diagnostics commands expose the information needed when something is not behaving as expected: logs, resolved paths, health checks, API docs, and generated agent rules.',
    matches: (command) => ['doctor', 'logs', 'paths', 'docs', 'agent-rules'].includes(command.name),
  },
]

function renderCliCommandBlock(command: CliCommand): string {
  const usageParts = parseCliUsage(command)
  const commandId = command.name.replace(/[^a-z0-9]+/g, '-')
  const commandNotes = [
    command.stability !== 'stable' ? `Stability: <code>${escapeHtml(command.stability)}</code>` : '',
    command.aliases?.length ? `Aliases: ${command.aliases.map(alias => `<code>${escapeHtml(alias)}</code>`).join(' ')}` : '',
  ].filter(Boolean)
  const props = [
    `id="${commandId}"`,
    `name="${escapeHtml(command.name)}"`,
    `summary="${escapeHtml(command.summary)}"`,
    `description="${escapeHtml(command.description)}"`,
  ].join(' ')

  return [
    `<CliCommandCard ${props}>`,
    '```sh frame="terminal"',
    command.usage,
    '```',
    usageParts.length ? [
      '  <table class="cli-command__args">',
      '    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>',
      '    <tbody>',
      ...usageParts.map(part => `      <tr><td><code>${escapeHtml(part.displayToken)}</code>${part.choices.length ? `<span class="cli-command__choices">${part.choices.map(choice => `<span>${escapeHtml(choice)}</span>`).join('')}</span>` : ''}</td><td>${part.kind}</td><td>${part.required ? 'yes' : 'no'}</td><td>${part.description}</td></tr>`),
      '    </tbody>',
      '  </table>',
    ].join('\n') : '',
    commandNotes.length ? `  <p class="cli-command__meta">${commandNotes.join(' · ')}</p>` : '',
    '</CliCommandCard>',
  ].filter(Boolean).join('\n')
}

function renderCliReference(): string {
  const commonCommandNames = ['start', 'onboard', 'doctor', 'tasks list', 'tasks create', 'plugins install', 'search']
  const byName = new Map(CLI_COMMANDS.map(command => [command.name, command]))
  const assigned = new Set<string>()
  const grouped = cliReferenceGroups.map(group => {
    const commands = CLI_COMMANDS.filter(command => group.matches(command))
    for (const command of commands) assigned.add(command.name)
    return { ...group, commands }
  }).filter(group => group.commands.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title))
  const unassigned = CLI_COMMANDS.filter(command => !assigned.has(command.name))
  if (unassigned.length) {
    grouped.push({
      title: 'Other',
      description: 'Commands without a dedicated reference family.',
      matches: () => false,
      commands: unassigned,
    })
  }

  const lines = [
    '---',
	    'title: CLI',
	    'description: Generated reference for public Bakin CLI commands.',
		    '---',
		    '',
    "import CliCommandCard from '../../../../components/CliCommandCard.astro'",
    '',
    '<div class="cli-reference-intro">',
    '  <p>The Bakin CLI is the fastest way to run local setup, check health, manage tasks, install plugins, and script repeatable work. Use it when you want a direct command instead of clicking through the dashboard, or when you need Bakin actions inside shell scripts and automation.</p>',
    '</div>',
    '',
    '## Popular',
    '',
    '<div class="cli-common-grid">',
    ...commonCommandNames.map((name) => {
      const command = byName.get(name)
      if (!command) return ''
      const commandId = command.name.replace(/[^a-z0-9]+/g, '-')
      return [
        `<a class="cli-common-card" href="#${commandId}">`,
        `  <code>${escapeHtml(cliQuickLinks[name] ?? command.usage)}</code>`,
        `  <span>${escapeHtml(command.summary)}</span>`,
        '</a>',
      ].join('\n')
    }).filter(Boolean),
    '</div>',
    '',
		  ]

  for (const group of grouped) {
    lines.push(`## ${group.title}`, '')
    lines.push(`<p class="cli-section-description">${escapeHtml(group.description)}</p>`, '')
    lines.push('<div class="cli-command-list">')
    for (const command of group.commands) {
      lines.push(renderCliCommandBlock(command))
    }
    lines.push('</div>', '')
		  }
		  lines.push(generatedPageNote(), '')

	  return lines.join('\n')
	}

type OpenApiSchema = Record<string, unknown>
type OpenApiOperation = Record<string, unknown>

function methodOrder(method: string): number {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].indexOf(method)
}

function tagOrder(tag: string): string {
  return tag === 'Core' ? '00 Core' : `10 ${tag}`
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function operationIdFor(scope: string, method: string, path: string): string {
  const slug = path
    .replace(/^\/+/, '')
    .replace(/:([A-Za-z0-9_]+)/g, 'by-$1')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return [scope, method.toLowerCase(), slug || 'root']
    .join('-')
    .replace(/-+/g, '-')
}

function pathParameters(path: string, declared: ApiRouteContribution['parameters'] = []): NonNullable<ApiRouteContribution['parameters']> {
  const declaredByName = new Map(declared.map(param => [`${param.in}:${param.name}`, param]))
  const params: NonNullable<ApiRouteContribution['parameters']> = []
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    const name = match[1]
    params.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      ...declaredByName.get(`path:${name}`),
    })
  }
  for (const param of declared) {
    if (param.in !== 'path' || !params.some(existing => existing.name === param.name)) {
      params.push(param)
    }
  }
  return params
}

function schemaOrObject(schema: unknown): OpenApiSchema {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) return schema as OpenApiSchema
  return { type: 'object', additionalProperties: true }
}

function schemaForParamHint(hint: string): OpenApiSchema {
  const optional = hint.endsWith('?')
  const normalized = optional ? hint.slice(0, -1) : hint
  if (normalized.includes('|')) {
    return { type: 'string', enum: normalized.split('|').filter(Boolean) }
  }
  if (normalized === 'boolean') return { type: 'boolean' }
  if (normalized === 'number') return { type: 'number' }
  if (normalized === 'integer') return { type: 'integer' }
  if (normalized === 'object') return { type: 'object', additionalProperties: true }
  return { type: 'string' }
}

function schemaFromParamsHint(params?: string): OpenApiSchema | undefined {
  const trimmed = params?.trim()
  if (!trimmed || !trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined

  const properties: Record<string, OpenApiSchema> = {}
  const required: string[] = []
  for (const match of trimmed.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    const [, name, hint] = match
    properties[name] = schemaForParamHint(hint)
    if (!hint.endsWith('?')) required.push(name)
  }
  if (Object.keys(properties).length === 0) return undefined
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function openApiContent(contentType: string, schema: unknown, example?: unknown): Record<string, unknown> {
  const content: Record<string, unknown> = {
    schema: schemaOrObject(schema),
  }
  if (example !== undefined) content.example = example
  return { [contentType]: content }
}

function isGenericObjectSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  const record = schema as Record<string, unknown>
  const properties = record.properties
  return record.type === 'object' &&
    record.additionalProperties === true &&
    (!properties || (typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length === 0))
}

function sampleOpenApiValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'value'
  const record = schema as Record<string, unknown>
  if (record.example !== undefined) return record.example
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0]
  switch (record.type) {
    case 'boolean':
      return true
    case 'integer':
    case 'number':
      return 1
    case 'array':
      return [sampleOpenApiValue(record.items)]
    case 'object': {
      const properties = record.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined
      return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, sampleOpenApiValue(value)]))
    }
    case 'string':
    default:
      return 'value'
  }
}

function firstOpenApiContent(content?: Record<string, { schema?: unknown; example?: unknown }>): { contentType: string; schema?: unknown; example?: unknown } | undefined {
  if (!content) return undefined
  const [contentType, value] = Object.entries(content)[0] ?? []
  if (!contentType || !value) return undefined
  return { contentType, ...value }
}

function curlForOperation(method: string, path: string, operation: OpenApiOperation): string {
  const params = (operation.parameters as Array<{ name: string; in: string }> | undefined) ?? []
  let urlPath = path.replace(/\{([^}]+)\}/g, (_match, name) => `<${name}>`)
  const query = params.filter(param => param.in === 'query')
  if (query.length) {
    urlPath += `?${query.map(param => `${param.name}=<${param.name}>`).join('&')}`
  }
  const lines = ['curl -sS']
  if (method !== 'GET') lines.push(`  -X ${method}`)
  lines.push(`  'http://localhost:3737${urlPath}'`)
  const requestBody = operation.requestBody as { content?: Record<string, { schema?: unknown; example?: unknown }> } | undefined
  const body = firstOpenApiContent(requestBody?.content)
  if (body) {
    if (body.example === undefined && isGenericObjectSchema(body.schema)) return lines.join(' \\\n')
    const sample = body.example ?? sampleOpenApiValue(body.schema)
    if (sample === undefined) return lines.join(' \\\n')
    lines.push(`  -H 'Content-Type: ${body.contentType}'`)
    lines.push(`  --data '${JSON.stringify(sample)}'`)
  }
  return lines.join(' \\\n')
}

function openApiResponses(route: ApiRouteContribution | RouteDoc): Record<string, unknown> {
  const declared = 'responses' in route ? route.responses : undefined
  if (declared && Object.keys(declared).length > 0) {
    return Object.fromEntries(Object.entries(declared).map(([status, response]) => {
      const out: Record<string, unknown> = { description: response.description }
      if (response.schema || response.example !== undefined) {
        out.content = openApiContent(response.contentType ?? 'application/json', response.schema, response.example)
      }
      return [status, out]
    }))
  }
  return {
    200: {
      description: 'Successful response.',
      content: openApiContent('application/json', { type: 'object', additionalProperties: true }),
    },
    default: {
      description: 'Error response.',
      content: openApiContent('application/json', {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
        additionalProperties: true,
      }),
    },
  }
}

function defaultRequestBody(route: ApiRouteContribution | RouteDoc): Record<string, unknown> | undefined {
  if (['GET', 'DELETE'].includes(route.method)) return undefined
  return {
    description: 'JSON request body. See route handler and examples for accepted fields until this route declares a specific request schema.',
    required: true,
    content: openApiContent('application/json', { type: 'object', additionalProperties: true }),
  }
}

function routeOperation(route: ApiRouteContribution | RouteDoc, scope: string, fullPath: string, tag: string): OpenApiOperation {
  const parameters = pathParameters(route.path, 'parameters' in route ? route.parameters : undefined).map(param => {
    const out: Record<string, unknown> = {
      name: param.name,
      in: param.in,
      required: param.in === 'path' ? true : param.required ?? false,
      schema: schemaOrObject(param.schema ?? { type: 'string' }),
    }
    if (param.description) out.description = param.description
    if (param.example !== undefined) out.example = param.example
    return out
  })
  const operation: OpenApiOperation = {
    operationId: ('operationId' in route && route.operationId) ? route.operationId : operationIdFor(scope, route.method, route.path),
    tags: ('tags' in route && route.tags?.length) ? route.tags : [tag],
    summary: route.summary,
    responses: openApiResponses(route),
    'x-bakin-visibility': route.visibility ?? 'public',
    'x-bakin-stability': route.stability ?? 'stable',
  }
  if (route.description) operation.description = route.description
  if (parameters.length) operation.parameters = parameters
  const requestBody = 'requestBody' in route ? route.requestBody : undefined
  if (requestBody) {
    operation.requestBody = {
      description: requestBody.description,
      required: requestBody.required ?? !['GET', 'DELETE'].includes(route.method),
      content: openApiContent(requestBody.contentType ?? 'application/json', requestBody.schema, requestBody.example),
    }
  } else if ('params' in route && route.params && !route.params.startsWith('?')) {
    const paramsSchema = schemaFromParamsHint(route.params)
    operation.requestBody = {
      description: route.params,
      required: !['GET', 'DELETE'].includes(route.method),
      content: openApiContent('application/json', paramsSchema ?? { type: 'object', additionalProperties: true }),
    }
  } else {
    const body = defaultRequestBody(route)
    if (body) operation.requestBody = body
  }
  if (route.permissions?.length) operation.security = [{ pluginPermissions: route.permissions }]
  operation['x-bakin-full-path'] = fullPath
  return operation
}

function allApiDocRoutes(): Array<{ scope: string; tag: string; fullPath: string; route: ApiRouteContribution | RouteDoc; manifestDescription?: string }> {
  const coreRoutes = getAllRoutes()
    .filter(r => r.pluginId === 'core')
    .map(route => ({ scope: 'core', tag: 'Core', fullPath: route.fullPath, route }))
  const pluginRoutes = listPluginManifests()
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap(manifest => getApiRoutes(manifest.id).map(route => ({
      scope: manifest.id,
      tag: manifest.name,
      fullPath: `/api/plugins/${manifest.id}${route.path}`,
      route,
      manifestDescription: manifest.description,
    })))
  return [...coreRoutes, ...pluginRoutes].sort((a, b) =>
    tagOrder(a.tag).localeCompare(tagOrder(b.tag)) ||
    a.fullPath.localeCompare(b.fullPath) ||
    methodOrder(a.route.method) - methodOrder(b.route.method),
  )
}

function _buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, string | undefined>()
  for (const entry of allApiDocRoutes()) {
    tags.set(entry.tag, entry.manifestDescription)
    const path = openApiPath(entry.fullPath)
    paths[path] ??= {}
    paths[path][entry.route.method.toLowerCase()] = routeOperation(entry.route, entry.scope, entry.fullPath, entry.tag)
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Bakin API',
      version: APP_VERSION,
      description: 'Generated OpenAPI contract for Bakin core and official plugin HTTP routes.',
    },
    servers: [
      { url: 'http://localhost:3737', description: 'Local Bakin server' },
    ],
    tags: [...tags.entries()].map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
    paths,
    components: {
      securitySchemes: {
        pluginPermissions: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Bakin-Plugin-Permission',
          description: 'Documents plugin permission requirements. The local runtime currently enforces route access through Bakin plugin registration and runtime policy.',
        },
      },
    },
  }
}

function renderApiReference(groups: Map<string, Array<{ operationId: string; curl: string }>>): string {
  const groupLines = [...groups.keys()]
    .sort((a, b) => tagOrder(a).localeCompare(tagOrder(b)))
    .flatMap(tag => {
      const operations = groups.get(tag) ?? []
      return [
        `## ${tag}`,
        '',
        `<OpenApiReference tag="${escapeHtml(tag)}" summary />`,
        '',
        ...operations.flatMap(operation => [
          `<OpenApiReference operationId="${escapeHtml(operation.operationId)}">`,
          '```sh frame="terminal" showLineNumbers',
          operation.curl,
          '```',
          '</OpenApiReference>',
          '',
        ]),
      ]
    })

  return [
    '---',
    'title: API',
    'description: Generated OpenAPI-backed reference for documented Bakin HTTP API routes.',
    '---',
    '',
    "import OpenApiReference from '../../../../components/OpenApiReference.astro'",
    '',
    '<OpenApiReference intro />',
    '',
    ...groupLines,
    generatedPageNote(),
    '',
  ].join('\n')
}

type HookRegistration = ReturnType<typeof extractHookRegistrations>[number]

const hookGroupDescriptions: Record<string, string> = {
  assets: 'Asset hooks expose file, sidecar, variant, and trash helpers for plugins that need to work with Bakin-managed files.',
  health: 'Health hooks expose registered readiness and diagnostic checks so other surfaces can list or inspect them.',
  models: 'Model hooks expose the effective model configuration and notify dependent surfaces when runtime model state changes.',
  tasks: 'Task hooks let plugins enrich task details and react to task lifecycle changes.',
  team: 'Team hooks expose runtime agent and team metadata for plugins that need agent-aware behavior.',
  workflows: 'Workflow hooks expose workflow definitions, instances, steps, gates, and notification helpers for task automation.',
}

function hookId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function hookNamespace(name: string): string {
  return name.split('.')[0] || 'other'
}

type HookExamplePayload = Record<string, unknown>

const hookExamplePayloads: Record<string, HookExamplePayload> = {
  'assets.validateSidecar': { metaPath: '~/.bakin/assets/store/task-123/image.json' },
  'assets.getSidecarPath': { assetPath: '~/.bakin/assets/store/task-123/image.png' },
  'assets.createStub': { assetPath: '~/.bakin/assets/store/task-123/image.png' },
  'assets.detectVariant': { filename: 'task-123.after.png' },
  'assets.getAssetTypes': {},
  'assets.pathForFilename': { filename: 'task-123.after.png' },
  'assets.purgeClipboardForTask': { taskId: 'task-123' },
  'assets.trash.list': { assetsRoot: '~/.bakin/assets' },
  'assets.restoreAsset': { trashFilename: 'task-123.after.png', assetsRoot: '~/.bakin/assets' },
  'assets.emptyTrash': { assetsRoot: '~/.bakin/assets' },
  'health.list': {},
  'health.getCheck': { id: 'runtime' },
  'models.configChanged': { agentId: 'patch', oldModel: 'gpt-5.4', newModel: 'gpt-5.5' },
  'models.getEffectiveModel': { agentId: 'patch' },
  'models.markConfigDirty': {},
  'models.markRuntimeRestarted': {},
  'models.getAvailableModels': {},
  'tasks.statusChanged': { taskId: 'task-123', from: 'doing', to: 'done' },
  'tasks.enrichDetails': { task: { id: 'task-123', projectId: 'launch-docs' } },
  'team.list': {},
  'team.getAgent': { id: 'patch' },
  'team.getAgentIds': {},
  'team.resolveProfile': { id: 'patch' },
  'team.getTeamMembers': { teamId: 'docs' },
  'team.getAgentTeam': { id: 'patch' },
  'team.getOrgStructure': {},
  'workflows.loadInstance': { taskId: 'task-123' },
  'workflows.saveInstance': { instance: { taskId: 'task-123', workflowId: 'docs-review' } },
  'workflows.createInstance': { taskId: 'task-123', workflowId: 'docs-review', assignee: 'patch' },
  'workflows.instances.list': { statusFilter: 'in_progress' },
  'workflows.getCurrentStep': { taskId: 'task-123', agentId: 'patch' },
  'workflows.completeStep': { taskId: 'task-123', stepId: 'review', output: { ok: true } },
  'workflows.matchWorkflow': { title: 'Improve hook docs', description: 'Add generated examples' },
  'workflows.definitions.list': {},
  'workflows.loadDefinition': { name: 'docs-review' },
  'workflows.getActiveAgents': { taskId: 'task-123' },
  'workflows.isGateNotified': { taskId: 'task-123', stepId: 'approval' },
  'workflows.markGateNotified': { taskId: 'task-123', stepId: 'approval' },
  'workflows.validateStepOutput': { schema: { type: 'object' }, output: { approved: true } },
  'workflows.cancelInstance': { taskId: 'task-123' },
  'workflows.notificationChannels.list': {},
  'workflows.getNotificationChannel': { id: 'slack' },
}

function formatHookExampleValue(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  const childPad = ' '.repeat(indent + 2)
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map(item => `${childPad}${formatHookExampleValue(item, indent + 2)}`).join(',\n')}\n${pad}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length) return '{}'
    return `{\n${entries.map(([key, item]) => `${childPad}${key}: ${formatHookExampleValue(item, indent + 2)}`).join(',\n')}\n${pad}}`
  }
  return 'null'
}

function renderHookExample(hook: HookRegistration): string {
  const payload = formatHookExampleValue(hookExamplePayloads[hook.name] ?? {}, 2)
  const method = hook.hookKind === 'event'
    ? 'callAll'
    : hook.hookKind === 'waterfall'
      ? 'call'
      : 'invoke'
  if (hook.hookKind === 'event') {
    return `await ctx.hooks.${method}(\n  '${hook.name}',\n  ${payload},\n)`
  }
  if (hook.hookKind === 'waterfall') {
    return `const next = await ctx.hooks.${method}(\n  '${hook.name}',\n  ${payload},\n)`
  }
  return `const result = await ctx.hooks.${method}(\n  '${hook.name}',\n  ${payload},\n)`
}

function renderHookCard(hook: HookRegistration): string {
  const id = hookId(hook.name)
  const label = hook.label ?? hook.summary ?? hook.name
  const badges = [
    hook.hookKind,
    hook.visibility && hook.visibility !== 'public' ? hook.visibility : '',
    hook.stability && hook.stability !== 'stable' ? hook.stability : '',
  ].filter(Boolean)
  const props = [
    `id="${id}"`,
    `name="${escapeHtml(hook.name)}"`,
    `label="${escapeHtml(label)}"`,
    hook.summary ? `summary="${escapeHtml(hook.summary)}"` : '',
    `source="${escapeHtml(`${hook.file}:${hook.line}`)}"`,
    badges.length ? `badges={${JSON.stringify(badges)}}` : '',
  ].filter(Boolean).join(' ')
  return [
    `<HookCard ${props}>`,
    '```ts frame="terminal"',
    renderHookExample(hook),
    '```',
    '</HookCard>',
  ].filter(Boolean).join('\n')
}

function renderHookLlmReference(): string {
  const hooks = extractHookRegistrations()
  const grouped = new Map<string, HookRegistration[]>()
  for (const hook of hooks) {
    const namespace = hookNamespace(hook.name)
    const existing = grouped.get(namespace) ?? []
    existing.push(hook)
    grouped.set(namespace, existing)
  }

  const lines = [
    'Hooks are plugin integration points. Use them from plugin code through `ctx.hooks`.',
    '',
    'Invocation style depends on `kind`:',
    '',
    '- `rpc`: `await ctx.hooks.invoke(name, payload)`',
    '- `event`: `await ctx.hooks.callAll(name, payload)`',
    '- `waterfall`: `await ctx.hooks.call(name, payload)`',
    '',
  ]

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const title = namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`
    lines.push(`## ${title}`, '')
    const description = hookGroupDescriptions[namespace]
    if (description) lines.push(description, '')
    for (const hook of [...(grouped.get(namespace) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`### ${hook.name}`, '')
      lines.push(`Label: ${hook.label ?? hook.summary ?? hook.name}`)
      if (hook.summary) lines.push(`Purpose: ${hook.summary}`)
      lines.push(`Kind: ${hook.hookKind ?? 'rpc'}`)
      lines.push(`Source: ${hook.file}:${hook.line}`)
      lines.push('', 'Example:', '', '```ts', renderHookExample(hook), '```', '')
    }
  }

  return lines.join('\n')
}

type ExecToolDoc = ReturnType<typeof extractExecTools>[number]

const mcpGroupDescriptions: Record<string, string> = {
  assets: 'Asset tools let agents list, inspect, save, link, restore, and clean up files managed by Bakin.',
  gen: 'Generation tools create or import media through Bakin so outputs land in the asset pipeline with task context.',
  get: 'Runtime lookup tools return local Bakin paths and state agents should not hardcode.',
  health: 'Health tools let agents check whether Bakin is running correctly before or during work.',
  heartbeat: 'Heartbeat tools let agents publish lightweight status so Bakin can show who is active and what they are doing.',
  log: 'Logging tools record progress updates in Bakin task history and audit surfaces.',
  memory: 'Memory tools expose indexed runtime memory, sessions, turns, checkpoints, and status to agents.',
  messaging: 'Messaging tools let agents create, update, approve, reject, and inspect human-facing messages and sessions.',
  models: 'Model tools expose model configuration and available model choices to agents.',
  post: 'Publishing tools send completed work to configured channels through Bakin adapters.',
  project: 'Project tools let agents create, update, read, and maintain project specs and linked checklist items.',
  schedule: 'Schedule tools let agents create, inspect, pause, run, and update recurring Bakin jobs.',
  search: 'Search tools query Bakin-indexed content across plugins or inside a specific surface.',
  submit: 'Workflow submission tools let agents submit step output back to the workflow engine.',
  tasks: 'Task tools are the main agent interface for creating, reading, moving, logging, blocking, and completing work.',
  team: 'Team tools expose agent roster, identity, status, messaging, and permission operations.',
  workflows: 'Workflow tools expose workflow definitions, active instances, current steps, and step completion.',
}

function mcpToolId(name: string): string {
  return name.replace(/^bakin_exec_/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function mcpToolNamespace(name: string): string {
  return name.replace(/^bakin_exec_/, '').split('_')[0] || 'other'
}

function mcpToolLabel(name: string): string {
  const words = name.replace(/^bakin_exec_/, '').split('_').filter(Boolean)
  return `${words.map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ')}.`
}

function mcpExampleValue(type: string): unknown {
  if (type === 'number') return 20
  if (type === 'boolean') return true
  if (type === 'choice') return 'value'
  if (type === 'record' || type === 'object') return { key: 'value' }
  if (type === 'array') return ['value']
  return 'value'
}

function renderMcpExample(tool: ExecToolDoc): string {
  const args = Object.fromEntries(tool.parameters.map(param => [param.name, mcpExampleValue(param.type)]))
  const json = JSON.stringify(args, null, 2)
  if (tool.parameters.length === 0) return `mcporter call bakin-<agent>.${tool.name}`
  return `mcporter call bakin-<agent>.${tool.name} --args '${json}'`
}

function renderMcpToolCard(tool: ExecToolDoc): string {
  const id = mcpToolId(tool.name)
  const props = [
    `id="${id}"`,
    `name="${escapeHtml(tool.name)}"`,
    `label="${escapeHtml(tool.label ?? mcpToolLabel(tool.name))}"`,
    tool.description ? `description="${escapeHtml(tool.description.trim())}"` : '',
    `source="${escapeHtml(`${tool.file}:${tool.line}`)}"`,
    tool.parameters.length ? `parameters={${JSON.stringify(tool.parameters)}}` : '',
  ].filter(Boolean).join(' ')
  return [
    `<McpToolCard ${props}>`,
    '```sh frame="terminal"',
    renderMcpExample(tool),
    '```',
    '</McpToolCard>',
  ].join('\n')
}

function renderMcpLlmReference(): string {
  const tools = extractExecTools()
  const grouped = new Map<string, ExecToolDoc[]>()
  for (const tool of tools) {
    const namespace = mcpToolNamespace(tool.name)
    const existing = grouped.get(namespace) ?? []
    existing.push(tool)
    grouped.set(namespace, existing)
  }

  const lines = [
    'Use MCP tools through `mcporter`:',
    '',
    '```sh',
    "mcporter call bakin-<agent>.<tool_name> --args '<json>'",
    '```',
    '',
    'Use the exact tool name shown below. Omit `--args` only for tools with no parameters.',
    '',
  ]

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const title = namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`
    lines.push(`## ${title}`, '')
    const description = mcpGroupDescriptions[namespace]
    if (description) lines.push(description, '')
    for (const tool of [...(grouped.get(namespace) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`### ${tool.name}`, '')
      lines.push(`Label: ${tool.label ?? mcpToolLabel(tool.name)}`)
      if (tool.description) lines.push(`Purpose: ${tool.description.trim()}`)
      if (tool.parameters.length) {
        lines.push('', '| Argument | Type | Required | Description |', '| --- | --- | --- | --- |')
        for (const param of tool.parameters) {
          lines.push(`| \`${escapeMarkdownTableCell(param.name)}\` | ${escapeMarkdownTableCell(param.type)} | ${param.required ? 'yes' : 'no'} | ${escapeMarkdownTableCell(param.description ?? '')} |`)
        }
      } else {
        lines.push('', 'Arguments: none.')
      }
      lines.push('', 'Example:', '', '```sh', renderMcpExample(tool), '```', '')
    }
  }

  return lines.join('\n')
}

function renderHookReference(): string {
  const hooks = extractHookRegistrations()
  const grouped = new Map<string, HookRegistration[]>()
  for (const hook of hooks) {
    const namespace = hookNamespace(hook.name)
    const existing = grouped.get(namespace) ?? []
    existing.push(hook)
    grouped.set(namespace, existing)
  }

  const lines = [
    '---',
    'title: Hooks',
    'description: Generated audit reference for Bakin hook registrations.',
	    '---',
	    '',
    "import HookCard from '../../../../components/HookCard.astro'",
    '',
    '<div class="hook-reference-intro">',
    '  <p>Hooks are the integration points plugins use to share Bakin state and behavior. Reach for them when you need task context, agent details, model choices, workflow state, assets, or health checks owned by another plugin.</p>',
    '  <p>This reference shows the hook key to call, what it returns or changes, and the registration that owns the contract.</p>',
    '</div>',
    '',
	  ]

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const namespaceHooks = [...(grouped.get(namespace) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    const title = namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`
    lines.push(`## ${title}`, '')
    lines.push(`<p class="hook-section-description">${escapeHtml(hookGroupDescriptions[namespace] ?? 'Hooks discovered from source registration audit.')}</p>`, '')
    lines.push('<div class="hook-card-list">')
    for (const hook of namespaceHooks) {
      lines.push(renderHookCard(hook))
    }
    lines.push('</div>', '')
	  }
	  lines.push(generatedPageNote(), '')

	  return lines.join('\n')
	}

function renderExecToolReference(): string {
  const tools = extractExecTools()
  const grouped = new Map<string, ExecToolDoc[]>()
  for (const tool of tools) {
    const namespace = mcpToolNamespace(tool.name)
    const existing = grouped.get(namespace) ?? []
    existing.push(tool)
    grouped.set(namespace, existing)
  }

  const lines = [
    '---',
    'title: MCP',
    'description: Generated reference for Bakin MCP tools exposed to agents.',
	    '---',
	    '',
    "import McpToolCard from '../../../../components/McpToolCard.astro'",
    '',
    '<div class="mcp-reference-intro">',
    '  <p>MCP tools are how agents get work done in Bakin. They create and move tasks, advance workflows, manage assets and projects, search local state, send messages, schedule recurring work, and check system health.</p>',
    '  <p>Use this reference when you need the exact tool name, the arguments it accepts, and a copyable call shape.</p>',
    '</div>',
    '',
	  ]

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const namespaceTools = [...(grouped.get(namespace) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    const title = namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`
    lines.push(`## ${title}`, '')
    lines.push(`<p class="mcp-section-description">${escapeHtml(mcpGroupDescriptions[namespace] ?? 'MCP tools discovered from registered exec tool definitions.')}</p>`, '')
    lines.push('<div class="mcp-tool-list">')
    for (const tool of namespaceTools) {
      lines.push(renderMcpToolCard(tool))
    }
    lines.push('</div>', '')
	  }
	  lines.push(generatedPageNote(), '')

	  return lines.join('\n')
	}

function renderPluginCatalog(): string {
  const plugins = readOfficialPluginCatalog()
  const lines = [
    '---',
    'title: Official Plugins',
    'description: Generated catalog of official plugins supported by Bakin.',
	    '---',
	    '',
    '<div class="plugin-catalog-intro">',
    '  <p>Official plugins are maintained with Bakin and documented as supported product surfaces. Core plugins ship in this repo; official plugins can also live in the official plugin repo.</p>',
    '</div>',
    '',
    '<table class="plugin-catalog-table">',
    '  <thead>',
    '    <tr><th>Plugin</th><th>ID</th><th>Source</th><th>Version</th><th>Depends On</th></tr>',
    '  </thead>',
    '  <tbody>',
	  ]

	  for (const plugin of plugins) {
    const name = escapeHtml(plugin.name)
    const description = plugin.description ? `<br/><span>${escapeHtml(plugin.description)}</span>` : ''
    const deps = plugin.dependencies?.length ? plugin.dependencies.map(d => `<code>${escapeHtml(d)}</code>`).join(' ') : 'none'
    lines.push(
      '    <tr>',
      `      <td>${name}${description}</td>`,
      `      <td><code>${escapeHtml(plugin.id)}</code></td>`,
      `      <td>${plugin.origin}</td>`,
      `      <td><code>${escapeHtml(plugin.version)}</code></td>`,
      `      <td>${deps}</td>`,
      '    </tr>',
    )
	  }
  lines.push('  </tbody>', '</table>', '')
	  lines.push(generatedPageNote(), '')

	  return lines.join('\n')
	}

function renderSettingsReference(): string {
  const settings = flattenObject(DEFAULT_SETTINGS)
  const grouped = new Map<string, Array<{ key: string; value: unknown }>>()
  for (const setting of settings) {
    const namespace = setting.key.split('.')[0] || 'other'
    const existing = grouped.get(namespace) ?? []
    existing.push(setting)
    grouped.set(namespace, existing)
  }

  const lines = [
    '---',
    'title: Defaults',
    'description: Generated reference for Bakin core settings defaults.',
	    '---',
    '',
    '<div class="settings-reference-intro">',
    '  <p>Bakin starts with these values, then deep-merges anything you set in <code>settings.json</code>. Use this page when you need the exact key for CLI updates, automation, or troubleshooting.</p>',
    '</div>',
    '',
  ]

  const settingGroupTitles: Record<string, string> = { restartRecovery: 'Restart Recovery', sse: 'SSE' }

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const title = settingGroupTitles[namespace] ?? (namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`)
    lines.push(`## ${title}`, '')
    lines.push(
      '<table class="settings-defaults-table">',
      '  <thead>',
      '    <tr><th>Key</th><th>Default</th></tr>',
      '  </thead>',
      '  <tbody>',
    )
    for (const setting of [...(grouped.get(namespace) ?? [])].sort((a, b) => a.key.localeCompare(b.key))) {
      lines.push(
        '    <tr>',
        `      <td><code>${escapeHtml(setting.key)}</code></td>`,
        `      <td><code>${escapeHtml(JSON.stringify(setting.value))}</code></td>`,
        '    </tr>',
      )
    }
    lines.push('  </tbody>', '</table>', '')
  }
  lines.push('', generatedPageNote(), '')
  return lines.join('\n')
}

function renderRuntimePathsReference(): string {
  const resolution = [
    ['BAKIN_HOME', 'Used when the environment variable is set.'],
    ['~/.bakin/', 'Default location when no override is present.'],
  ]
  const paths = [
    ['home', 'Resolved Bakin home directory.'],
    ['settings', 'Runtime settings file.'],
    ['memoryLog', 'Shared memory log.'],
    ['audit', 'Append-only audit log.'],
    ['logs', 'Server and runtime logs.'],
    ['assets', 'Asset runtime root.'],
    ['assets.store', 'Month-sharded asset files.'],
    ['assets.inbox', 'Asset ingestion inbox.'],
    ['assets.trash', 'Soft-deleted asset files.'],
    ['agents', 'Agent runtime assets.'],
    ['team', 'Team runtime data.'],
    ['personas', 'Agent persona files.'],
    ['heartbeats', 'Agent heartbeat files.'],
    ['inbox', 'General inbox directory.'],
    ['tasks', 'Task metadata store.'],
    ['workflows', 'Workflow definitions, skills, and instances.'],
  ]
  const lines = [
    '---',
    'title: Runtime Paths',
    'description: Reference for Bakin runtime files under the resolved Bakin home directory.',
    '---',
    '',
    '<div class="runtime-paths-intro">',
    '  <p>Bakin keeps local state under one home directory. Use these keys when you need to find logs, settings, assets, task metadata, workflow state, or other files created by the runtime.</p>',
    '</div>',
    '',
    '## Home Resolution',
    '',
    '<table class="runtime-paths-table">',
    '  <thead>',
    '    <tr><th>Source</th><th>When Used</th></tr>',
    '  </thead>',
    '  <tbody>',
  ]
  for (const [source, description] of resolution) {
    lines.push(
      '    <tr>',
      `      <td><code>${escapeHtml(source)}</code></td>`,
      `      <td>${escapeHtml(description)}</td>`,
      '    </tr>',
    )
  }
  lines.push(
    '  </tbody>',
    '</table>',
    '',
    '## Path Keys',
    '',
    '<table class="runtime-paths-table">',
    '  <thead>',
    '    <tr><th>Key</th><th>Purpose</th></tr>',
    '  </thead>',
    '  <tbody>',
  )
  for (const [key, description] of paths) {
    lines.push(
      '    <tr>',
      `      <td><code>${escapeHtml(key)}</code></td>`,
      `      <td>${escapeHtml(description)}</td>`,
      '    </tr>',
    )
  }
  lines.push('  </tbody>', '</table>', '', generatedPageNote(), '')
  return lines.join('\n')
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/</g, '&lt;')
}

function renderSdkReference(): string {
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
    "import { PluginHeader } from '@makinbakin/sdk/components'",
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
  // Components
  renderComponents(lines, bySubpath.get('@makinbakin/sdk/components'))
  // UI
  renderUi(lines, bySubpath.get('@makinbakin/sdk/ui'))
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
  lines.push("import { useSearch, useAssets, useDebug } from '@makinbakin/sdk/hooks'")
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

function renderComponents(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk/components`', '')
  lines.push(`Source: \`${sp.source}\`.`, '')
  lines.push('```ts')
  lines.push("import { PluginHeader, FacetFilter, AgentAvatar } from '@makinbakin/sdk/components'")
  lines.push('```', '')
  lines.push('| Component | Description |')
  lines.push('| --- | --- |')
  for (const sym of sp.symbols) {
    lines.push(`| \`${sym.name}\` | ${escapeMd(sym.jsdoc || '—')} |`)
  }
  lines.push('')
}

function renderUi(lines: string[], sp: SdkSubpath | undefined): void {
  if (!sp) return
  lines.push('## `@makinbakin/sdk/ui`', '')
  lines.push(`Source: \`${sp.source}\`. Re-exports of [shadcn/ui](https://ui.shadcn.com) primitives bundled with Bakin's design tokens. For usage, see the upstream component docs.`, '')
  lines.push('```ts')
  lines.push("import { Button, Card, Dialog, Input } from '@makinbakin/sdk/ui'")
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
    'HealthCheckResult',
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
    const group = TYPE_DOMAIN_GROUPS[sym.name] || 'Other'
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
      if (sp.importPath === '@makinbakin/sdk/types' && !CORE_TYPES.has(sym.name) && !TYPE_DOMAIN_GROUPS[sym.name]) {
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

writeStableFile(
  join(generatedRoot, 'coverage.json'),
  JSON.stringify(buildCoverageReport(), null, 2),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/cli.mdx'),
  renderCliReference(),
)

// T20: openapi.json + api.mdx are now generated from typed route contracts
// (the same buildOperation used by /api/openapi). Imports each in-repo
// plugin statically (no activate() invocation), reads plugin.default.routes,
// combines with packages/host/src/core-routes/coreRoutes, runs the typed
// builder. Replaces the legacy buildOpenApiDocument() that used
// manifest + source-scan with generic-object fallbacks.
//
// The api.mdx wrapper-list MUST share operationIds with openapi.json or the
// renderer can't find the operation by id. Shared `apiReferenceGroups` is
// the bridge.
const apiReferenceGroups = new Map<string, Array<{ operationId: string; curl: string; path: string; method: string }>>()
{
  const { buildOperation, normalizeOpenApiPath } = await import('../../packages/core/src/openapi')
  const { coreRoutes: typedCoreRoutes } = await import('../../packages/host/src/core-routes')

  const inRepoPluginIds = ['assets', 'git', 'health', 'images', 'memory', 'models', 'schedule', 'tasks', 'team', 'workflows']
  const sources: Array<{ scope: string; tag: string; fullPath: string; route: any }> = []
  for (const id of inRepoPluginIds) {
    const mod = await import(join(repoRoot, 'plugins', id, 'index.ts')) as { default?: { name?: string; routes?: any[] } }
    const routes = mod.default?.routes ?? []
    const tag = mod.default?.name ?? id
    for (const route of routes) {
      sources.push({
        scope: id,
        tag,
        fullPath: `/api/plugins/${id}${route.path}`,
        route,
      })
    }
  }
  for (const route of typedCoreRoutes) {
    sources.push({
      scope: 'core',
      tag: 'Core',
      fullPath: route.path,
      route,
    })
  }

  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, string | undefined>()
  for (const entry of sources) {
    tags.set(entry.tag, undefined)
    const op = buildOperation(entry.route, { scope: entry.scope, fullPath: entry.fullPath, tag: entry.tag }) as unknown as OpenApiOperation
    const openApiPath = normalizeOpenApiPath(entry.fullPath)
    paths[openApiPath] ??= {}
    paths[openApiPath][entry.route.method.toLowerCase()] = op
    const operationId = String(op.operationId)
    const curl = curlForOperation(entry.route.method, openApiPath, op)
    const existing = apiReferenceGroups.get(entry.tag) ?? []
    existing.push({ operationId, curl, path: openApiPath, method: entry.route.method })
    apiReferenceGroups.set(entry.tag, existing)
  }

  // Sort within each tag group so the page body matches the right-rail TOC
  // (which sorts alphabetically by path, then by HTTP method order).
  const methodOrder: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, OPTIONS: 5, HEAD: 6 }
  for (const ops of apiReferenceGroups.values()) {
    ops.sort((a, b) =>
      a.path.localeCompare(b.path) ||
      (methodOrder[a.method] ?? 99) - (methodOrder[b.method] ?? 99),
    )
  }

  const typedDoc = {
    openapi: '3.1.0',
    info: {
      title: 'Bakin API',
      version: APP_VERSION,
      description: 'Generated from typed route contracts (defineRoute / defineCoreRoute) — same builder as /api/openapi.',
    },
    servers: [{ url: 'http://localhost:3737', description: 'Local Bakin server' }],
    tags: [...tags.entries()].map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
    paths,
    components: {
      securitySchemes: {
        pluginPermissions: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Bakin-Plugin-Permission',
          description: 'Documents plugin permission requirements.',
        },
      },
    },
  }

  writeStableFile(
    join(docsRoot, 'public/openapi.json'),
    `${JSON.stringify(typedDoc, null, 2)}\n`,
  )
}

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/api.mdx'),
  renderApiReference(apiReferenceGroups),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/hooks.mdx'),
  renderHookReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/exec-tools.mdx'),
  renderExecToolReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/core-plugins.md'),
  renderPluginCatalog(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/settings.md'),
  renderSettingsReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/runtime-paths.md'),
  renderRuntimePathsReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/sdk.md'),
  renderSdkReference(),
)

updateGeneratedContentBlocks()

writeStableFile(
  join(docsRoot, 'public/llms.txt'),
  `# Bakin Docs

${versionLine}

Bakin is a self-hosted dashboard, backend, CLI, and extension system for running agent work through a configured runtime adapter. Use these docs to install Bakin, operate it, build plugins, author agent packages, and understand the public contracts exposed by the SDK, hooks, slots, CLI, and HTTP API.

Primary docs:

- Install Bakin: ${docsUrl}/start/install/
  Use this for the released one-line install path and platform notes.

- Initial Setup: ${docsUrl}/start/first-time-setup/
  Use this to create the Bakin home directory and validate local dependencies.

- Daily Operation: ${docsUrl}/start/operation/
  Use this for lifecycle commands, health checks, updates, and runtime operation.

- Essentials: ${docsUrl}/using/essentials/
  Use this for the core Bakin areas and the quickest map of day-to-day product concepts.

- Tasks: ${docsUrl}/using/tasks/
  Use this for the task model, task lifecycle, approvals, output, and agent execution flow.

- Plugin authoring: ${docsUrl}/extending/plugins/overview/
  Use this when building Bakin plugins with @makinbakin/sdk.

- Agent authoring: ${docsUrl}/extending/agents/overview/
  Use this when creating agent packages or writing instructions for coding agents working with Bakin.

- SDK docs: ${docsUrl}/extending/sdk/overview/
  Use this for @makinbakin/sdk imports, UI components, hooks, slots, and public extension contracts.

LLM bundles:

- Full context: ${docsUrl}/llms-full.txt
- Plugin authoring bundle: ${docsUrl}/llms/plugin-authoring.md
- Agent authoring bundle: ${docsUrl}/llms/agent-authoring.md
- SDK reference bundle: ${docsUrl}/llms/sdk-reference.md
- API reference bundle: ${docsUrl}/llms/api.md
`,
)

writeStableFile(
  join(docsRoot, 'public/llms-full.txt'),
  `# Bakin Full LLM Context

${versionLine}

Audience: coding agents, plugin authors, agent authors, and technical operators.

Canonical docs: ${docsUrl}/

## Operating Rules

- Use \`Bakin\` for the product and \`bakin\` for the CLI.
- Prefer the released one-line installer for end-user install instructions.
- Use \`@makinbakin/sdk/*\` imports for plugin-facing code.
- Do not import host internals or another plugin's internals from a plugin.
- Treat public hooks, slots, CLI commands, HTTP routes, settings, and SDK exports as documented contracts.
- Prefer tested docs snippets and generated reference over guessing APIs.

## Useful Bundles

- Plugin authoring: ${docsPath('/llms/plugin-authoring.md')}
- Agent authoring: ${docsPath('/llms/agent-authoring.md')}
- SDK reference: ${docsPath('/llms/sdk-reference.md')}
- API reference: ${docsPath('/llms/api.md')}
- CLI reference: ${docsPath('/reference/generated/cli/')}
- API reference: ${docsPath('/reference/generated/api/')}
- Hooks reference: ${docsPath('/reference/generated/hooks/')}
- Exec/MCP tools reference: ${docsPath('/reference/generated/exec-tools/')}
- Core plugin catalog: ${docsPath('/reference/generated/core-plugins/')}
- Settings reference: ${docsPath('/reference/generated/settings/')}
- Runtime paths: ${docsPath('/reference/generated/runtime-paths/')}
- SDK reference: ${docsPath('/reference/generated/sdk/')}

## Fetch Examples

\`\`\`sh
curl -fsSL ${docsUrl}/llms/plugin-authoring.md
curl -fsSL ${docsUrl}/llms/agent-authoring.md
\`\`\`
`,
)

const bundles = {
  'plugin-authoring.md': {
    title: 'Bakin Plugin Authoring',
    body: 'Use `@makinbakin/sdk/*` for plugin code. Public plugin examples must be backed by tested snippets. Public hooks, slots, routes, settings, and exec/MCP tools require metadata, schemas, examples, visibility, and stability before launch.',
  },
  'agent-authoring.md': {
    title: 'Bakin Agent Authoring',
    body: 'Agent-facing docs are explicit and labeled. Explain runtime-specific concepts only when a package depends on them. Agent package examples must be validated before publication.',
  },
  'api.md': {
    title: 'Bakin API',
    body: 'HTTP API docs are generated from docs-aware route definitions and emitted as OpenAPI 3.1 at /docs/openapi.json. Public inputs are validated with Zod at runtime where handlers define schemas. Structured outputs are validated in tests, docs generation, or development checks where practical.',
  },
  'cli.md': {
    title: 'Bakin CLI Reference',
    body: `The CLI reference is generated from src/core/cli/registry.ts. Current public command count: ${CLI_COMMANDS.length}. Help output and generated docs use the same registry.`,
  },
  'hooks.md': {
    title: 'Bakin Hooks',
    body: renderHookLlmReference(),
  },
  'exec-tools.md': {
    title: 'Bakin MCP Tools',
    body: renderMcpLlmReference(),
  },
  'core-plugins.md': {
    title: 'Bakin Official Plugins',
    body: `The official plugin catalog is generated from supported plugin manifests. Current official plugin count: ${readOfficialPluginCatalog().length}. Core plugins ship in this repo; additional official plugins can live in the official plugin repo.`,
  },
  'settings.md': {
    title: 'Bakin Settings Reference',
    body: `The settings reference is generated from packages/core/src/settings.ts. Current flattened setting count: ${flattenObject(DEFAULT_SETTINGS).length}. Operators can override settings in settings.json under the resolved Bakin home directory.`,
  },
  'sdk-reference.md': {
    title: 'Bakin SDK Reference',
    body: `The SDK reference is generated from JSDoc comments on SDK barrel files (\`packages/sdk/src/*/index.ts\`). Current SDK subpath count: ${readSdkExports().length}. Core plugin contract types (BakinPlugin, PluginContext, etc.) include field-level documentation; remaining types are grouped by domain with one-line summaries.`,
  },
}

for (const [file, { title, body }] of Object.entries(bundles)) {
  writeStableFile(
    join(docsRoot, 'public/llms', file),
    `# ${title}

${versionLine}

Audience: coding agents and technical authors.

Canonical docs: ${docsUrl}/

${body}
`,
  )
}

console.log('Generated docs scaffolding artifacts')
