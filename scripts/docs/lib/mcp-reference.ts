/**
 * Docs generator — MCP/exec-tool reference.
 *
 * Renders the exec-tools.mdx audit page (McpToolCard wrappers) and the
 * exec-tools.md LLM bundle from the source-scanned exec tool definitions.
 * Owns the per-namespace group descriptions + the mcporter call examples.
 */
import { escapeHtml, escapeMarkdownTableCell, generatedPageNote } from './doc-utils'
import { extractExecTools } from '../source-scan'

export type ExecToolDoc = ReturnType<typeof extractExecTools>[number]

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

export function renderMcpLlmReference(): string {
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

export function renderExecToolReference(): string {
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
