import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  AgentLessonsListReport,
  AgentPackagesListReport,
  AgentsListReport,
  PackagesListReport,
  PluginsListReport,
  StatusReport,
  TasksListReport,
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
})
