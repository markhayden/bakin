import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { createMultiSelectState, MultiSelect, updateMultiSelectState } from '../../src/core/cli/ui/multi-select'
import { Report } from '../../src/core/cli/ui/report'
import { Table } from '../../src/core/cli/ui/table'

describe('CLI UI primitives', () => {
  it('renders grouped reports with remediation', () => {
    const output = renderToString(
      <Report
        title="Bakin Doctor"
        color={false}
        groups={[{
          title: 'Runtime',
          rows: [{
            label: 'runtime',
            status: 'blocked',
            message: 'No orchestrator agent found',
            remediation: 'https://makinbakin.com/docs/start/first-time-setup/',
          }],
        }]}
      />,
    )

    expect(output).toContain('Bakin Doctor')
    expect(output).toContain('[BLOCKED] runtime')
    expect(output).toContain('No orchestrator agent found')
    expect(output).toContain('https://makinbakin.com/docs/start/first-time-setup/')
  })

  it('renders tables with stable column widths', () => {
    const output = renderToString(
      <Table
        columns={[
          { key: 'id', header: 'ID', render: (row: { id: string; name: string }) => row.id },
          { key: 'name', header: 'NAME', render: (row) => row.name },
        ]}
        rows={[
          { id: 'a', name: 'Short' },
          { id: 'long-id', name: 'Longer Name' },
        ]}
      />,
    )

    expect(output).toBe('ID       NAME\na        Short\nlong-id  Longer Name')
  })

  it('moves focus and toggles enabled items in multi-select state', () => {
    const items = [
      { id: 'installed', label: 'Installed', disabled: true, selected: true },
      { id: 'messaging', label: 'Messaging', selected: true },
      { id: 'projects', label: 'Projects' },
    ]
    let state = createMultiSelectState(items)

    expect(state.focusIndex).toBe(1)
    expect([...state.selectedIds]).toEqual(['messaging'])

    state = updateMultiSelectState(state, items, { type: 'down' })
    expect(state.focusIndex).toBe(2)

    state = updateMultiSelectState(state, items, { type: 'toggle' })
    expect([...state.selectedIds].sort()).toEqual(['messaging', 'projects'])

    state = updateMultiSelectState(state, items, { type: 'down' })
    expect(state.focusIndex).toBe(1)
  })

  it('renders multi-select instructions and item state', () => {
    const items = [
      { id: 'messaging', label: 'Messaging', description: 'Planning and approvals', selected: true },
      { id: 'projects', label: 'Projects', disabled: true, note: 'installed' },
    ]
    const output = renderToString(
      <MultiSelect
        title="Install official plugins"
        items={items}
        state={createMultiSelectState(items)}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    expect(output).toContain('Install official plugins')
    expect(output).toContain('Use up/down to move, space to select, enter to continue.')
    expect(output).toContain('> ◉ Messaging')
    expect(output).toContain('Planning and approvals')
    expect(output).toContain('○ Projects (installed)')
  })
})
