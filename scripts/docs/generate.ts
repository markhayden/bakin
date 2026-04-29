import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { renderExecToolsSnippet } from './source-scan'
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
const sourceRoots = [join(repoRoot, 'plugins'), join(repoRoot, 'src'), join(repoRoot, 'packages')]
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

function walkFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.astro') continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walkFiles(path, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path)
  }
  return files
}

function relativeSource(path: string): string {
  return path.replace(repoRoot, '').replace(/^\//, '')
}

function docsPath(path: string): string {
  return `${docsBasePath}${path.startsWith('/') ? path : `/${path}`}`
}

function renderCommandSnippet(marker: string): string {
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
    lines.push(`| \`${command.usage}\` | ${command.summary} |`)
  }

  lines.push('<!-- /docs:cli-commands -->')
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
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8')
    const next = text
      .replace(commandMarkerPattern, (_match, marker: string) => renderCommandSnippet(marker))
      .replace(snippetMarkerPattern, (_match, marker: string) => renderDocsSnippetBlock(marker))
      .replace(execToolsMarkerPattern, (_match, marker: string) => renderExecToolsSnippet(marker))
    if (next !== text) writeStableFile(file, next)
  }
}

function sourceFiles(): string[] {
  return sourceRoots.flatMap(root => walkFiles(root))
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

function extractExecTools(): Array<{ name: string; description?: string; file: string; line: number }> {
  const tools: Array<{ name: string; description?: string; file: string; line: number }> = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('registerExecTool')) continue
      const block = lines.slice(i, Math.min(lines.length, i + 35)).join('\n')
      const name = block.match(/name:\s*['"`]([^'"`]+)['"`]/)?.[1]
      if (!name) continue
      const description = block.match(/description:\s*['"`]([^'"`]+)['"`]/)?.[1]
      tools.push({ name, description, file: relativeSource(file), line: i + 1 })
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
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

function renderCliReference(): string {
  const grouped = new Map<string, typeof CLI_COMMANDS[number][]>()
  for (const command of CLI_COMMANDS) {
    const group = command.group ?? 'Commands'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(command)
  }

  const lines = [
    '---',
    'title: CLI Reference',
    'description: Generated reference for public Bakin CLI commands.',
    '---',
    '',
    '# CLI Reference',
    '',
    versionLine,
    '',
    'This page is generated from `src/core/cli/registry.ts`.',
    '',
  ]

  for (const [group, commands] of grouped) {
    lines.push(`## ${group}`, '')
    for (const command of commands) {
      lines.push(`### \`${command.usage}\``, '')
      lines.push(command.description, '')
      lines.push(`- Visibility: \`${command.visibility}\``)
      lines.push(`- Stability: \`${command.stability}\``)
      if (command.aliases?.length) lines.push(`- Aliases: ${command.aliases.map(a => `\`${a}\``).join(', ')}`)
      if (command.examples?.length) {
        lines.push('', 'Example:', '')
        const example = command.examples[0]
        if (example.code) {
          lines.push('```sh', example.code, '```', '')
        }
        lines.push(`Example test mode: \`${example.test ?? 'unspecified'}\``)
        if (example.reason) lines.push(`Reason: ${example.reason}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderApiReference(): string {
  const routes = getAllRoutes()
  const grouped = new Map<string, typeof routes>()
  for (const route of routes) {
    if (!grouped.has(route.pluginId)) grouped.set(route.pluginId, [])
    grouped.get(route.pluginId)!.push(route)
  }

  const lines = [
    '---',
    'title: API Reference',
    'description: Generated reference for documented Bakin HTTP API routes.',
    '---',
    '',
    '# API Reference',
    '',
    versionLine,
    '',
    'This page is generated from `src/core/api-docs.ts` and runtime route registration metadata.',
    '',
  ]

  for (const [pluginId, pluginRoutes] of grouped) {
    lines.push(`## ${pluginId === 'core' ? 'Core Routes' : `Plugin: ${pluginId}`}`, '')
    for (const route of pluginRoutes) {
      lines.push(`### \`${route.method} ${route.fullPath}\``, '')
      lines.push(route.summary, '')
      if (route.description) lines.push(route.description, '')
      if (route.params) lines.push(`Parameters: \`${route.params}\``, '')
      lines.push(`- Visibility: \`${route.visibility}\``)
      lines.push(`- Stability: \`${route.stability}\``)
      if (route.permissions?.length) lines.push(`- Permissions: ${route.permissions.map(p => `\`${p}\``).join(', ')}`)
      lines.push('')
    }
  }

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
    '# Hook Reference',
    '',
    versionLine,
    '',
    'This page is generated by source audit. The next contract pass will replace audited hook entries with explicit `defineHookContract(...)` metadata.',
    '',
  ]

  for (const hook of hooks) {
    lines.push(`## \`${hook.name}\``, '')
    lines.push(`Source: \`${hook.file}:${hook.line}\``, '')
    lines.push('- Visibility: `public` until explicitly marked otherwise')
    lines.push('- Stability: `beta` until a hook contract declares stability')
    lines.push('- Contract status: `audited`', '')
  }

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
    '# Exec and MCP Tool Reference',
    '',
    versionLine,
    '',
    'This page is generated by source audit. The next contract pass will replace audited tool entries with explicit metadata and schemas.',
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
    '# Core Plugin Catalog',
    '',
    versionLine,
    '',
    'This page is generated from `plugins/*/bakin-plugin.json` manifests.',
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
    '# Settings Reference',
    '',
    versionLine,
    '',
    'This page is generated from `packages/core/src/settings.ts`.',
    '',
    'Bakin reads settings from `settings.json` in the resolved Bakin home directory and deep-merges user values over these defaults.',
    '',
    '| Key | Default |',
    '| --- | --- |',
  ]
  for (const setting of settings) {
    lines.push(`| \`${setting.key}\` | \`${JSON.stringify(setting.value)}\` |`)
  }
  lines.push('')
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
    '# Runtime Paths',
    '',
    versionLine,
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
  lines.push('')
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
    '# SDK Reference',
    '',
    versionLine,
    '',
    'This page is generated from `packages/sdk/package.json` and SDK barrel files. Full TypeDoc output will replace this audit view once public TSDoc coverage is complete.',
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

  return `---
title: Generated Coverage
description: Coverage report for generated Bakin documentation surfaces.
---

# Generated Coverage

${versionLine}

This page is generated by \`scripts/docs/generate.ts\`. It exists to make launch coverage visible and to give CI a stable place to compare generated documentation output.

| Surface | Source | Status |
| --- | --- | --- |
| CLI commands | \`src/core/cli/registry.ts\` | Active: ${CLI_COMMANDS.length} commands, ${cliExampleCount} examples |
| HTTP routes | \`src/core/api-docs.ts\` and route metadata | Active: ${routes.length} routes, ${routeInputSchemaCount} input schemas, ${routeOutputSchemaCount} output schemas, ${routeExampleCount} routes with examples |
| Plugin routes | Runtime route registration metadata | Partial: ${routes.filter(route => route.pluginId !== 'core').length} documented plugin routes |
| Hooks | Source scan for \`hooks.register(...)\` | Audited: ${hooks.length} registrations |
| Slots | SDK slot contract plus source scan | Documented: ${publicSlotNames.length} public slot names, ${slots.length} audited registrations |
| Exec/MCP tools | Source scan for \`registerExecTool(...)\` | Audited: ${execTools.length} tools |
| Core plugins | \`plugins/*/bakin-plugin.json\` | Active: ${corePlugins.length} plugin manifests |
| Settings | \`packages/core/src/settings.ts\` | Active: ${settings.length} flattened settings |
| Runtime paths | \`packages/core/src/content-dir.ts\` | Active: documented path contract |
| SDK exports | \`packages/sdk/package.json\` and barrel files | Audited: ${sdkExports.length} subpaths |
| Agent package kinds | \`packages/core/src/agent-packages/manifest.ts\` | Active: agent, skill-pack, workflow-pack, knowledge-pack |
| Tested snippets | \`docs/snippets\` | Active: ${docsSnippetFiles.length} required fixtures |
| LLM docs | \`docs/public/llms*\` | Active: ${llmBundleFiles.length} public bundles |

## Launch Gates

These generated surfaces are in CI through \`bun run docs:check\`:

- generated docs and LLM bundles exist
- Markdown pages have title and description frontmatter
- required snippet fixtures exist
- snippet JSON parses cleanly
- the Starlight site builds with Pagefind search and sitemap output

## Remaining Contract Debt

The current generated docs distinguish active structured metadata from audited source scans. Audited surfaces are public enough to document, but still need stronger contract objects before they should be considered final:

- hooks need explicit kind, schemas, examples, visibility, and stability
- exec/MCP tools need explicit metadata and output shape coverage
- plugin routes should use the same route metadata helpers as core routes
- SDK exports need complete TSDoc and stability annotations
`
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
