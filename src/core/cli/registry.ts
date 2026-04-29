import { defineCliCommandContract, type CliCommandContract } from '../../../packages/core/src/docs'

type CliDef = CliCommandContract

function cli(def: Omit<CliDef, 'kind' | 'visibility' | 'stability'> & Partial<Pick<CliDef, 'visibility' | 'stability'>>): CliDef {
  return defineCliCommandContract({
    kind: 'cli',
    visibility: 'public',
    stability: 'stable',
    ...def,
  })
}

export const CLI_COMMANDS = [
  cli({
    name: 'start',
    usage: 'bakin start',
    group: 'Lifecycle',
    summary: 'Start the Bakin server.',
    description: 'Starts the Bakin HTTP server and dashboard. This is the default command when the compiled binary is launched without arguments.',
    examples: [{ title: 'Start Bakin', code: 'bakin start', test: 'illustrative', reason: 'Starts a long-running server process.' }],
  }),
  cli({
    name: 'stop',
    usage: 'bakin stop',
    group: 'Lifecycle',
    summary: 'Stop a running Bakin server.',
    description: 'Finds a running Bakin process and sends SIGTERM.',
    examples: [{ title: 'Stop Bakin', code: 'bakin stop', test: 'illustrative', reason: 'Requires a running local server process.' }],
  }),
  cli({
    name: 'restart',
    usage: 'bakin restart',
    aliases: ['reboot'],
    group: 'Lifecycle',
    summary: 'Restart the Bakin server.',
    description: 'Restarts Bakin using the available service manager or standalone process behavior.',
    examples: [{ title: 'Restart Bakin', code: 'bakin restart', test: 'illustrative', reason: 'Requires a running local installation.' }],
  }),
  cli({
    name: 'status',
    usage: 'bakin status',
    group: 'Lifecycle',
    summary: 'Show dispatch and server status.',
    description: 'Prints local server reachability, dispatch interval, last run, next run, and version information where available.',
    examples: [{ title: 'Check status', code: 'bakin status', test: 'illustrative', reason: 'Requires a running local server for full output.' }],
  }),
  cli({
    name: 'dev',
    usage: 'bakin dev',
    group: 'Lifecycle',
    summary: 'Run the source-tree development loop.',
    description: 'Runs Bakin in watch-mode development from a source checkout. The compiled binary refuses this command outside a repo clone.',
    examples: [{ title: 'Run development server', code: 'bakin dev', test: 'illustrative', reason: 'Starts a long-running development process.' }],
  }),
  cli({
    name: 'version',
    usage: 'bakin version',
    aliases: ['--version', '-v'],
    group: 'Lifecycle',
    summary: 'Print the Bakin version.',
    description: 'Prints the version embedded in the running CLI/binary.',
    examples: [{ title: 'Print version', code: 'bakin version', test: 'automated' }],
  }),
  cli({
    name: 'update',
    usage: 'bakin update',
    group: 'Lifecycle',
    summary: 'Replace the current binary with the latest release.',
    description: 'Downloads the latest release binary and verifies checksums before replacing the installed executable.',
    examples: [{ title: 'Self-update', code: 'bakin update', test: 'illustrative', reason: 'Downloads a release and mutates the installed binary.' }],
  }),
  cli({
    name: 'doctor',
    usage: 'bakin doctor',
    group: 'Lifecycle',
    summary: 'Run health checks.',
    description: 'Runs Bakin diagnostics for local dependencies, server state, agents, plugin assets, runtime behavior, and recoverable issues.',
    examples: [{ title: 'Run diagnostics', code: 'bakin doctor', test: 'illustrative', reason: 'Depends on local Bakin/runtime state.' }],
  }),

  cli({
    name: 'dispatch',
    usage: 'bakin dispatch',
    group: 'Tasks and workflows',
    summary: 'Trigger immediate task dispatch.',
    description: 'Asks the running Bakin server to run the task dispatch cycle immediately.',
    examples: [{ title: 'Dispatch now', code: 'bakin dispatch', test: 'illustrative', reason: 'Requires a running local server.' }],
  }),
  cli({ name: 'tasks list', usage: 'bakin tasks list [--column=<column>]', group: 'Tasks and workflows', summary: 'List tasks.', description: 'Lists tasks from the task board, optionally filtered by column.', examples: [{ title: 'List todo tasks', code: 'bakin tasks list --column=todo', test: 'illustrative', reason: 'Requires a running local server.' }] }),
  cli({ name: 'tasks get', usage: 'bakin tasks get <id>', group: 'Tasks and workflows', summary: 'Get task details.', description: 'Fetches one task by id from the running server.', examples: [{ title: 'Get a task', code: 'bakin tasks get task-123', test: 'illustrative', reason: 'Requires fixture server data.' }] }),
  cli({ name: 'tasks create', usage: 'bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow=<reason>]', group: 'Tasks and workflows', summary: 'Create a task.', description: 'Creates a task and optionally assigns an agent or workflow.', examples: [{ title: 'Create a task', code: 'bakin tasks create "Fix the docs" patch', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'tasks move', usage: 'bakin tasks move <id> <column>', group: 'Tasks and workflows', summary: 'Move a task.', description: 'Moves a task to a different board column.', examples: [{ title: 'Move a task', code: 'bakin tasks move task-123 done', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'tasks log', usage: 'bakin tasks log <id> <message>', group: 'Tasks and workflows', summary: 'Log task progress.', description: 'Adds a progress log entry to a task.', examples: [{ title: 'Log progress', code: 'bakin tasks log task-123 "Finished implementation"', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'tasks block', usage: 'bakin tasks block <id> <reason>', group: 'Tasks and workflows', summary: 'Block a task.', description: 'Marks a task blocked with a reason.', examples: [{ title: 'Block a task', code: 'bakin tasks block task-123 "Waiting on review"', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'tasks depend', usage: 'bakin tasks depend <id> <dependsOn>', group: 'Tasks and workflows', summary: 'Register a task dependency.', description: 'Sets a task dependency relationship.', examples: [{ title: 'Set dependency', code: 'bakin tasks depend task-123 task-100', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'tasks complete', usage: 'bakin tasks complete <id> <summary>', group: 'Tasks and workflows', summary: 'Complete a task.', description: 'Marks a task complete with a completion summary.', examples: [{ title: 'Complete a task', code: 'bakin tasks complete task-123 "Docs updated"', test: 'illustrative', reason: 'Mutates local task state.' }] }),
  cli({ name: 'workflows list', usage: 'bakin workflows list', group: 'Tasks and workflows', summary: 'List workflow definitions.', description: 'Lists available workflow definitions.', examples: [{ title: 'List workflows', code: 'bakin workflows list', test: 'illustrative', reason: 'Requires a running local server.' }] }),
  cli({ name: 'workflows start', usage: 'bakin workflows start <taskId> <workflowId>', group: 'Tasks and workflows', summary: 'Start a workflow.', description: 'Starts a workflow instance for a task.', examples: [{ title: 'Start workflow', code: 'bakin workflows start task-123 default', test: 'illustrative', reason: 'Mutates local workflow state.' }] }),
  cli({ name: 'workflows step', usage: 'bakin workflows step <taskId>', group: 'Tasks and workflows', summary: 'Get current workflow step.', description: 'Fetches current workflow step details for a task.', examples: [{ title: 'Show current step', code: 'bakin workflows step task-123', test: 'illustrative', reason: 'Requires workflow fixture state.' }] }),
  cli({ name: 'workflows submit', usage: 'bakin workflows submit <taskId> <stepId> <json>', group: 'Tasks and workflows', summary: 'Submit workflow step output.', description: 'Submits JSON output for a workflow step.', examples: [{ title: 'Submit output', code: 'bakin workflows submit task-123 step-1 \'{"ok":true}\'', test: 'schema' }] }),

  cli({ name: 'agents list', usage: 'bakin agents list [--packages]', group: 'Agents and packages', summary: 'List agents.', description: 'Lists runtime agents, or package state when `--packages` is set.', examples: [{ title: 'List agents', code: 'bakin agents list', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents status', usage: 'bakin agents status <id>', group: 'Agents and packages', summary: 'Get agent status.', description: 'Fetches detailed status for an agent.', examples: [{ title: 'Agent status', code: 'bakin agents status patch', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents tasks', usage: 'bakin agents tasks <id>', group: 'Agents and packages', summary: 'List tasks assigned to an agent.', description: 'Lists tasks currently assigned to an agent.', examples: [{ title: 'Agent tasks', code: 'bakin agents tasks patch', test: 'illustrative', reason: 'Requires running server data.' }] }),
  cli({ name: 'agents send', usage: 'bakin agents send <id> <message>', group: 'Agents and packages', summary: 'Send a message to an agent.', description: 'Sends a message through the running server to an agent.', examples: [{ title: 'Message an agent', code: 'bakin agents send patch "Check the build"', test: 'illustrative', reason: 'Requires a running agent runtime.' }] }),
  cli({ name: 'agents install', usage: 'bakin agents install <path|github:user/repo[@ref]> [--adopt] [--install-as <id>] [--replace]', group: 'Agents and packages', summary: 'Install an agent package.', description: 'Installs or adopts an agent package into Bakin/runtime-managed agent state.', examples: [{ title: 'Install local package', code: 'bakin agents install ./agent-package --install-as patch', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents remove', usage: 'bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--force]', group: 'Agents and packages', summary: 'Remove an agent package.', description: 'Removes an installed agent package and optionally deletes the runtime agent.', examples: [{ title: 'Remove package', code: 'bakin agents remove patch --keep-blocks', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents update', usage: 'bakin agents update [agent-id] [--refresh-template]', group: 'Agents and packages', summary: 'Update agent packages.', description: 'Updates one or all installed agent packages.', examples: [{ title: 'Update all agents', code: 'bakin agents update', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents knowledge', usage: 'bakin agents knowledge <list|enable|disable> ...', group: 'Agents and packages', summary: 'Manage agent knowledge toggles.', description: 'Lists or toggles lesson/knowledge blocks for an agent package.', examples: [{ title: 'List knowledge', code: 'bakin agents knowledge list patch', test: 'illustrative', reason: 'Depends on installed agent package state.' }] }),
  cli({ name: 'packages install', usage: 'bakin packages install <path|github:user/repo[@ref]> [--install-as <id>] [--replace]', group: 'Agents and packages', summary: 'Install a package.', description: 'Installs a standalone package.', examples: [{ title: 'Install package', code: 'bakin packages install ./package', test: 'illustrative', reason: 'Mutates local package state.' }] }),
  cli({ name: 'packages list', usage: 'bakin packages list', group: 'Agents and packages', summary: 'List packages.', description: 'Lists installed packages.', examples: [{ title: 'List packages', code: 'bakin packages list', test: 'illustrative', reason: 'Depends on local package state.' }] }),
  cli({ name: 'packages remove', usage: 'bakin packages remove <package-id> [--force] [--keep-blocks]', group: 'Agents and packages', summary: 'Remove a package.', description: 'Removes an installed package.', examples: [{ title: 'Remove package', code: 'bakin packages remove package-id', test: 'illustrative', reason: 'Mutates local package state.' }] }),
  cli({ name: 'packages update', usage: 'bakin packages update <package-id> [--refresh-template]', group: 'Agents and packages', summary: 'Update a package.', description: 'Updates an installed package.', examples: [{ title: 'Update package', code: 'bakin packages update package-id', test: 'illustrative', reason: 'Mutates local package state.' }] }),

  cli({ name: 'plugins list', usage: 'bakin plugins list [--check]', group: 'Plugins', summary: 'List installed plugins.', description: 'Lists installed plugins and versions. Pass --check to probe remote/source for available upgrades.', examples: [{ title: 'List plugins', code: 'bakin plugins list', test: 'illustrative', reason: 'Requires local server/plugin state.' }] }),
  cli({ name: 'plugins install', usage: 'bakin plugins install [--dev] <path|github:user/repo[@ref][#subpath]> [--ref <ref>] [--yes] [--force]', group: 'Plugins', summary: 'Install a plugin.', description: 'Installs a plugin from a local path or GitHub source. Append #subpath to install from a monorepo directory, or pin a GitHub install with @ref / --ref. --dev symlinks a local source tree for live development. --yes skips the consent prompt. --force replaces an existing install when used with --dev.', examples: [{ title: 'Install local plugin for development', code: 'bakin plugins install --dev ./my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }, { title: 'Install a pinned official plugin', code: 'bakin plugins install github:madeinwyo/bakin-bits-official#plugins/messaging --ref messaging-v1.0.0', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins upgrade', usage: 'bakin plugins upgrade <id> [--yes]', group: 'Plugins', summary: 'Upgrade a user plugin.', description: 'Re-pulls a user plugin from its source and rebuilds. --yes skips the consent prompt.', examples: [{ title: 'Upgrade plugin', code: 'bakin plugins upgrade my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins remove', usage: 'bakin plugins remove <id>', group: 'Plugins', summary: 'Remove a plugin.', description: 'Removes an installed non-core plugin.', examples: [{ title: 'Remove plugin', code: 'bakin plugins remove my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins scaffold', usage: 'bakin plugins scaffold <name>', group: 'Plugins', summary: 'Create a plugin scaffold.', description: 'Creates a starter plugin source tree.', examples: [{ title: 'Scaffold plugin', code: 'bakin plugins scaffold my-plugin', test: 'illustrative', reason: 'Writes a new plugin directory.' }] }),
  cli({ name: 'plugins link', usage: 'bakin plugins link <localPath> [--force]', group: 'Plugins', summary: 'Symlink a local plugin source tree for dev mode.', description: 'Registers a local source tree as a developer-mode plugin via a symlink at ~/.bakin/plugins/<id>/. Used with the hot-reload coordinator. --force overrides id collisions with copied installs or core plugins, but already-linked plugins must be unlinked first.', examples: [{ title: 'Link a local plugin', code: 'bakin plugins link ./my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins unlink', usage: 'bakin plugins unlink <id>', group: 'Plugins', summary: 'Remove a linked plugin symlink.', description: 'Removes the dev-mode symlink and lockfile entry. Refuses installed (non-linked) plugins — use `bakin plugins remove` for those.', examples: [{ title: 'Unlink a plugin', code: 'bakin plugins unlink my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),

  cli({ name: 'settings get', usage: 'bakin settings get [key]', group: 'Setup and config', summary: 'Read settings.', description: 'Reads all settings or one dot-notation key.', examples: [{ title: 'Read settings', code: 'bakin settings get dispatch.intervalMin', test: 'illustrative', reason: 'Depends on local settings state.' }] }),
  cli({ name: 'settings set', usage: 'bakin settings set <key> <value>', group: 'Setup and config', summary: 'Update a setting.', description: 'Updates one setting using dot notation.', examples: [{ title: 'Update setting', code: 'bakin settings set dispatch.intervalMin 5', test: 'illustrative', reason: 'Mutates local settings.' }] }),
  cli({ name: 'settings init', usage: 'bakin settings init', group: 'Setup and config', summary: 'Seed default settings.', description: 'Creates default settings if missing.', examples: [{ title: 'Initialize settings', code: 'bakin settings init', test: 'illustrative', reason: 'Writes local settings state.' }] }),
  cli({ name: 'setup service', usage: 'bakin setup service [--uninstall]', group: 'Setup and config', summary: 'Install or remove macOS service integration.', description: 'Installs or removes the LaunchAgent used for auto-start behavior on macOS.', examples: [{ title: 'Install service', code: 'bakin setup service', test: 'illustrative', reason: 'Mutates host service configuration.' }] }),
  cli({ name: 'mkdir', usage: 'bakin mkdir', group: 'Setup and config', summary: 'Create the Bakin home directory tree.', description: 'Creates or verifies the `~/.bakin` directory tree.', examples: [{ title: 'Create directories', code: 'bakin mkdir', test: 'illustrative', reason: 'Writes local home directory state.' }] }),
  cli({ name: 'check', usage: 'bakin check <runtime|search|search-models|llm|channels|plugin-assets|agent-assets|recommended-plugins|all>', group: 'Setup and config', summary: 'Run onboarding checks.', description: 'Runs one or all first-run readiness checks.', examples: [{ title: 'Run all checks', code: 'bakin check all', test: 'illustrative', reason: 'Depends on local environment.' }] }),
  cli({ name: 'install', usage: 'bakin install <search|search-models|mcporter|plugin-assets|agent-assets|recommended-plugins>', group: 'Setup and config', summary: 'Install onboarding components.', description: 'Installs Bakin dependencies, plugin/agent assets, or official recommended plugins.', examples: [{ title: 'Install mcporter', code: 'bakin install mcporter', test: 'illustrative', reason: 'Downloads or mutates local dependencies.' }] }),
  cli({ name: 'onboard', usage: 'bakin onboard [--check] [--yes] [--json] [--force]', group: 'Setup and config', summary: 'Run first-time onboarding.', description: 'Runs the full first-run setup flow.', examples: [{ title: 'Scripted onboarding', code: 'bakin onboard --yes --json', test: 'illustrative', reason: 'Writes local state and may install dependencies.' }] }),
  cli({ name: 'paths', usage: 'bakin paths [key]', group: 'Setup and config', summary: 'Show content directory paths.', description: 'Prints Bakin runtime paths, optionally for one key.', examples: [{ title: 'Show paths', code: 'bakin paths', test: 'illustrative', reason: 'Depends on local Bakin home settings.' }] }),
  cli({ name: 'agent-rules', usage: 'bakin agent-rules [--apply|--check|--apply-all|--check-all]', group: 'Setup and config', summary: 'Manage orchestrator rules blocks.', description: 'Applies or checks managed AGENTS.md rule blocks.', examples: [{ title: 'Check rules', code: 'bakin agent-rules --check', test: 'illustrative', reason: 'Depends on local agent files.' }] }),

  cli({ name: 'schedule', usage: 'bakin schedule [list|add|pause|resume|remove|run|runs] ...', group: 'Schedule', summary: 'Manage scheduled jobs.', description: 'Lists, creates, pauses, resumes, removes, triggers, or inspects scheduled jobs.', examples: [{ title: 'List scheduled jobs', code: 'bakin schedule list', test: 'illustrative', reason: 'Requires running server data.' }] }),

  cli({ name: 'logs', usage: 'bakin logs [filter]', group: 'Assets and search', summary: 'Tail audit logs.', description: 'Prints audit log entries, optionally filtered by event type or agent.', examples: [{ title: 'Show MCP logs', code: 'bakin logs mcp', test: 'illustrative', reason: 'Depends on local log files.' }] }),
  cli({ name: 'reindex', usage: 'bakin reindex [--table=<name>] [--rebuild]', group: 'Assets and search', summary: 'Reindex content.', description: 'Triggers content indexing through the search adapter.', examples: [{ title: 'Reindex tasks', code: 'bakin reindex --table=tasks', test: 'illustrative', reason: 'Requires local search/server state.' }] }),
  cli({ name: 'docs', usage: 'bakin docs', group: 'Assets and search', summary: 'Print API documentation from the running server.', description: 'Fetches current API route documentation from `/api/docs`.', examples: [{ title: 'Print API docs', code: 'bakin docs', test: 'illustrative', reason: 'Requires a running local server.' }] }),
  cli({ name: 'search', usage: 'bakin search <query> [--table=<name>] [--agent=<id>] [--limit=<n>] [--facets=<list>]', group: 'Assets and search', summary: 'Search indexed content.', description: 'Searches indexed Bakin content.', examples: [{ title: 'Search tasks', code: 'bakin search "blocked task" --table=tasks --limit=5', test: 'illustrative', reason: 'Requires indexed local content.' }] }),
  cli({ name: 'search:stats', usage: 'bakin search:stats', group: 'Assets and search', summary: 'Show search index stats.', description: 'Prints registered search table/index health and counts.', examples: [{ title: 'Show search stats', code: 'bakin search:stats', test: 'illustrative', reason: 'Requires local search state.' }] }),
  cli({ name: 'trash', usage: 'bakin trash [list|restore|empty] ...', group: 'Assets and search', summary: 'Manage trashed assets.', description: 'Lists, restores, or permanently empties soft-deleted assets.', examples: [{ title: 'List trash', code: 'bakin trash list', test: 'illustrative', reason: 'Depends on local asset state.' }] }),
] as const satisfies readonly CliDef[]

export function renderCliUsage(env: { bakinUrl?: string } = {}): string {
  const grouped = new Map<string, CliDef[]>()
  for (const command of CLI_COMMANDS) {
    const group = command.group ?? 'Commands'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(command)
  }

  const lines = ['Usage: bakin <command> [options]', '']
  for (const [group, commands] of grouped) {
    lines.push(`${group}:`)
    for (const command of commands) {
      lines.push(`  ${command.usage.padEnd(58)} ${command.summary}`)
    }
    lines.push('')
  }

  lines.push('Environment:')
  lines.push(`  BAKIN_URL${' '.repeat(18)}Base URL for the running server (default: ${env.bakinUrl ?? 'http://localhost:3737'})`)
  lines.push(`  BAKIN_HOME${' '.repeat(17)}Override for ~/.bakin`)
  lines.push(`  PORT${' '.repeat(23)}Port to bind when \`start\` launches (default: 3737)`)
  return lines.join('\n')
}
