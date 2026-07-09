/**
 * Docs generator — CLI reference.
 *
 * Parses each registry CliCommand's usage tokens (arguments / options /
 * choices) and renders the per-command blocks + the full grouped CLI reference
 * page. Pure over CLI_COMMANDS; output is written by the orchestrator.
 */
import { CLI_COMMANDS } from '../../../src/core/cli/registry'
import { escapeHtml, generatedPageNote } from './doc-utils'

export type CliCommand = typeof CLI_COMMANDS[number]

const cliQuickLinks: Record<string, string> = {
  start: 'bakin start',
  onboard: 'bakin onboard',
  doctor: 'bakin doctor',
  'tasks list': 'bakin tasks list',
  'tasks create': 'bakin tasks create <title>',
  'plugins install': 'bakin plugins install <source>',
  search: 'bakin search <query>',
}

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
    matches: (command) => ['agents install', 'agents orphan', 'agents delete', 'agents remove', 'agents update', 'agents lessons'].includes(command.name) || command.name.startsWith('packages '),
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

export function parseCliUsage(command: CliCommand): Array<{ token: string; displayToken: string; choices: string[]; kind: 'argument' | 'option' | 'choice'; required: boolean; description: string }> {
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

export function displayCliPartToken(token: string, kind: 'argument' | 'option' | 'choice', required: boolean, optional: boolean): string {
  if (kind !== 'choice') return `${optional ? '[' : ''}${required ? '<' : ''}${token}${required ? '>' : ''}${optional ? ']' : ''}`
  const labels: Record<string, string> = {
    'runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all': 'target',
    'search|search-models|plugin-assets|agent-assets|recommended-plugins': 'component',
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

export function describeCliPart(token: string, kind: 'argument' | 'option' | 'choice', required: boolean): string {
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
    'search|search-models|plugin-assets|agent-assets|recommended-plugins': 'Install target.',
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
    '--delete': 'Delete the runtime agent too.',
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

export function renderCliCommandBlock(command: CliCommand): string {
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

export function renderCliReference(): string {
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
