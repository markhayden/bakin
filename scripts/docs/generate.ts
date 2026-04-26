import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import { getAllRoutes } from '../../src/core/api-docs'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'apps/docs')
const sourceRoots = [join(repoRoot, 'plugins'), join(repoRoot, 'src'), join(repoRoot, 'packages')]

function writeStableFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents.trimEnd() + '\n', 'utf8')
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

function flattenObject(value: unknown, prefix = ''): Array<{ key: string; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ key: prefix, value }]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) return flattenObject(child, next)
    return [{ key: next, value: child }]
  })
}

const versionLine = `Docs version: Bakin ${APP_VERSION}`

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
    ['projects', 'Project markdown/content data.'],
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
    '2. `CONTENT_DIR` compatibility environment variable.',
    '3. `~/.bakin/` when it exists.',
    '4. `./content/` fallback.',
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
  join(docsRoot, 'src/content/docs/reference/generated/coverage.md'),
  `---
title: Generated Coverage
description: Coverage report for generated Bakin documentation surfaces.
---

# Generated Coverage

${versionLine}

This page is generated by \`scripts/docs/generate.ts\`.

The current scaffold establishes the public coverage contract. The next implementation pass will replace this summary with inventories for CLI commands, HTTP routes, plugin routes, hooks, slots, SDK exports, settings, exec/MCP tools, agent package contracts, snippets, and LLM bundles.

| Surface | Launch requirement | Current status |
| --- | --- | --- |
| CLI commands | Structured registry, examples, docs metadata | Active: ${CLI_COMMANDS.length} commands |
| HTTP routes | Zod input schemas, examples, visibility, stability | Active: ${getAllRoutes().length} documented routes |
| Plugin routes | Same contract as HTTP routes | Planned |
| Hooks | Contract objects, kind, schemas, examples | Audited: ${extractHookRegistrations().length} registrations |
| Slots | Contract objects, props, examples | Planned |
| SDK exports | TypeDoc, TSDoc, stability | Planned |
| Examples | External fixtures, tested or explicitly illustrative | Planned |
| LLM docs | \`/llms.txt\`, \`/llms-full.txt\`, targeted bundles | Active |
| Exec/MCP tools | Contract objects, schemas, examples | Audited: ${extractExecTools().length} registrations |
| Core plugins | Manifest catalog from shipped plugins | Active: ${readCorePluginManifests().length} plugins |
| Settings | Generated from default settings | Active: ${flattenObject(DEFAULT_SETTINGS).length} settings |
| Runtime paths | Generated from path contract | Active |
`,
)

writeStableFile(
  join(docsRoot, 'public/llms.txt'),
  `# Bakin Docs

${versionLine}

Bakin is a self-hosted dashboard, backend, CLI, and extension system for running agent work with OpenClaw. Use these docs to install Bakin, operate it, build plugins, author agent packages, and understand the public contracts exposed by the SDK, hooks, slots, CLI, and HTTP API.

Primary docs:

- Start: https://docs.makinbakin.com/start/overview/
  Use this to understand what Bakin is and where to begin.

- Install Bakin: https://docs.makinbakin.com/run/install/
  Use this for the released one-line install path and platform notes.

- Run Bakin: https://docs.makinbakin.com/run/operation/
  Use this for lifecycle commands, health checks, updates, and runtime operation.

- Plugin authoring: https://docs.makinbakin.com/extend/plugins/overview/
  Use this when building Bakin plugins with @bakin/sdk.

- Agent authoring: https://docs.makinbakin.com/extend/agents/overview/
  Use this when creating agent packages or writing instructions for coding agents working with Bakin.

- SDK docs: https://docs.makinbakin.com/extend/sdk/overview/
  Use this for @bakin/sdk imports, UI components, hooks, slots, and public extension contracts.

LLM bundles:

- Full context: https://docs.makinbakin.com/llms-full.txt
- Plugin authoring bundle: https://docs.makinbakin.com/llms/plugin-authoring.md
- Agent authoring bundle: https://docs.makinbakin.com/llms/agent-authoring.md
- SDK reference bundle: https://docs.makinbakin.com/llms/sdk-reference.md
- API reference bundle: https://docs.makinbakin.com/llms/api.md
`,
)

writeStableFile(
  join(docsRoot, 'public/llms-full.txt'),
  `# Bakin Full LLM Context

${versionLine}

Audience: coding agents, plugin authors, agent authors, and technical operators.

Canonical docs: https://docs.makinbakin.com/

## Operating Rules

- Use \`Bakin\` for the product and \`bakin\` for the CLI.
- Prefer the released one-line installer for end-user install instructions.
- Use \`@bakin/sdk/*\` imports for plugin-facing code.
- Do not import host internals or another plugin's internals from a plugin.
- Treat public hooks, slots, CLI commands, HTTP routes, settings, and SDK exports as documented contracts.
- Prefer tested docs snippets and generated reference over guessing APIs.

## Useful Bundles

- Plugin authoring: /llms/plugin-authoring.md
- Agent authoring: /llms/agent-authoring.md
- SDK reference: /llms/sdk-reference.md
- API reference: /llms/api.md
- CLI reference: /reference/generated/cli/
- API reference: /reference/generated/api/
- Hooks reference: /reference/generated/hooks/
- Exec/MCP tools reference: /reference/generated/exec-tools/
- Core plugin catalog: /reference/generated/core-plugins/
- Settings reference: /reference/generated/settings/
- Runtime paths: /reference/generated/runtime-paths/

## Fetch Examples

\`\`\`sh
curl -fsSL https://docs.makinbakin.com/llms/plugin-authoring.md
curl -fsSL https://docs.makinbakin.com/llms/agent-authoring.md
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
    body: 'Agent-facing docs are explicit and labeled. Explain only the OpenClaw concepts needed to use Bakin, then link to OpenClaw for deeper details. Agent package examples must be validated before publication.',
  },
  'sdk-reference.md': {
    title: 'Bakin SDK Reference',
    body: 'The SDK reference is generated from `@bakin/sdk/*` exports with TypeDoc and custom usage pages. Every public SDK export requires TSDoc and stability metadata before launch.',
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
}

for (const [file, { title, body }] of Object.entries(bundles)) {
  writeStableFile(
    join(docsRoot, 'public/llms', file),
    `# ${title}

${versionLine}

Audience: coding agents and technical authors.

Canonical docs: https://docs.makinbakin.com/

${body}
`,
  )
}

console.log('Generated docs scaffolding artifacts')
