import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  extractExecTools,
  extractPluginSettings,
  getApiRoutes,
  getCliCommands,
  listPluginManifests,
  relativeSource,
  renderExecToolsSnippet,
  sourceFiles,
} from './source-scan'
import { dirname, join } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import { getAllRoutes } from '../../src/core/api-docs'

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
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8')
    const next = text
      .replace(commandMarkerPattern, (_match, marker: string) => renderCommandSnippet(marker))
      .replace(snippetMarkerPattern, (_match, marker: string) => renderDocsSnippetBlock(marker))
      .replace(execToolsMarkerPattern, (_match, marker: string) => renderExecToolsSnippet(marker))
      .replace(apiRoutesMarkerPattern, (_match, marker: string) => renderApiRoutesSnippet(marker))
      .replace(settingsMarkerPattern, (_match, marker: string) => renderSettingsSnippet(marker))
    if (next !== text) writeStableFile(file, next)
  }
}

function extractHookRegistrations(): Array<{ name: string; file: string; line: number }> {
  const hooks: Array<{ name: string; file: string; line: number }> = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/hooks\.register\(['"`]([^'"`]+)['"`]/)
      if (match) hooks.push({ name: match[1], file: relativeSource(file), line: i + 1 })
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
  file: string
}

interface SdkExportDoc {
  importPath: string
  source: string
  exports: string[]
}

function readCorePluginManifests(): PluginManifestDoc[] {
  const pluginsDir = join(repoRoot, 'plugins')
  const manifests: PluginManifestDoc[] = []
  for (const entry of readdirSync(pluginsDir).sort()) {
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
        file: relativeSource(manifestPath),
      })
    } catch {
      // Not every directory under plugins/ must be a plugin.
    }
  }
  return manifests
}

function readSdkExports(): SdkExportDoc[] {
  const pkgPath = join(repoRoot, 'packages/sdk/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, string> }
  return Object.entries(pkg.exports).map(([subpath, source]) => {
    const importPath = subpath === '.' ? '@bakin/sdk' : `@bakin/sdk${subpath.slice(1)}`
    const sourcePath = join(repoRoot, 'packages/sdk', source.replace(/^\.\//, ''))
    const text = readFileSync(sourcePath, 'utf8')
    const exports = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('export '))
      .map(line => line.replace(/\s+/g, ' '))
    return {
      importPath,
      source: relativeSource(sourcePath),
      exports,
    }
  })
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
function generatedPageNote(source: string, note?: string): string {
  const escapedSource = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escapedNote = note?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    '<aside class="generated-page-note" aria-label="Generated page metadata">',
    `  <span>Generated from <code>${escapedSource}</code>.</span>`,
    `  <span>Bakin ${APP_VERSION}.</span>`,
    escapedNote ? `  <span>${escapedNote}</span>` : '',
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
    'list|enable|disable': 'Knowledge action.',
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

function renderCliUsageLine(command: CliCommand): string {
  const tokens = command.usage.match(/\[[^\]]+\]|<[^>]+>|\S+/g) ?? []
  return tokens.map((token, index) => {
    const inner = token.replace(/^\[/, '').replace(/\]$/, '').replace(/^</, '').replace(/>$/, '')
    const hasChoice = inner.includes('|')
    const required = token.startsWith('<')
    const optional = token.startsWith('[')
    const displayToken = hasChoice ? displayCliPartToken(inner, 'choice', required && !optional, optional) : token
    const className = index === 0
      ? 'cli-token cli-token--binary'
      : token.startsWith('[') || token.startsWith('--') || token.startsWith('-')
        ? 'cli-token cli-token--option'
        : token.startsWith('<')
          ? 'cli-token cli-token--arg'
          : 'cli-token'
    return `<span class="${className}">${escapeHtml(displayToken)}</span>`
  }).join(' ')
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
        status: 'audited',
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
    description: 'Agent package commands install and maintain reusable agent definitions, bundled knowledge, prompts, and rules that Bakin manages as local agent state.',
    matches: (command) => ['agents install', 'agents remove', 'agents update', 'agents knowledge'].includes(command.name) || command.name.startsWith('packages '),
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

  return [
    `<section class="cli-command" id="${commandId}">`,
    '  <div class="cli-command__heading">',
    `    <code>${escapeHtml(command.name)}</code>`,
    `    <span class="cli-command__summary">${escapeHtml(command.summary)}</span>`,
    `    <a class="cli-command__anchor" href="#${commandId}" aria-label="Link to ${escapeHtml(command.name)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>`,
    '  </div>',
    '  <div class="cli-command__box">',
    `  <p class="cli-command__description">${escapeHtml(command.description)}</p>`,
    '  <div class="cli-command__terminal">',
    '    <span class="cli-command__prompt">&gt;</span>',
    `    <code>${renderCliUsageLine(command)}</code>`,
    `    <button class="cli-command__copy" type="button" data-cli-copy="${escapeHtml(command.usage)}" aria-label="Copy ${escapeHtml(command.usage)}">Copy</button>`,
    '  </div>',
    usageParts.length ? [
      '  <table class="cli-command__args">',
      '    <thead><tr><th>Part</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>',
      '    <tbody>',
      ...usageParts.map(part => `      <tr><td><code>${escapeHtml(part.displayToken)}</code>${part.choices.length ? `<span class="cli-command__choices">${part.choices.map(choice => `<span>${escapeHtml(choice)}</span>`).join('')}</span>` : ''}</td><td>${part.kind}</td><td>${part.required ? 'yes' : 'no'}</td><td>${part.description}</td></tr>`),
      '    </tbody>',
      '  </table>',
    ].join('\n') : '',
    commandNotes.length ? `  <p class="cli-command__meta">${commandNotes.join(' · ')}</p>` : '',
    '  </div>',
    '</section>',
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
		  lines.push(generatedPageNote('src/core/cli/registry.ts'), '')

	  return lines.join('\n')
	}

function renderApiReference(): string {
  const coreRoutes = getAllRoutes().filter(r => r.pluginId === 'core')

  const lines = [
    '---',
    'title: API Reference',
    'description: Generated reference for documented Bakin HTTP API routes.',
	    '---',
	    '',
	    '## Core Routes',
    '',
  ]

  for (const route of coreRoutes) {
    lines.push(`### \`${route.method} ${route.fullPath}\``, '')
    lines.push(route.summary, '')
    if (route.description) lines.push(route.description, '')
    if (route.params) lines.push(`Parameters: \`${route.params}\``, '')
    lines.push(`- Visibility: \`${route.visibility}\``)
    lines.push(`- Stability: \`${route.stability}\``)
    if (route.permissions?.length) lines.push(`- Permissions: ${route.permissions.map(p => `\`${p}\``).join(', ')}`)
    lines.push('')
  }

  // Plugin routes — manifest contract first, source-scan fallback.
  const manifests = listPluginManifests().sort((a, b) => a.id.localeCompare(b.id))
	  for (const manifest of manifests) {
    const routes = getApiRoutes(manifest.id)
    if (!routes.length) continue
    lines.push(`## Plugin: ${manifest.id}`, '')
    if (manifest.description) lines.push(manifest.description, '')
    for (const route of routes) {
      const fullPath = `/api/plugins/${manifest.id}${route.path}`
      lines.push(`### \`${route.method} ${fullPath}\``, '')
      lines.push(route.summary, '')
      if (route.permissions?.length) lines.push(`- Permissions: ${route.permissions.map(p => `\`${p}\``).join(', ')}`)
      lines.push('')
    }
	  }
	  lines.push(generatedPageNote('src/core/api-docs.ts + plugin manifests', 'Includes source-scan fallback for plugins without manifest route contracts.'), '')

	  return lines.join('\n')
	}

function renderHookReference(): string {
  const hooks = extractHookRegistrations()
  const lines = [
    '---',
    'title: Hook Reference',
    'description: Generated audit reference for Bakin hook registrations.',
	    '---',
	    '',
	  ]

	  for (const hook of hooks) {
    lines.push(`## \`${hook.name}\``, '')
    lines.push(`Source: \`${hook.file}:${hook.line}\``, '')
    lines.push('- Visibility: `public` until explicitly marked otherwise')
    lines.push('- Stability: `beta` until a hook contract declares stability')
    lines.push('- Contract status: `audited`', '')
	  }
	  lines.push(generatedPageNote('source audit', 'A later contract pass will replace audited hook entries with explicit metadata.'), '')

	  return lines.join('\n')
	}

function renderExecToolReference(): string {
  const tools = extractExecTools()
  const lines = [
    '---',
    'title: Exec and MCP Tool Reference',
    'description: Generated audit reference for Bakin exec/MCP tools exposed to agents.',
	    '---',
	    '',
	  ]

	  for (const tool of tools) {
    lines.push(`## \`${tool.name}\``, '')
    if (tool.description) lines.push(tool.description, '')
    lines.push(`Source: \`${tool.file}:${tool.line}\``, '')
    lines.push('- Visibility: `public` until explicitly marked otherwise')
    lines.push('- Stability: `beta` until a tool contract declares stability')
    lines.push('- Contract status: `audited`', '')
	  }
	  lines.push(generatedPageNote('source audit', 'A later contract pass will replace audited tool entries with explicit metadata and schemas.'), '')

	  return lines.join('\n')
	}

function renderPluginCatalog(): string {
  const plugins = readCorePluginManifests()
  const lines = [
    '---',
    'title: Core Plugin Catalog',
    'description: Generated catalog of core plugins shipped with Bakin.',
	    '---',
	    '',
	  ]

	  for (const plugin of plugins) {
    lines.push(`## ${plugin.name}`, '')
    lines.push(plugin.description ?? 'No description provided.', '')
    lines.push(`- ID: \`${plugin.id}\``)
    lines.push(`- Version: \`${plugin.version}\``)
    if (plugin.bakin) lines.push(`- Bakin compatibility: \`${plugin.bakin}\``)
    lines.push(`- Manifest: \`${plugin.file}\``)
    lines.push(`- Dependencies: ${plugin.dependencies?.length ? plugin.dependencies.map(d => `\`${d}\``).join(', ') : '`none`'}`)
    lines.push(`- Permissions: ${plugin.permissions?.length ? plugin.permissions.map(p => `\`${p}\``).join(', ') : '`none declared`'}`)
    lines.push('')
	  }
	  lines.push(generatedPageNote('plugins/*/bakin-plugin.json'), '')

	  return lines.join('\n')
	}

function renderSettingsReference(): string {
  const settings = flattenObject(DEFAULT_SETTINGS)
  const lines = [
    '---',
    'title: Settings Reference',
    'description: Generated reference for Bakin settings keys and default values.',
	    '---',
	    '',
	    'Bakin reads settings from `settings.json` in the resolved Bakin home directory and deep-merges user values over these defaults.',
    '',
    '| Key | Default |',
    '| --- | --- |',
  ]
	  for (const setting of settings) {
	    lines.push(`| \`${setting.key}\` | \`${JSON.stringify(setting.value)}\` |`)
	  }
	  lines.push('', generatedPageNote('packages/core/src/settings.ts'), '')
	  return lines.join('\n')
	}

function renderRuntimePathsReference(): string {
  const paths = [
    ['home', 'Resolved Bakin home/content directory.'],
    ['settings', 'Runtime settings JSON file.'],
    ['memoryLog', 'Bakin memory log markdown file.'],
    ['audit', 'Append-only audit log.'],
    ['logs', 'Server and runtime log directory.'],
    ['assets', 'Asset plugin root.'],
    ['assets.store', 'Month-sharded asset storage.'],
    ['assets.inbox', 'Asset ingestion inbox.'],
    ['assets.trash', 'Soft-deleted assets.'],
    ['agents', 'Agent UI/runtime assets.'],
    ['team', 'Team plugin runtime data.'],
    ['personas', 'Agent persona files.'],
    ['heartbeats', 'Agent heartbeat files.'],
    ['inbox', 'General inbox directory.'],
    ['tasks', 'Bakin-owned task metadata store.'],
    ['workflows', 'Workflow definitions, skills, and instances.'],
  ]
  const lines = [
    '---',
    'title: Runtime Paths',
    'description: Reference for Bakin runtime files under the resolved Bakin home directory.',
	    '---',
	    '',
	    'This page documents the well-known paths returned by `getBakinPaths()` in `packages/core/src/content-dir.ts`.',
    '',
    'Resolution order:',
    '',
    '1. `BAKIN_HOME` environment variable.',
    '2. `~/.bakin/`.',
    '',
    '| Key | Purpose |',
    '| --- | --- |',
  ]
	  for (const [key, description] of paths) {
	    lines.push(`| \`${key}\` | ${description} |`)
	  }
	  lines.push('', generatedPageNote('packages/core/src/content-dir.ts'), '')
	  return lines.join('\n')
	}

function renderSdkReference(): string {
  const entries = readSdkExports()
  const lines = [
    '---',
    'title: SDK Reference',
    'description: Generated audit reference for @bakin/sdk subpath exports.',
	    '---',
	    '',
	  ]

	  for (const entry of entries) {
    lines.push(`## \`${entry.importPath}\``, '')
    lines.push(`Source: \`${entry.source}\``, '')
    if (entry.exports.length === 0) {
      lines.push('No direct exports detected in the barrel file.', '')
      continue
    }
    lines.push('| Export declaration |')
    lines.push('| --- |')
    for (const exported of entry.exports) {
      lines.push(`| \`${exported.replaceAll('|', '\\|')}\` |`)
    }
    lines.push('')
	  }
	  lines.push(generatedPageNote('packages/sdk/package.json + SDK barrel files', 'Full TypeDoc output will replace this audit view once public TSDoc coverage is complete.'), '')

	  return lines.join('\n')
	}

function renderCoverageReference(): string {
  const routes = getAllRoutes()
  const cliExampleCount = CLI_COMMANDS.reduce((count, command) => count + (command.examples?.length ?? 0), 0)
  const routeInputSchemaCount = routes.filter(route => Boolean(route.input)).length
  const routeOutputSchemaCount = routes.filter(route => Boolean(route.output)).length
  const routeExampleCount = routes.filter(route => (route.examples?.length ?? 0) > 0).length
  const hooks = extractHookRegistrations()
  const slots = extractSlotRegistrations()
  const execTools = extractExecTools()
  const corePlugins = readCorePluginManifests()
  const settings = flattenObject(DEFAULT_SETTINGS)
  const sdkExports = readSdkExports()

  return [
    '---',
    'title: Generated Coverage',
    'description: Coverage report for generated Bakin documentation surfaces.',
    '---',
    '',
    '| Surface | Source | Status |',
    '| --- | --- | --- |',
    `| CLI commands | \`src/core/cli/registry.ts\` | Active: ${CLI_COMMANDS.length} commands, ${cliExampleCount} examples |`,
    `| HTTP routes | \`src/core/api-docs.ts\` and route metadata | Active: ${routes.length} routes, ${routeInputSchemaCount} input schemas, ${routeOutputSchemaCount} output schemas, ${routeExampleCount} routes with examples |`,
    `| Plugin routes | Runtime route registration metadata | Partial: ${routes.filter(route => route.pluginId !== 'core').length} documented plugin routes |`,
    `| Hooks | Source scan for \`hooks.register(...)\` | Audited: ${hooks.length} registrations |`,
    `| Slots | SDK slot contract plus source scan | Documented: ${publicSlotNames.length} public slot names, ${slots.length} audited registrations |`,
    `| Exec/MCP tools | Source scan for \`registerExecTool(...)\` | Audited: ${execTools.length} tools |`,
    `| Core plugins | \`plugins/*/bakin-plugin.json\` | Active: ${corePlugins.length} plugin manifests |`,
    `| Settings | \`packages/core/src/settings.ts\` | Active: ${settings.length} flattened settings |`,
    '| Runtime paths | `packages/core/src/content-dir.ts` | Active: documented path contract |',
    `| SDK exports | \`packages/sdk/package.json\` and barrel files | Audited: ${sdkExports.length} subpaths |`,
    '| Agent package kinds | `packages/core/src/agent-packages/manifest.ts` | Active: agent, skill-pack, workflow-pack, knowledge-pack |',
    `| Tested snippets | \`docs/snippets\` | Active: ${docsSnippetFiles.length} required fixtures |`,
    `| LLM docs | \`docs/public/llms*\` | Active: ${llmBundleFiles.length} public bundles |`,
    '',
    '## Launch Gates',
    '',
    'These generated surfaces are in CI through `bun run docs:check`:',
    '',
    '- generated docs and LLM bundles exist',
    '- Markdown pages have title and description frontmatter',
    '- required snippet fixtures exist',
    '- snippet JSON parses cleanly',
    '- the Starlight site builds with Pagefind search and sitemap output',
    '',
    '## Remaining Contract Debt',
    '',
    'The current generated docs distinguish active structured metadata from audited source scans. Audited surfaces are public enough to document, but still need stronger contract objects before they should be considered final:',
    '',
    '- hooks need explicit kind, schemas, examples, visibility, and stability',
    '- exec/MCP tools need explicit metadata and output shape coverage',
    '- plugin routes should use the same route metadata helpers as core routes',
    '- SDK exports need complete TSDoc and stability annotations',
    '',
    generatedPageNote('scripts/docs/generate.ts', 'Maintainer-only launch coverage and CI comparison output.'),
    '',
  ].join('\n')
}

writeStableFile(
  join(generatedRoot, 'coverage.json'),
  JSON.stringify(buildCoverageReport(), null, 2),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/cli.md'),
  renderCliReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/api.md'),
  renderApiReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/hooks.md'),
  renderHookReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/exec-tools.md'),
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

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/coverage.md'),
  renderCoverageReference(),
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

- Core workflows: ${docsUrl}/core/tasks/
  Use this for built-in Bakin areas such as tasks, workflows, assets, schedule, memory, models, team, and health. Official add-on plugins such as Messaging and Projects are installed separately but documented in the same site.

- Plugin authoring: ${docsUrl}/extend/plugins/overview/
  Use this when building Bakin plugins with @bakin/sdk.

- Agent authoring: ${docsUrl}/extend/agents/overview/
  Use this when creating agent packages or writing instructions for coding agents working with Bakin.

- SDK docs: ${docsUrl}/extend/sdk/overview/
  Use this for @bakin/sdk imports, UI components, hooks, slots, and public extension contracts.

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
- Use \`@bakin/sdk/*\` imports for plugin-facing code.
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
    body: 'Use `@bakin/sdk/*` for plugin code. Public plugin examples must be backed by tested snippets. Public hooks, slots, routes, settings, and exec/MCP tools require metadata, schemas, examples, visibility, and stability before launch.',
  },
  'agent-authoring.md': {
    title: 'Bakin Agent Authoring',
    body: 'Agent-facing docs are explicit and labeled. Explain runtime-specific concepts only when a package depends on them. Agent package examples must be validated before publication.',
  },
  'api.md': {
    title: 'Bakin API Reference',
    body: 'HTTP API docs are generated from docs-aware route definitions. Public inputs are validated with Zod at runtime. Structured outputs are validated in tests, docs generation, or development checks where practical.',
  },
  'cli.md': {
    title: 'Bakin CLI Reference',
    body: `The CLI reference is generated from src/core/cli/registry.ts. Current public command count: ${CLI_COMMANDS.length}. Help output and generated docs use the same registry.`,
  },
  'hooks.md': {
    title: 'Bakin Hook Reference',
    body: `The hook reference currently comes from source audit. Current hook registration count: ${extractHookRegistrations().length}. Public hooks should migrate to explicit contract objects with kind, schemas, examples, visibility, and stability.`,
  },
  'exec-tools.md': {
    title: 'Bakin Exec and MCP Tools',
    body: `The exec/MCP tool reference currently comes from source audit. Current tool registration count: ${extractExecTools().length}. Public tools should migrate to explicit contract objects with schemas, examples, visibility, and stability.`,
  },
  'core-plugins.md': {
    title: 'Bakin Core Plugins',
    body: `The core plugin catalog is generated from shipped plugin manifests. Current core plugin count: ${readCorePluginManifests().length}. Public docs should pair this generated catalog with human-authored workflow pages for each plugin.`,
  },
  'settings.md': {
    title: 'Bakin Settings Reference',
    body: `The settings reference is generated from packages/core/src/settings.ts. Current flattened setting count: ${flattenObject(DEFAULT_SETTINGS).length}. Operators can override settings in settings.json under the resolved Bakin home directory.`,
  },
  'sdk-reference.md': {
    title: 'Bakin SDK Reference',
    body: `The SDK reference is currently generated from packages/sdk/package.json and SDK barrel files. Current SDK subpath count: ${readSdkExports().length}. Full TypeDoc output and TSDoc coverage checks are still required before public launch.`,
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
