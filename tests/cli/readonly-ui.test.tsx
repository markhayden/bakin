import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  AgentsListReport,
  PluginsListReport,
  StatusReport,
  TasksListReport,
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
})
