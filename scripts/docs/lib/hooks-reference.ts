/**
 * Docs generator — hooks reference.
 *
 * Renders the hooks.mdx audit page (HookCard wrappers) and the hooks.md LLM
 * bundle from the source-scanned hook registrations. Owns the per-namespace
 * group descriptions + the curated example payloads.
 */
import { escapeHtml, generatedPageNote } from './doc-utils'
import { extractHookRegistrations } from './source-extraction'

export type HookRegistration = ReturnType<typeof extractHookRegistrations>[number]

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

export function renderHookLlmReference(): string {
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

export function renderHookReference(): string {
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
