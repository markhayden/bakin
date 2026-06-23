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
  escapeTableCell, escapeMarkdownTableCell, generatedPageNote, flattenObject,
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
  'assets.getAssetTypes': {},
  'assets.resolveServe': { segments: ['20260401-hero-a1b2c3d4', 'thumb'] },
  'assets.purgeClipboardForTask': { taskId: 'task-123' },
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
