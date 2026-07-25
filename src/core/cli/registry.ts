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
    name: 'serve',
    usage: 'bakin serve',
    visibility: 'internal',
    group: 'Lifecycle',
    summary: 'Run the Bakin server in the foreground.',
    description: 'Foreground server entrypoint for service managers and process supervisors. Humans should use `bakin start`.',
    examples: [{ title: 'Run under a supervisor', code: 'bakin serve', test: 'illustrative', reason: 'Starts a long-running server process.' }],
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
    name: 'runtime',
    usage: 'bakin runtime [use <openclaw|pi>] [--dry-run] [--no-copy-workspaces]',
    group: 'Lifecycle',
    summary: 'Show the runtime capability report or switch runtime adapters.',
    description: 'Without arguments, prints the active runtime adapter and its capability report (native/shimmed/unavailable per capability, tool-access status). `bakin runtime use <adapter>` runs the orchestrated switch: settings backup, tool-access deprovision/provision, roster carry-over with model + subagent-model mapping and an honest unmapped report, workspace content carry for switch-created agents (soul/memory verbatim, agent-authored skills to the target\'s skill location; `--no-copy-workspaces` opts out), honest stays-behind lines (channels, runtime crons, session context, provider config) plus the target\'s credential status, and drift-gated agent re-projection. `--dry-run` previews the entire report with zero writes. A completed switch requires `bakin restart` so plugins rebind.',
    examples: [
      { title: 'Show the capability report', code: 'bakin runtime', test: 'illustrative', reason: 'Requires a running local server.' },
      { title: 'Preview a switch (zero writes)', code: 'bakin runtime use pi --dry-run', test: 'illustrative', reason: 'Requires a running local server.' },
      { title: 'Switch to the Pi runtime', code: 'bakin runtime use pi', test: 'illustrative', reason: 'Mutates settings and runtime state; requires a restart.' },
    ],
  }),
  cli({
    name: 'dev',
    usage: 'bakin dev [--verbose] [--no-color]',
    group: 'Lifecycle',
    summary: 'Run the source-tree development loop.',
    description: 'Runs Bakin in watch-mode development from a source checkout. By default output is compact; use --verbose for raw child-process output and debug logs.',
    examples: [{ title: 'Run development server', code: 'bakin dev --verbose', test: 'illustrative', reason: 'Starts a long-running development process.' }],
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
    usage: 'bakin doctor [--json] [--full] [--notify-agent] [--fix|--delegate] [--yes] | doctor acks | doctor ack <incidentId> | doctor snooze <incidentId> [--for 24h|7d] | doctor unack <incidentId>',
    group: 'Lifecycle',
    summary: 'Run health checks.',
    description: 'Runs local offline diagnostics by default. Pass --full to include server-backed plugin, task, workflow, search, and runtime checks. Pass --notify-agent with --full to send fresh action-required incidents to the runtime main agent. Pass --fix to plan deterministic repairs or --delegate to create a linked repair task for the main agent; add --yes to execute either repair path. Ack verbs quiet an incident you have seen without hiding it (action_required incidents are snooze-only and re-fire on any evidence change).',
    examples: [
      { title: 'Run offline diagnostics', code: 'bakin doctor', test: 'illustrative', reason: 'Depends on local Bakin/runtime state.' },
      { title: 'Run full diagnostics against the server', code: 'bakin doctor --full', test: 'illustrative', reason: 'Requires a running Bakin server.' },
      { title: 'Apply safe deterministic repairs', code: 'bakin doctor --fix --yes', test: 'illustrative', reason: 'Requires a running Bakin server and may mutate local/runtime state.' },
      { title: 'Create a delegated repair task', code: 'bakin doctor --delegate --yes', test: 'illustrative', reason: 'Requires a running Bakin server and creates a task on the board.' },
    ],
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

  cli({ name: 'agents list', usage: 'bakin agents list [--packages] [--json]', group: 'Agents and packages', summary: 'List agents.', description: 'Lists runtime agents, or package state when `--packages` is set. Pass --json for raw API output.', examples: [{ title: 'List agents', code: 'bakin agents list', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents status', usage: 'bakin agents status <id>', group: 'Agents and packages', summary: 'Get agent status.', description: 'Fetches detailed status for an agent.', examples: [{ title: 'Agent status', code: 'bakin agents status patch', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents tasks', usage: 'bakin agents tasks <id>', group: 'Agents and packages', summary: 'List tasks assigned to an agent.', description: 'Lists tasks currently assigned to an agent.', examples: [{ title: 'Agent tasks', code: 'bakin agents tasks patch', test: 'illustrative', reason: 'Requires running server data.' }] }),
  cli({ name: 'agents context', usage: 'bakin agents context [agent-id] [--json]', group: 'Agents and packages', summary: 'Startup-context size diagnostics.', description: 'Reports per-source startup-context sizes for a fresh task dispatch: static prompt sections (measured from the real builders), configured caps for dynamic blocks, runtime workspace file sizes, and observed dispatch-run tokens from the cost ledger. Names and numbers only — never prompt content. Distinct from `bakin diagnostics startup`, which reports server boot timing.', examples: [{ title: 'All agents summary', code: 'bakin agents context', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }, { title: 'Full breakdown', code: 'bakin agents context jessica', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents doctor', usage: 'bakin agents doctor <agent-id> [--json]', group: 'Agents and packages', summary: 'Combined per-agent health report.', description: 'One view of an agent\'s health: live drift scan findings, startup-context budget summary, token-burn flags (effort vs outcome, interactive vs unexplained usage, runaway), and the recent activity timeline. A thin client over the same endpoints as the web Diagnostics tab; each section degrades independently when an endpoint is unavailable.', examples: [{ title: 'Agent health report', code: 'bakin agents doctor pixel', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }, { title: 'Machine-readable', code: 'bakin agents doctor pixel --json', test: 'illustrative', reason: 'Depends on Bakin/runtime state.' }] }),
  cli({ name: 'agents send', usage: 'bakin agents send <id> <message>', group: 'Agents and packages', summary: 'Send a message to an agent.', description: 'Sends a message through the running server to an agent.', examples: [{ title: 'Message an agent', code: 'bakin agents send patch "Check the build"', test: 'illustrative', reason: 'Requires a running agent runtime.' }] }),
  cli({ name: 'agents install', usage: 'bakin agents install <path|github:user/repo[@ref][#subpath]> [--adopt] [--install-as <id>] [--replace]', group: 'Agents and packages', summary: 'Install an agent package.', description: 'Installs or adopts an agent package into Bakin/runtime-managed agent state.', examples: [{ title: 'Install local package', code: 'bakin agents install ./agent-package --install-as patch', test: 'illustrative', reason: 'Mutates local agent package state.' }, { title: 'Install official Patch agent', code: 'bakin agents install github:markhayden/bakin-bits-official#agents/patch --adopt', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents orphan', usage: 'bakin agents orphan <agent-id> [--keep-blocks] [--force]', group: 'Agents and packages', summary: 'Orphan an agent package.', description: 'Removes Bakin-managed package state while leaving the runtime agent in OpenClaw.', examples: [{ title: 'Orphan an agent', code: 'bakin agents orphan patch', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents delete', usage: 'bakin agents delete <agent-id> [--keep-blocks] [--force]', group: 'Agents and packages', summary: 'Delete an agent package and runtime agent.', description: 'Removes Bakin-managed package state and deletes the runtime agent through OpenClaw.', examples: [{ title: 'Delete an agent', code: 'bakin agents delete patch', test: 'illustrative', reason: 'Deletes local runtime agent state.' }] }),
  cli({ name: 'agents remove', usage: 'bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--delete] [--force]', group: 'Agents and packages', summary: 'Remove an agent package.', description: 'Compatibility spelling for orphaning an agent package. Use --delete-agent or --delete to also delete the runtime agent.', examples: [{ title: 'Orphan package', code: 'bakin agents remove patch --keep-blocks', test: 'illustrative', reason: 'Mutates local agent package state.' }] }),
  cli({ name: 'agents sync', usage: 'bakin agents sync [agent-id] [--check] [--reclaim <target>] [--reclaim-all] [--yes]', group: 'Agents and packages', summary: 'Sync agents with their packages + context layers.', description: 'Fetches package updates, recomposes managed blocks (global/role/team/package/lessons), re-projects skills and assets, verifies, and writes a receipt. --check reports without writing. --reclaim discards local edits on a sentineled skill/asset after confirmation.', examples: [{ title: 'Sync all agents', code: 'bakin agents sync', test: 'illustrative', reason: 'Mutates local agent package state.' }, { title: 'Report-only check', code: 'bakin agents sync pixel --check', test: 'illustrative', reason: 'Reads local + upstream state.' }] }),
  cli({ name: 'agents lessons', usage: 'bakin agents lessons <list|enable|disable> ...', group: 'Agents and packages', summary: 'Manage agent lesson toggles.', description: 'Lists or toggles lesson blocks for an agent package.', examples: [{ title: 'List lessons', code: 'bakin agents lessons list patch', test: 'illustrative', reason: 'Depends on installed agent package state.' }] }),
  cli({ name: 'packages install', usage: 'bakin packages install <path|github:user/repo[@ref][#subpath]> [--install-as <id>] [--replace]', group: 'Agents and packages', summary: 'Install a package.', description: 'Installs a standalone package.', examples: [{ title: 'Install package', code: 'bakin packages install ./package', test: 'illustrative', reason: 'Mutates local package state.' }] }),
  cli({ name: 'packages list', usage: 'bakin packages list [--json]', group: 'Agents and packages', summary: 'List packages.', description: 'Lists installed packages. Pass --json for raw API output.', examples: [{ title: 'List packages', code: 'bakin packages list', test: 'illustrative', reason: 'Depends on local package state.' }] }),
  cli({ name: 'packages remove', usage: 'bakin packages remove <package-id> [--force] [--keep-blocks]', group: 'Agents and packages', summary: 'Remove a package.', description: 'Removes an installed package.', examples: [{ title: 'Remove package', code: 'bakin packages remove package-id', test: 'illustrative', reason: 'Mutates local package state.' }] }),
  cli({ name: 'packages sync', usage: 'bakin packages sync <package-id> [--check]', group: 'Agents and packages', summary: 'Sync a standalone pack.', description: 'Fetches and re-projects an installed skill/workflow/lesson pack.', examples: [{ title: 'Sync package', code: 'bakin packages sync package-id', test: 'illustrative', reason: 'Mutates local package state.' }] }),

  cli({ name: 'plugins list', usage: 'bakin plugins list [--check] [--json]', group: 'Plugins', summary: 'List installed plugins.', description: 'Lists installed plugins and versions. Pass --check to probe for available upgrades — Whiskit artifact installs poll the release\'s whiskit-artifacts.json over HTTPS, source installs probe the git remote or local path. Pass --json for raw API output.', examples: [{ title: 'List plugins', code: 'bakin plugins list', test: 'illustrative', reason: 'Requires local server/plugin state.' }] }),
  cli({ name: 'plugins install', usage: 'bakin plugins install [--dev] <path|github:user/repo[@ref][#subpath]> [--ref <ref>] [--yes] [--force] [--json]', group: 'Plugins', summary: 'Install a plugin.', description: 'Installs a plugin from a local path or GitHub source. Append #subpath to install from a monorepo directory, or pin a GitHub install with @ref / --ref. --dev symlinks a local source tree for live development. --yes skips the consent prompt. --force replaces an existing install when used with --dev. Pass --json for raw API output.', examples: [{ title: 'Install local plugin for development', code: 'bakin plugins install --dev ./my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }, { title: 'Install a pinned official plugin', code: 'bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging --ref messaging-v1.0.0', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins export', usage: 'bakin plugins export [file] [--json]', group: 'Plugins', summary: 'Export installed user plugins.', description: 'Writes a portable manifest for installed user plugins from ~/.bakin/plugins/lock.json. Without a file, prints JSON to stdout. Pass --json with a file for a machine-readable operation result.', examples: [{ title: 'Export plugin set', code: 'bakin plugins export plugins.json', test: 'illustrative', reason: 'Depends on local plugin state.' }] }),
  cli({ name: 'plugins import', usage: 'bakin plugins import <file> [--yes] [--force] [--json]', group: 'Plugins', summary: 'Import an exported plugin set.', description: 'Installs every plugin in an exported manifest. GitHub plugins are pinned to the recorded commit SHA when present; linked dev plugins are restored as dev installs when their local source path exists. Pass --json for raw import results.', examples: [{ title: 'Import plugin set', code: 'bakin plugins import plugins.json --yes', test: 'illustrative', reason: 'Mutates local plugin state and requires a running Bakin server.' }] }),
  cli({ name: 'plugins upgrade', usage: 'bakin plugins upgrade <id> [--yes] [--json]', group: 'Plugins', summary: 'Upgrade a user plugin.', description: 'Upgrades an installed user plugin. Whiskit artifact installs refetch the latest published, checksum-verified artifact (toolchain-free); source installs re-pull from git or the local path and rebuild. Widened permissions require consent; --yes skips the prompt. Pass --json for raw API output.', examples: [{ title: 'Upgrade plugin', code: 'bakin plugins upgrade my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins publish', usage: 'bakin plugins publish <pluginDir> --out <dir> [--build] [--base-url <url>] [--platform <p>] [--json]', group: 'Plugins', summary: 'Assemble a published plugin artifact.', description: 'Assembles a checksummed Whiskit artifact (tarball + .sha256 + whiskit-artifacts.json index) from a plugin directory. --build compiles the plugin first via the shared system-bun build backend, so producers do not need a separate build step. Re-publishing into the same --out directory carries forward other plugins\' index entries, keeping each release a complete catalog. Pass --json for machine-readable output.', examples: [{ title: 'Build and publish an artifact', code: 'bakin plugins publish ./my-plugin --build --out ./release', test: 'illustrative', reason: 'Writes artifacts to the output directory.' }] }),
  cli({ name: 'plugins remove', usage: 'bakin plugins remove <id> [--json]', group: 'Plugins', summary: 'Remove a plugin.', description: 'Removes an installed non-core plugin. Pass --json for raw API output.', examples: [{ title: 'Remove plugin', code: 'bakin plugins remove my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins restore', usage: 'bakin plugins restore <id> [--snapshot <snapshot>] [--force] [--list]', group: 'Plugins', summary: 'Restore a removed plugin.', description: 'Lists or restores pre-uninstall snapshots from ~/.bakin/.uninstalled. `--snapshot` accepts a safe timestamp token or tarball filename. Restore refuses to overwrite an existing plugin unless --force is passed.', examples: [{ title: 'List snapshots', code: 'bakin plugins restore my-plugin --list', test: 'illustrative', reason: 'Depends on local uninstall snapshots.' }, { title: 'Restore latest snapshot', code: 'bakin plugins restore my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins scaffold', usage: 'bakin plugins scaffold <name> [--json]', group: 'Plugins', summary: 'Create a plugin scaffold.', description: 'Creates a starter plugin source tree. Pass --json for machine-readable output.', examples: [{ title: 'Scaffold plugin', code: 'bakin plugins scaffold my-plugin', test: 'illustrative', reason: 'Writes a new plugin directory.' }] }),
  cli({ name: 'plugins sync-manifest', usage: 'bakin plugins sync-manifest [dir] [--check] [--json]', group: 'Plugins', summary: 'Regenerate manifest contributes from plugin code.', description: 'Builds the plugin and regenerates contributes.apiRoutes + contributes.execTools from its actual routes and exec tools, so the manifest never drifts from code. Client sections (nav, clientRoutes) are author-maintained. --check reports drift without writing and exits 1 on drift.', examples: [{ title: 'Sync after adding a route', code: 'bakin plugins sync-manifest', test: 'illustrative', reason: 'Rewrites bakin-plugin.json in place.' }, { title: 'CI drift gate', code: 'bakin plugins sync-manifest --check', test: 'illustrative', reason: 'Exits 1 when the manifest is stale.' }] }),
  cli({ name: 'plugins link', usage: 'bakin plugins link <localPath> [--force] [--json]', group: 'Plugins', summary: 'Symlink a local plugin source tree for dev mode.', description: 'Registers a local source tree as a developer-mode plugin via a symlink at ~/.bakin/plugins/<id>/. Used with the hot-reload coordinator. --force overrides id collisions with copied installs or core plugins, but already-linked plugins must be unlinked first. Pass --json for raw API output.', examples: [{ title: 'Link a local plugin', code: 'bakin plugins link ./my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),
  cli({ name: 'plugins unlink', usage: 'bakin plugins unlink <id> [--json]', group: 'Plugins', summary: 'Remove a linked plugin symlink.', description: 'Removes the dev-mode symlink and lockfile entry. Refuses installed (non-linked) plugins — use `bakin plugins remove` for those. Pass --json for raw API output.', examples: [{ title: 'Unlink a plugin', code: 'bakin plugins unlink my-plugin', test: 'illustrative', reason: 'Mutates local plugin state.' }] }),

  cli({ name: 'settings get', usage: 'bakin settings get [key] [--json]', group: 'Setup and config', summary: 'Read settings.', description: 'Reads all settings or one dot-notation key. Pass --json for raw setting output.', examples: [{ title: 'Read settings', code: 'bakin settings get dispatch.intervalMs', test: 'illustrative', reason: 'Depends on local settings state.' }] }),
  cli({ name: 'settings set', usage: 'bakin settings set <key> <value> [--json]', group: 'Setup and config', summary: 'Update a setting.', description: 'Updates one setting using dot notation. Pass --json for raw API output.', examples: [{ title: 'Update setting', code: 'bakin settings set dispatch.intervalMs 300000', test: 'illustrative', reason: 'Mutates local settings.' }] }),
  cli({ name: 'settings init', usage: 'bakin settings init [--json]', group: 'Setup and config', summary: 'Seed default settings.', description: 'Creates default settings if missing. Pass --json for machine-readable output.', examples: [{ title: 'Initialize settings', code: 'bakin settings init', test: 'illustrative', reason: 'Writes local settings state.' }] }),
  cli({ name: 'diagnostics startup', usage: 'bakin diagnostics startup <status|on|off> [--slow-ms <ms>] [--json]', group: 'Setup and config', summary: 'Manage startup diagnostics.', description: 'Reads or updates the local startup diagnostics setting in ~/.bakin/settings.json. This does not require the server to be running; changes apply on the next server start. Environment variables still override it for one-off runs.', examples: [{ title: 'Enable startup diagnostics', code: 'bakin diagnostics startup on --slow-ms 100', test: 'illustrative', reason: 'Mutates local settings.' }, { title: 'Disable startup diagnostics', code: 'bakin diagnostics startup off', test: 'illustrative', reason: 'Mutates local settings.' }] }),
  cli({ name: 'setup service', usage: 'bakin setup service [--uninstall]', group: 'Setup and config', summary: 'Install or remove autostart service integration.', description: 'Installs or removes a macOS LaunchAgent or Linux user systemd service that runs `bakin serve` on login, starts it immediately, and verifies the server responds.', examples: [{ title: 'Enable autostart', code: 'bakin setup service', test: 'illustrative', reason: 'Mutates host service configuration.' }, { title: 'Disable autostart', code: 'bakin setup service --uninstall', test: 'illustrative', reason: 'Mutates host service configuration.' }] }),
  cli({ name: 'mkdir', usage: 'bakin mkdir [--json]', group: 'Setup and config', summary: 'Create the Bakin home directory tree.', description: 'Creates or verifies the `~/.bakin` directory tree. Pass --json for machine-readable output.', examples: [{ title: 'Create directories', code: 'bakin mkdir', test: 'illustrative', reason: 'Writes local home directory state.' }] }),
  cli({ name: 'check', usage: 'bakin check <runtime|search|search-models|llm|channels|plugin-assets|agent-sync|recommended-plugins|recommended-agents|all>', group: 'Setup and config', summary: 'Run onboarding checks.', description: 'Runs one or all first-run readiness checks.', examples: [{ title: 'Run all checks', code: 'bakin check all', test: 'illustrative', reason: 'Depends on local environment.' }] }),
  cli({ name: 'install', usage: 'bakin install <search|search-models|plugin-assets|agent-sync|recommended-plugins|recommended-agents>', group: 'Setup and config', summary: 'Install onboarding components.', description: 'Installs Bakin dependencies, plugin/agent assets, or official recommended plugins and agents.', examples: [{ title: 'Install the search engine', code: 'bakin install search', test: 'illustrative', reason: 'Downloads or mutates local dependencies.' }] }),
  cli({ name: 'onboard', usage: 'bakin onboard [--check] [--yes] [--json] [--force] [--verbose]', group: 'Setup and config', summary: 'Run first-time onboarding.', description: 'Runs the full first-run setup flow. By default it hides raw service logs and shows a structured setup report; use --verbose for underlying logs.', examples: [{ title: 'Scripted onboarding', code: 'bakin onboard --yes --json', test: 'illustrative', reason: 'Writes local state and may install dependencies.' }] }),
  cli({ name: 'paths', usage: 'bakin paths [key] [--json]', group: 'Setup and config', summary: 'Show content directory paths.', description: 'Prints Bakin runtime paths, optionally for one key. Pass --json for raw API output.', examples: [{ title: 'Show paths', code: 'bakin paths', test: 'illustrative', reason: 'Depends on local Bakin home settings.' }] }),

  cli({ name: 'schedule', usage: 'bakin schedule [list|add|pause|resume|remove|run|runs] ...', group: 'Schedule', summary: 'Manage scheduled jobs.', description: 'Lists, creates, pauses, resumes, removes, triggers, or inspects scheduled jobs.', examples: [{ title: 'List scheduled jobs', code: 'bakin schedule list', test: 'illustrative', reason: 'Requires running server data.' }] }),

  cli({ name: 'spend', usage: 'bakin spend [--window 24h|7d|30d|all] [--json]', group: 'Budget and spend', summary: 'Estimated agent spend + budget utilization.', description: 'Lane-split spend (metered dollars vs subscription tokens — plan quota carries no dollar figure), per-rule budget utilization, on-pace projections, unattributed share, per-agent/per-model rollups, and the kill-switch state. Same engine the dispatch gate enforces, so the numbers match the Spend tab.', examples: [{ title: 'Current spend vs caps', code: 'bakin spend', test: 'illustrative', reason: 'Requires running server data.' }] }),
  cli({ name: 'budget', usage: 'bakin budget [show|set|rm|pause|resume|incidents] ... (set: --scope global|agent|provider|model --lane metered|subscription; token caps accept k/M suffixes)', group: 'Budget and spend', summary: 'Manage spending caps + the dispatch kill switch.', description: 'Shows or edits cap rules (scope global|agent|provider × lane metered|subscription; metered caps are whole USD, subscription caps are tokens), pauses/resumes ALL dispatch (kill switch), and lists/resolves budget incidents (raise a cap & resume, acknowledge, or resume a pause-mode hold).', examples: [{ title: 'Cap metered spend at $25/day', code: 'bakin budget set --scope global --lane metered --daily 25', test: 'illustrative', reason: 'Mutates budget settings.' }, { title: 'Break-glass pause', code: 'bakin budget pause', test: 'illustrative', reason: 'Pauses all dispatch.' }, { title: 'Open incidents', code: 'bakin budget incidents', test: 'illustrative', reason: 'Requires running server data.' }] }),

  cli({ name: 'logs', usage: 'bakin logs [filter] [--json] [--lines <n>] [--no-follow]', group: 'Assets and search', summary: 'Tail audit logs.', description: 'Prints audit log entries, optionally filtered by channel or agent. TTY output is a compact live view; --json emits newline-delimited JSON events.', examples: [{ title: 'Show MCP logs', code: 'bakin logs mcp', test: 'illustrative', reason: 'Depends on local log files.' }] }),
  cli({ name: 'reindex', usage: 'bakin reindex [--table=<name>] [--rebuild]', group: 'Assets and search', summary: 'Reindex content.', description: 'Triggers content indexing through the search adapter.', examples: [{ title: 'Reindex tasks', code: 'bakin reindex --table=tasks', test: 'illustrative', reason: 'Requires local search/server state.' }] }),
  cli({ name: 'docs', usage: 'bakin docs', group: 'Assets and search', summary: 'Print API documentation from the running server.', description: 'Fetches current API route documentation from `/api/docs`.', examples: [{ title: 'Print API docs', code: 'bakin docs', test: 'illustrative', reason: 'Requires a running local server.' }] }),
  cli({ name: 'search', usage: 'bakin search <query> [--table=<name>] [--agent=<id>] [--limit=<n>] [--facets=<list>]', group: 'Assets and search', summary: 'Search indexed content.', description: 'Searches indexed Bakin content.', examples: [{ title: 'Search tasks', code: 'bakin search "blocked task" --table=tasks --limit=5', test: 'illustrative', reason: 'Requires indexed local content.' }] }),
  cli({ name: 'search:stats', usage: 'bakin search:stats', group: 'Assets and search', summary: 'Show search index stats.', description: 'Prints registered search table/index health and counts.', examples: [{ title: 'Show search stats', code: 'bakin search:stats', test: 'illustrative', reason: 'Requires local search state.' }] }),
  cli({ name: 'search:reset', usage: 'bakin search:reset [--yes]', group: 'Assets and search', summary: 'Reset the search engine clean.', description: 'Stops the engine, wipes its derived index data (content and models untouched), starts it clean, and repair-reindexes every table from source. The recovery verb for a corrupted or wedged engine that survives restarts.', examples: [{ title: 'Reset and rebuild search', code: 'bakin search:reset --yes', test: 'illustrative', reason: 'Destroys and rebuilds local derived search state.' }] }),
  cli({ name: 'trash', usage: 'bakin trash [list|restore|empty] ...', group: 'Assets and search', summary: 'Manage trashed assets.', description: 'Lists, restores, or permanently empties soft-deleted assets.', examples: [{ title: 'List trash', code: 'bakin trash list', test: 'illustrative', reason: 'Depends on local asset state.' }] }),
  // ── Brands (#419) ─────────────────────────────────────────────────────
  cli({ name: 'brands list', usage: 'bakin brands list', group: 'Brands', summary: 'List brand records.', description: 'Lists all brands (drafts flagged) plus honestly-surfaced invalid records.', examples: [{ title: 'List brands', code: 'bakin brands list', test: 'illustrative', reason: 'Depends on local brand state.' }] }),
  cli({ name: 'brands get', usage: 'bakin brands get <id>', group: 'Brands', summary: 'Show one brand.', description: 'Palette, rules, asset groups, guideline/lesson docs, provenance, and the content fingerprint for a brand.', examples: [{ title: 'Show a brand', code: 'bakin brands get acme', test: 'illustrative', reason: 'Depends on local brand state.' }] }),
  cli({ name: 'brands import', usage: 'bakin brands import <github:user/repo[/path]|dir> [--yes]', group: 'Brands', summary: 'Import a portable brand.', description: 'Previews (name, palette, counts), confirms, then imports: referenced files become managed assets, path refs rewrite to assetIds, provenance is stamped. Existing ids are replaced only after confirmation — local edits win otherwise. Private repos use your ambient git credentials.', examples: [{ title: 'Import from GitHub', code: 'bakin brands import github:me/acme-brand --yes', test: 'illustrative', reason: 'Mutates local brand + asset state.' }] }),
  cli({ name: 'brands check', usage: 'bakin brands check <id>', group: 'Brands', summary: 'Drift-check an imported brand.', description: 'Compares an INSTALLED brand\'s provenance commit against its upstream repo. Read-only; refreshing is an explicit re-import.', examples: [{ title: 'Check for upstream changes', code: 'bakin brands check acme', test: 'illustrative', reason: 'Requires network + provenance state.' }] }),
  cli({ name: 'brands export', usage: 'bakin brands export <id> <dir>', group: 'Brands', summary: 'Export a brand to a portable directory.', description: 'Writes the portable layout (brand.json with relative file refs, guidelines/, lessons/, assets/) — pushable to a repo and importable by any Bakin.', examples: [{ title: 'Export a brand', code: 'bakin brands export acme ./acme-brand', test: 'illustrative', reason: 'Writes local files.' }] }),
  cli({ name: 'brands remove', usage: 'bakin brands remove <id> [--yes]', group: 'Brands', summary: 'Delete a brand.', description: 'Deletes the brand directory after a linked-task warning (pending tasks referencing it defer until the brand exists again). Assets stay in the asset store.', examples: [{ title: 'Delete a brand', code: 'bakin brands remove acme --yes', test: 'illustrative', reason: 'Deletes local brand state.' }] }),
] as const satisfies readonly CliDef[]

export interface CliUsageGroup {
  group: string
  commands: CliDef[]
}

export function getCliUsageGroups(opts: { excludeNames?: ReadonlySet<string> } = {}): CliUsageGroup[] {
  const grouped = new Map<string, CliDef[]>()
  for (const command of CLI_COMMANDS) {
    if (opts.excludeNames?.has(command.name)) continue
    const group = command.group ?? 'Commands'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(command)
  }
  return Array.from(grouped, ([group, commands]) => ({ group, commands }))
}

export function renderCliUsage(env: { bakinUrl?: string } = {}, opts: { excludeNames?: ReadonlySet<string> } = {}): string {
  const lines = ['Usage: bakin <command> [options]', '']
  for (const usageGroup of getCliUsageGroups(opts)) {
    lines.push(`${usageGroup.group}:`)
    const { commands } = usageGroup
    for (const command of commands) {
      lines.push(`  ${command.usage.padEnd(58)} ${command.summary}`)
    }
    lines.push('')
  }

  lines.push('Environment:')
  lines.push(`  BAKIN_URL${' '.repeat(18)}Base URL for the running server (default: ${env.bakinUrl ?? 'http://localhost:3737'})`)
  lines.push(`  BAKIN_HOME${' '.repeat(17)}Override for ~/.bakin`)
  if (!opts.excludeNames?.has('start')) {
    lines.push(`  PORT${' '.repeat(23)}Port to bind when \`start\` launches (default: 3737)`)
  }
  return lines.join('\n')
}
