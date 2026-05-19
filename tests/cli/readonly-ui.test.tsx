import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  AgentLessonsListReport,
  AgentPackagesListReport,
  AgentRulesReport,
  AgentStatusReport,
  AgentTasksReport,
  AgentsListReport,
  DocsReport,
  PackagesListReport,
  PathsReport,
  PluginRestoreResultReport,
  PluginRestoreSnapshotsReport,
  PluginsListReport,
  ReindexReport,
  ScheduleListReport,
  ScheduleRunsReport,
  SearchResultsReport,
  SearchStatsReport,
  SettingsReport,
  StatusReport,
  TaskDetailReport,
  TasksListReport,
  TrashActionReport,
  TrashListReport,
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

    expect(output).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output).toContain('Status')
    expect(output).toContain('DISPATCH')
    expect(output).toContain('main, patch')
    expect(output).not.toContain('=== Bakin Status ===')
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

  it('renders agent-rules check results with shared TUI primitives', () => {
    const output = renderToString(
      <AgentRulesReport
        mode="check"
        scope="orchestrator"
        results={[
          { check: 'managed-context', status: 'ok', message: 'Managed context is current' },
          { check: 'subagent-context', status: 'fixed', message: 'Updated stale context' },
          { check: 'runtime-agents', status: 'warn', message: 'No runtime agents found' },
          { check: 'workspace', status: 'error', message: 'Failed to read AGENTS.md' },
        ]}
      />,
    )

    expect(output).toContain('Agent Rules')
    expect(output).toContain('scope: orchestrator')
    expect(output).toContain('CHECKS')
    expect(output).toContain('managed-context')
    expect(output).toContain('Updated stale context')
    expect(output).toContain('No runtime agents found')
    expect(output).toContain('Failed to read AGENTS.md')
    expect(output).not.toContain('[OK] managed-context')
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
          enrichmentErrors: 1,
          tables: [
            { table: 'bakin_tasks', indexed: 12, enrichment: { healthy: true, indexes: [] } },
            { table: 'agent_lessons', indexed: 0, error: 'schema missing' },
            { table: 'assets', indexed: 4, enrichment: { healthy: false, indexes: [{ name: 'semantic', error: 'offline', walBacklog: 2 }] } },
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
    expect(output).toContain('semantic: offline')
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
        routes={[
          { pluginId: 'tasks' },
          { pluginId: 'tasks' },
          { pluginId: 'team' },
          { pluginId: 'core' },
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
    expect(plugins).toContain('ROUTES')
    expect(plugins).toContain('tasks')
    expect(plugins).toContain('2')
    expect(plugins).not.toContain('core')
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
        tables={[
          {
            table: 'bakin_tasks',
            pluginId: 'tasks',
            stats: { num_docs: 12 },
            healthy: true,
            indexHealth: [],
          },
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
    expect(stats).toContain('bakin_tasks')
    expect(stats).toContain('12')
  })

  it('renders package-oriented lists as shared TUI tables', () => {
    const agentPackages = renderToString(
      <AgentPackagesListReport
        agents={[
          { agentId: 'patch', state: 'managed', packageId: 'bakin.patch' },
          { agentId: 'docs', state: 'adopted', packageId: 'bakin.docs' },
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
        ]}
      />,
    )

    expect(agentPackages).toContain('Agent Packages')
    expect(agentPackages).toContain('PACKAGE')
    expect(agentPackages).toContain('bakin.patch')
    expect(lessons).toContain('Agent Lessons')
    expect(lessons).toContain('LESSON')
    expect(lessons).toContain('ENABLED')
    expect(lessons).toContain('handoff')
    expect(packages).toContain('Packages')
    expect(packages).toContain('DEPENDENTS')
    expect(packages).toContain('patch, docs')
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
