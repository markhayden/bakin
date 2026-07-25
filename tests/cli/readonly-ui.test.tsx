import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  AgentLessonsListReport,
  AgentPackagesListReport,
  AgentStatusReport,
  AgentTasksReport,
  AgentsListReport,
  CommandFailureReport,
  CommandIssueReport,
  DocsReport,
  HelpReport,
  PackageActionReport,
  PackagesListReport,
  PathsReport,
  PluginActionReport,
  PluginRestoreResultReport,
  PluginRestoreSnapshotsReport,
  PluginsListReport,
  ReindexReport,
  RuntimeActionReport,
  ScheduleListReport,
  ScheduleRunsReport,
  SearchResultsReport,
  SearchStatsReport,
  SettingsActionReport,
  SettingsReport,
  StatusReport,
  TaskActionReport,
  TaskDetailReport,
  TasksListReport,
  TrashActionReport,
  TrashListReport,
  VersionReport,
  WorkflowActionReport,
  WorkflowsListReport,
} from '../../src/core/cli/ui/readonly'

describe('read-only CLI TUI screens', () => {
  it('renders status with shared TUI primitives', () => {
    const output = renderToString(
      <StatusReport
        dispatch={{
          intervalMin: 5,
          lastRun: '2026-05-18T04:00:00.000Z',
          nextRun: '2026-05-18T04:05:00.000Z',
          secondsUntilNext: 120,
          dispatchedCount: 7,
        }}
        roster={{ agentIds: ['main', 'patch'], mainAgentId: 'main' }}
      />,
    )

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Status')
    expect(output).toContain('DISPATCH')
    expect(output).toContain('main, patch')
    expect(output).not.toContain('=== Bakin Status ===')
  })

  it('renders command help with shared TUI primitives', () => {
    const output = renderToString(
      <HelpReport
        groups={[
          {
            group: 'Lifecycle',
            commands: [
              { name: 'start', usage: 'bakin start', summary: 'Start the Bakin server.' },
              { name: 'doctor', usage: 'bakin doctor [--json] [--full]', summary: 'Run health checks.' },
            ],
          },
          {
            group: 'Tasks and workflows',
            commands: [
              { name: 'tasks list', usage: 'bakin tasks list [--column=<column>]', summary: 'List tasks.' },
            ],
          },
        ]}
        env={{ bakinUrl: 'http://localhost:3737' }}
        error="Unknown command: wat"
        errorDetail="Plugin command lookup skipped because Bakin is not reachable."
      />,
    )

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Help  unknown command')
    expect(output).toContain('ISSUE\n------------')
    expect(output).toContain('Unknown command: wat')
    expect(output).toContain('Plugin command lookup skipped')
    expect(output).toContain('LIFECYCLE')
    expect(output).toContain('COMMAND')
    expect(output).toContain('bakin start')
    expect(output).toContain('Tasks and workflows'.toUpperCase())
    expect(output).toContain('ENVIRONMENT')
    expect(output).not.toContain('Usage: bakin <command> [options]')
  })

  it('renders command invocation issues with shared TUI primitives', () => {
    const output = renderToString(
      <CommandIssueReport
        issue={{
          command: 'bakin tasks get',
          message: 'Missing required arguments.',
          usage: 'bakin tasks get <id>',
          available: ['list', 'get', 'create'],
        }}
      />,
    )

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Command issue  bakin tasks get')
    expect(output).toContain('ISSUE')
    expect(output).toContain('Missing required arguments.')
    expect(output).toContain('USAGE')
    expect(output).toContain('bakin tasks get <id>')
    expect(output).toContain('AVAILABLE')
    expect(output).toContain('list | get | create')
  })

  it('renders command runtime failures with shared TUI primitives', () => {
    const output = renderToString(
      <CommandFailureReport
        failure={{
          command: 'bakin tasks list',
          message: 'Cannot connect to Bakin. Is the server running?',
          detail: 'Tried: http://localhost:3737',
          code: 'SERVER_UNREACHABLE',
          next: 'Run `bakin start` to launch the server.',
        }}
      />,
    )

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Command failed  bakin tasks list')
    expect(output).toContain('Cannot connect to Bakin')
    expect(output).toContain('SERVER_UNREACHABLE')
    expect(output).toContain('PROBLEM')
    expect(output).toContain('NEXT')
    expect(output).toContain('Run `bakin start`')
  })

  it('renders version with shared TUI primitives', () => {
    const output = renderToString(<VersionReport data={{ version: '1.2.3' }} />)

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Version  v1.2.3')
    expect(output).toContain('DETAILS')
    expect(output).toContain('1.2.3')
  })

  it('renders runtime action confirmations with shared TUI primitives', () => {
    const dispatch = renderToString(
      <RuntimeActionReport
        action={{
          action: 'dispatch',
          target: 'task dispatcher',
          result: { ok: true, ts: '2026-05-18T09:00:00.000Z' },
        }}
      />,
    )
    const message = renderToString(
      <RuntimeActionReport
        action={{
          action: 'message',
          target: 'patch',
          detail: 'Check the build',
          result: { ok: true, reply: 'Message accepted' },
        }}
      />,
    )

    expect(dispatch).toContain('Runtime action')
    expect(dispatch).toContain('RESULT')
    expect(dispatch).toContain('Triggered immediate task dispatch.')
    expect(dispatch).toContain('2026-05-18T09:00:00.000Z')
    expect(message).toContain('Sent message to patch.')
    expect(message).toContain('Message accepted')
  })

  it('renders task board rows as a table with column status tokens', () => {
    const output = renderToString(
      <TasksListReport
        columns={{
          todo: [{ id: 'task-1', title: 'Write docs', agent: 'patch' }],
          blocked: [{ id: 'task-2', title: 'Waiting on runtime', agent: 'main' }],
          done: [{ id: 'task-3', title: 'Ship doctor TUI', agent: 'patch' }],
        }}
      />,
    )

    expect(output).toContain('Tasks')
    expect(output).toContain('BOARD')
    expect(output).toContain('TODO')
    expect(output).toContain('BLOCKED')
    expect(output).toContain('DONE')
    expect(output).toContain('COLUMN')
    expect(output).toContain('ID')
    expect(output).toContain('TITLE')
    expect(output).toContain('AGENT')
    expect(output).toContain('task-1')
    expect(output).toContain('Write docs')
    expect(output).toContain('patch')
    expect(output).not.toContain('Column: todo; Agent: patch')
  })

  it('renders task action confirmations with shared TUI primitives', () => {
    const created = renderToString(
      <TaskActionReport
        action={{
          action: 'created',
          taskId: 'task-1',
          title: 'Write docs',
          agent: 'patch',
          workflowId: 'release',
        }}
      />,
    )
    const blocked = renderToString(
      <TaskActionReport
        action={{
          action: 'blocked',
          taskId: 'task-2',
          message: 'Blocked task task-2.',
          detail: 'Waiting on API credentials',
        }}
      />,
    )

    expect(created).toContain('Task action')
    expect(created).toContain('RESULT')
    expect(created).toContain('task-1')
    expect(created).toContain('Created task Write docs.')
    expect(created).toContain('workflow')
    expect(blocked).toContain('Blocked task task-2.')
    expect(blocked).toContain('Waiting on API credentials')
  })

  it('renders task and agent detail screens with shared TUI primitives', () => {
    const task = renderToString(
      <TaskDetailReport
        taskId="task-1"
        column="inProgress"
        task={{
          id: 'task-1',
          title: 'Write docs',
          agent: 'patch',
          priority: 'high',
        }}
      />,
    )
    const agent = renderToString(
      <AgentStatusReport
        agentId="patch"
        profile={{
          id: 'patch',
          name: 'Patch',
          role: 'Engineer',
          model: 'gpt-5.5',
          workspacePath: '/tmp/patch',
          soul: '# Patch Soul\n',
          identity: '# Identity\n',
          rules: '',
          tools: null,
          heartbeatMd: '# Heartbeat\nWorking on docs',
          subagentPerms: ['docs'],
        }}
      />,
    )

    expect(task).toContain('Task Detail')
    expect(task).toContain('id: task-1')
    expect(task).toContain('TASK')
    expect(task).toContain('Write docs')
    expect(task).toContain('inProgress')
    expect(task).toContain('FIELDS')
    expect(task).toContain('priority')
    expect(agent).toContain('Agent Status')
    expect(agent).toContain('agent: patch')
    expect(agent).toContain('PROFILE')
    expect(agent).toContain('Patch')
    expect(agent).toContain('gpt-5.5')
    expect(agent).toContain('WORKSPACE')
    expect(agent).toContain('heartbeat')
  })

  it('renders setup configuration summaries with shared TUI tables', () => {
    const settings = renderToString(
      <SettingsReport
        settings={{
          dispatch: { intervalMs: 300000, maxRetries: 3 },
          runtime: { adapter: 'openclaw' },
          plugins: { requireSignatures: false },
        }}
      />,
    )
    const paths = renderToString(
      <PathsReport
        isBakinHome={true}
        paths={{
          home: '/Users/roscoe/.bakin',
          tasks: '/Users/roscoe/.bakin/tasks',
          audit: '/Users/roscoe/.bakin/audit.jsonl',
        }}
      />,
    )

    expect(settings).toContain('Settings')
    expect(settings).toContain('CONFIGURATION')
    expect(settings).toContain('dispatch.intervalMs')
    expect(settings).toContain('openclaw')
    expect(paths).toContain('Paths')
    expect(paths).toContain('DIRECTORIES')
    expect(paths).toContain('home')
    expect(paths).toContain('/Users/roscoe/.bakin')
  })

  it('renders settings updates with shared TUI primitives', () => {
    const output = renderToString(
      <SettingsActionReport
        action={{
          action: 'updated',
          key: 'dispatch.intervalMs',
          value: 300000,
          result: { ok: true },
        }}
      />,
    )

    expect(output).toContain('Settings action')
    expect(output).toContain('RESULT')
    expect(output).toContain('Updated setting dispatch.intervalMs.')
    expect(output).toContain('Value: 300000')
    expect(output).not.toContain('"ok"')
  })

  it('renders reindex results with shared TUI tables', () => {
    const output = renderToString(
      <ReindexReport
        target="tasks"
        rebuild={true}
        result={{
          ok: false,
          total: 12,
          errors: 1,
          parked: 1,
          tables: [
            { table: 'bakin_tasks', indexed: 12, result: 'migrated' },
            { table: 'agent_lessons', indexed: 0, error: 'schema missing' },
            { table: 'assets', indexed: 4, result: 'parked' },
          ],
        }}
      />,
    )

    expect(output).toContain('Reindex')
    expect(output).toContain('target: tasks')
    expect(output).toContain('TABLES')
    expect(output).toContain('bakin_tasks')
    expect(output).toContain('agent_lessons')
    expect(output).toContain('schema missing')
    // Parked outcome must be VISIBLE (the '-' fallback once hid it).
    expect(output).toContain('parked — green never converged')
    expect(output).not.toContain('Reindexing tasks into search')
  })

  it('renders plugin restore snapshots and results with shared TUI primitives', () => {
    const snapshots = renderToString(
      <PluginRestoreSnapshotsReport
        pluginId="demo-plugin"
        snapshots={[
          {
            timestamp: '2026-05-04T00-00-00-000Z',
            createdAt: '2026-05-04T00:00:00.000Z',
            filename: 'demo-plugin-2026.tar.gz',
            sizeBytes: 4096,
          },
        ]}
      />,
    )
    const result = renderToString(
      <PluginRestoreResultReport
        pluginId="demo-plugin"
        result={{
          ok: true,
          message: 'Restored "demo-plugin".',
          snapshotInfo: {
            timestamp: '2026-05-04T00-00-00-000Z',
            createdAt: '2026-05-04T00:00:00.000Z',
            filename: 'demo-plugin-2026.tar.gz',
            sizeBytes: 4096,
          },
          skills: { restored: 2 },
          activated: false,
        }}
      />,
    )

    expect(snapshots).toContain('Plugin Restore')
    expect(snapshots).toContain('plugin: demo-plugin')
    expect(snapshots).toContain('SNAPSHOTS')
    expect(snapshots).toContain('demo-plugin-2026.tar.gz')
    expect(snapshots).not.toContain('Uninstall snapshots for')
    expect(result).toContain('Plugin Restore')
    expect(result).toContain('RESULT')
    expect(result).toContain('Restored "demo-plugin".')
    expect(result).toContain('demo-plugin-2026.tar.gz')
    expect(result).toContain('Activation deferred until next server start.')
  })

  it('renders plugin lifecycle actions with shared TUI primitives', () => {
    const output = renderToString(
      <PluginActionReport
        actions={[
          {
            action: 'installed',
            source: 'github:markhayden/bakin-bits-official#plugins/messaging',
            result: {
              ok: true,
              id: 'messaging',
              version: '2.0.0',
              activated: true,
              runtimeVersion: 7,
              message: 'Installed "messaging" and activated it.',
            },
          },
          {
            action: 'removed',
            pluginId: 'old-plugin',
            result: {
              ok: true,
              id: 'old-plugin',
              skills: { removed: 1, kept: 1 },
              snapshot: '/Users/roscoe/.bakin/.uninstalled/old-plugin.tar.gz',
              message: 'Removed "old-plugin" and deactivated it.',
            },
          },
          {
            action: 'installed',
            source: './needs-consent',
            result: {
              ok: false,
              awaitingConsent: true,
              id: 'needs-consent',
              version: '1.0.0',
              permissions: [{ resource: 'runtime', action: 'read' }],
            },
          },
          {
            action: 'upgraded',
            pluginId: 'messaging',
            result: {
              ok: true,
              id: 'messaging',
              before: { version: '1.0.0', commitSha: '1111111111111111111111111111111111111111' },
              after: { version: '2.0.0', commitSha: '2222222222222222222222222222222222222222' },
              pluginAssets: { installed: [{ name: 'compose' }], skipped: [] },
            },
          },
          {
            action: 'scaffolded',
            pluginId: 'smoke-plugin',
            result: {
              ok: true,
              id: 'smoke-plugin',
              root: '/tmp/smoke-plugin',
              next: ['cd smoke-plugin && bun install && bakin plugins install .'],
            },
          },
        ]}
      />,
    )

    expect(output).toContain('Plugin action')
    expect(output).toContain('RESULT')
    expect(output).toContain('Installed "messaging" and activated it.')
    expect(output).toContain('Runtime version: 7')
    expect(output).toContain('Removed "old-plugin" and deactivated it.')
    expect(output).toContain('Runtime skills: 1 removed, 1 kept')
    expect(output).toContain('Plugin needs-consent requires permission')
    expect(output).toContain('consent before install.')
    expect(output).toContain('Next: Re-run with --yes')
    expect(output).toContain('Upgraded plugin messaging 1.0.0 -> 2.0.0.')
    expect(output).toContain('Runtime skills: 1 applied, 0 skipped')
    expect(output).toContain('Scaffolded plugin smoke-plugin.')
    expect(output).toContain('Directory: /tmp/smoke-plugin')
    expect(output).not.toContain('"ok"')
  })

  it('renders agents and plugins as shared TUI tables', () => {
    const agents = renderToString(
      <AgentsListReport
        agents={[
          { id: 'main', name: 'Main Agent', status: 'online', model: 'gpt-5.5' },
          { id: 'patch', name: 'Patch', status: 'working', model: 'gpt-5.5' },
        ]}
      />,
    )
    const plugins = renderToString(
      <PluginsListReport
        plugins={[
          { id: 'team', name: 'Team', version: '1.0.0', source: 'core', status: 'active' },
          { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active' },
          { id: 'schedule', name: 'Schedule', version: '2.0.0', source: 'core', status: 'active' },
          { id: 'assets', name: 'Assets', version: '2.0.0', source: 'core', status: 'active' },
          { id: 'health', name: 'Health', version: '1.0.0', source: 'core', status: 'active' },
          { id: 'models', name: 'Models', version: '2.1.0', source: 'core', status: 'active' },
          { id: 'messaging', name: 'Messaging', version: '2.0.0', source: 'github', status: 'active' },
          { id: 'projects', name: 'Projects', version: '2.0.0', source: 'github', status: 'active' },
        ]}
      />,
    )

    expect(agents).toContain('Agents')
    expect(agents).toContain('STATUS')
    expect(agents).toContain('ID')
    expect(agents).toContain('NAME')
    expect(agents).toContain('STATE')
    expect(agents).toContain('MODEL')
    expect(agents).toContain('Main Agent')
    expect(agents).toContain('gpt-5.5')
    expect(agents).not.toContain('Model: gpt-5.5')
    expect(plugins).toContain('Plugins')
    expect(plugins).toContain('PLUGIN')
    expect(plugins).toContain('SOURCE')
    expect(plugins).toContain('tasks')
    expect(plugins).toContain('schedule')
    expect(plugins).toContain('assets')
    expect(plugins).toContain('health')
    expect(plugins).toContain('models')
    expect(plugins).toContain('messaging')
    expect(plugins).toContain('projects')
  })

  it('renders tasks assigned to one agent as a shared TUI table', () => {
    const output = renderToString(
      <AgentTasksReport
        agentId="patch"
        tasks={[
          { id: 'task-1', title: 'Write docs', column: 'todo' },
          { id: 'task-2', title: 'Waiting on review', column: 'blocked' },
        ]}
      />,
    )

    expect(output).toContain('Agent Tasks')
    expect(output).toContain('agent: patch')
    expect(output).toContain('TASKS')
    expect(output).toContain('COLUMN')
    expect(output).toContain('Write docs')
    expect(output).toContain('blocked')
  })

  it('renders workflow definitions as a shared TUI table', () => {
    const output = renderToString(
      <WorkflowsListReport
        templates={[
          {
            filename: 'release.yml',
            name: 'Release',
            description: 'Prepare release notes and verification',
            stepCount: 4,
          },
        ]}
      />,
    )

    expect(output).toContain('Workflows')
    expect(output).toContain('DEFINITIONS')
    expect(output).toContain('FILENAME')
    expect(output).toContain('NAME')
    expect(output).toContain('DESCRIPTION')
    expect(output).toContain('STEPS')
    expect(output).toContain('release.yml')
    expect(output).toContain('Release')
  })

  it('renders workflow action confirmations with shared TUI primitives', () => {
    const started = renderToString(
      <WorkflowActionReport
        action={{
          action: 'started',
          taskId: 'task-1',
          workflowId: 'release',
          result: { instance: { status: 'in_progress', currentStepId: 'draft' } },
        }}
      />,
    )
    const submitted = renderToString(
      <WorkflowActionReport
        action={{
          action: 'submitted',
          taskId: 'task-1',
          stepId: 'draft',
          result: { success: true, workflowComplete: false, nextStep: { stepId: 'review', label: 'Review draft', status: 'pending' } },
        }}
      />,
    )

    expect(started).toContain('Workflow action')
    expect(started).toContain('RESULT')
    expect(started).toContain('Started workflow release')
    expect(started).toContain('current step: draft')
    expect(submitted).toContain('Completed workflow step draft.')
    expect(submitted).toContain('Next step review: Review draft')
  })

  it('renders docs and search screens with shared TUI tables', () => {
    const docs = renderToString(
      <DocsReport
        routes={[
          { method: 'GET', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'List tasks' },
          { method: 'POST', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'Create task' },
        ]}
      />,
    )
    const search = renderToString(
      <SearchResultsReport
        query="blocked task"
        results={[
          {
            id: 'task-1',
            score: 0.9123,
            table: 'bakin_tasks',
            fields: { title: 'Blocked task' },
          },
        ]}
        aggregations={{
          status: [{ value: 'blocked', count: 1 }],
        }}
        meta={{ query: 'blocked task', total: 1, took_ms: 4, source: 'tantivy' }}
      />,
    )
    const stats = renderToString(
      <SearchStatsReport
        enabled={true}
        engineReachable={true}
        outbox={{ pending: 3, quarantined: 0 }}
        tables={[
          {
            logical: 'bakin_tasks',
            pluginId: 'tasks',
            docCount: 12,
            journalPending: 2,
            state: 'active',
            phase: null,
            legs: [{ name: 'embeddings', pending: 4, rebuilding: false }],
            healthy: true,
          },
        ]}
      />,
    )
    const statsUnreachable = renderToString(
      <SearchStatsReport
        enabled={true}
        engineReachable={false}
        tables={[
          { logical: 'bakin_tasks', pluginId: 'tasks', docCount: null, journalPending: 0, state: 'active', phase: null, legs: [], healthy: false },
        ]}
      />,
    )

    expect(docs).toContain('Docs')
    expect(docs).toContain('ROUTES')
    expect(docs).toContain('METHOD')
    expect(docs).toContain('/api/plugins/tasks/')
    expect(search).toContain('Search')
    expect(search).toContain('RESULTS')
    expect(search).toContain('Blocked task')
    expect(search).toContain('tasks')
    expect(search).toContain('task-1')
    expect(search).toContain('FACETS')
    expect(search).toContain('blocked(1)')
    expect(stats).toContain('Search Stats')
    expect(stats).toContain('TABLES')
    // Row fields map from the real /search-status payload (logical/docCount/
    // legs) — the old table/stats shape rendered "-" names and "?" docs for
    // healthy tables (2026-07-21 field bug).
    expect(stats).toContain('tasks')
    expect(stats).toContain('12')
    expect(stats).toContain('2 queued · 4 embedding')
    expect(stats).toContain('enriching')
    expect(stats).toContain('3 pending')
    // Disabled vs unreachable are DIFFERENT states with different fixes.
    expect(statsUnreachable).toContain('unreachable')
    expect(statsUnreachable).toContain('?')
  })

  it('renders package-oriented lists as shared TUI tables', () => {
    const agentPackages = renderToString(
      <AgentPackagesListReport
        agents={[
          { agentId: 'patch', state: 'managed', packageId: 'bakin.patch', version: '1.2.0' },
          { agentId: 'docs', state: 'managed', packageId: 'bakin.docs', entry: { version: '1.1.0' } },
        ]}
      />,
    )
    const lessons = renderToString(
      <AgentLessonsListReport
        agentId="patch"
        packageId="bakin.patch"
        lessons={[
          { lessonId: 'handoff', title: 'Handoff Notes', tags: ['workflow'], enabled: true },
          { lessonId: 'release', title: 'Release Notes', tags: [], enabled: false },
        ]}
      />,
    )
    const packages = renderToString(
      <PackagesListReport
        packages={[
          { id: 'bakin.patch', kind: 'agent', version: '1.0.0', refCount: 2, dependents: ['patch', 'docs'] },
          { id: 'lessons', kind: 'lesson-pack', version: '1.0.0', refCount: 0, dependents: [] },
        ]}
      />,
    )

    expect(agentPackages).toContain('Agent Packages')
    expect(agentPackages).toContain('VERSION')
    expect(agentPackages).toContain('PACKAGE')
    expect(agentPackages).toContain('bakin.patch')
    expect(agentPackages).toContain('1.2.0')
    expect(agentPackages).toContain('1.1.0')
    expect(lessons).toContain('Agent Lessons')
    expect(lessons).toContain('LESSON')
    expect(lessons).toContain('ENABLED')
    expect(lessons).toContain('handoff')
    expect(packages).toContain('Packages')
    expect(packages).toContain('DEPENDENTS')
    expect(packages).toContain('lessons')
    expect(packages).not.toContain('bakin.patch')
  })

  it('renders package action confirmations with shared TUI primitives', () => {
    const output = renderToString(
      <PackageActionReport
        actions={[
          {
            action: 'installed',
            scope: 'agent package',
            target: 'patch',
            result: {
              ok: true,
              result: {
                packageId: 'bakin.patch',
                kind: 'agent',
                createdAgent: true,
                adopted: false,
                dependencies: [{ packageId: 'bakin.shared', kind: 'lesson-pack', version: '1.0.0' }],
                skipped: [],
              },
            },
          },
          {
            action: 'disabled',
            scope: 'lesson',
            target: 'style',
            context: 'patch',
            result: {
              ok: true,
              result: {
                packageId: 'bakin.patch',
                lessonId: 'style',
                enabled: false,
                changed: true,
              },
            },
          },
        ]}
      />,
    )

    expect(output).toContain('Package action')
    expect(output).toContain('RESULT')
    expect(output).toContain('Installed agent package bakin.patch.')
    expect(output).toContain('Created runtime agent.')
    expect(output).toContain('bakin.shared')
    expect(output).toContain('Disabled lesson style for patch.')
    expect(output).not.toContain('"result"')
  })

  it('renders schedule lists and run history as shared TUI tables', () => {
    const schedule = renderToString(
      <ScheduleListReport
        jobs={[
          {
            id: 'job-1',
            displayName: 'Daily Doctor',
            agentId: 'main',
            humanSchedule: 'Every day at 9:00 AM',
            paused: false,
            enabled: true,
            isBakinJob: true,
          },
          {
            id: 'job-2',
            displayName: 'Paused Cleanup',
            agentId: 'patch',
            humanSchedule: 'Every Friday',
            paused: true,
            enabled: true,
            isBakinJob: true,
          },
        ]}
      />,
    )
    const runs = renderToString(
      <ScheduleRunsReport
        jobId="job-1"
        runs={[
          { runId: 'run-1', timestamp: '2026-05-18T09:00:00.000Z', status: 'ok', taskId: 'task-1' },
          { runId: 'run-2', timestamp: '2026-05-17T09:00:00.000Z', status: 'error', error: 'timeout' },
        ]}
      />,
    )

    expect(schedule).toContain('Schedule')
    expect(schedule).toContain('JOBS')
    expect(schedule).toContain('Daily Doctor')
    expect(schedule).toContain('Every day at 9:00 AM')
    expect(runs).toContain('Schedule Runs')
    expect(runs).toContain('RUN HISTORY')
    expect(runs).toContain('task-1')
    expect(runs).toContain('timeout')
  })

  it('renders trashed assets as a shared TUI table', () => {
    const output = renderToString(
      <TrashListReport
        assets={[
          {
            filename: 'doc.md__deleted-20260518',
            originalFilename: 'doc.md',
            type: 'markdown',
            size: 2048,
            deletedAt: '2026-05-18T09:00:00.000Z',
            expiresAt: '2026-05-25T09:00:00.000Z',
            metadata: { agent: 'patch' },
          },
        ]}
      />,
    )

    expect(output).toContain('Trash')
    expect(output).toContain('TRASHED ASSETS')
    expect(output).toContain('FILENAME')
    expect(output).toContain('doc.md')
    expect(output).toContain('2.0 KB')
    expect(output).toContain('patch')
    expect(output).toContain('bakin trash restore <trashName>')
  })

  it('renders trash action confirmations with shared TUI primitives', () => {
    const restored = renderToString(
      <TrashActionReport
        action={{
          action: 'restored',
          target: 'doc.md__deleted-20260518',
          message: 'Restored doc.md.',
          detail: '/Users/roscoe/.bakin/assets/doc.md',
        }}
      />,
    )
    const emptied = renderToString(
      <TrashActionReport
        action={{
          action: 'emptied',
          count: 2,
          message: 'Permanently deleted 2 items.',
        }}
      />,
    )

    expect(restored).toContain('Trash action')
    expect(restored).toContain('RESULT')
    expect(restored).toContain('doc.md__deleted')
    expect(restored).toContain('Restored doc.md.')
    expect(emptied).toContain('Permanently deleted 2 items.')
  })
})
