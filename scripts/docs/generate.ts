import { readdirSync, readFileSync } from 'node:fs'
import {
  extractExecTools,
  extractPluginSettings,
  getApiRoutes,
  getCliCommands,
  renderExecToolsSnippet,
} from './source-scan'
import { join } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import { getAllRoutes } from '../../src/core/api-docs'
import { PERMISSION_DESCRIPTIONS, PermissionSchema } from '../../packages/core/src/plugins/permissions'
import {
  docsBasePath, writeStableFile, docsPath, escapeHtml,
  escapeTableCell, generatedPageNote, flattenObject,
} from './lib/doc-utils'
import { renderCliReference } from './lib/cli-reference'
import { OpenApiOperation, curlForOperation, renderApiReference } from './lib/api-reference'
import {
  extractHookRegistrations,
  extractSlotRegistrations,
  readCorePluginManifests,
  readOfficialPluginCatalog,
} from './lib/source-extraction'
import { readSdkExports, renderSdkReference } from './lib/sdk-reference'
import { renderHookLlmReference, renderHookReference } from './lib/hooks-reference'
import { renderExecToolReference, renderMcpLlmReference } from './lib/mcp-reference'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'docs')
const generatedRoot = join(docsRoot, '.generated')
const docsOrigin = 'https://makinbakin.com'
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
