import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import { createMultiSelectState, MultiSelect, updateMultiSelectState } from '../../src/core/cli/ui/multi-select'
import { Report } from '../../src/core/cli/ui/report'
import { Table } from '../../src/core/cli/ui/table'
import {
  FindingRows,
  NextActions,
  ProgressMeter,
  ScreenHeader,
  Section,
  StatusToken,
  SummaryStrip,
} from '../../src/core/cli/ui/tui'

describe('CLI UI primitives', () => {
  it('renders the shared Bakin TUI screen header', () => {
    const output = renderToString(
      <ScreenHeader title="Doctor" subtitle="Offline diagnostics from this machine" meta="mode: offline" />,
    )
    const lines = output.split('\n')

    expect(lines[0]).toBe('')
    expect(lines[1]).toBe('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
    expect(lines[2]).toBe("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(lines[3]).toBe('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')
    expect(lines[4]).toBe('')
    expect(output).toContain('Doctor  mode: offline')
    expect(output).toContain('Offline diagnostics from this machine')
  })

  it('renders shared TUI sections, status tokens, and remediation rows', () => {
    const output = renderToString(
      <Section title="Local checks">
        <FindingRows rows={[{
          status: 'warn',
          label: 'agent-assets',
          message: '1 agent-package projection needs repair.',
          next: 'bakin install agent-assets',
        }]} />
      </Section>,
    )

    expect(output).toContain('LOCAL CHECKS\n------------')
    expect(output).toContain(' WARN      agent-assets')
    expect(output).toContain('1 agent-package projection needs repair.')
    expect(output).toContain('Next: bakin install agent-assets')
    expect(output).not.toContain('[WARN]')
  })

  it('renders shared TUI summaries, progress, and next actions', () => {
    const output = renderToString(
      <>
        <SummaryStrip items={[
          { label: 'complete', value: 6, status: 'ok' },
          { label: 'pending', value: 3, status: 'todo' },
        ]} />
        <ProgressMeter label="Setting up this machine" current={7} total={11} percent={64} />
        <NextActions actions={['Run `bakin doctor --full` after `bakin start`.']} />
      </>,
    )

    expect(output).toContain(' OK       6 complete')
    expect(output).toContain(' TODO     3 pending')
    expect(output).toContain('Setting up this machine  7/11 steps  64%')
    expect(output).toContain('###################-----------')
    expect(output).toContain('NEXT\n------------')
    expect(output).toContain('- Run `bakin doctor --full` after `bakin start`.')
    expect(output.endsWith('\n')).toBe(true)
  })

  it('renders shared TUI status tokens without color when requested', () => {
    const output = renderToString(<StatusToken status="fail" color={false} />)

    expect(output).toBe(' FAIL')
  })

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
        marginTop={1}
      />,
    )

    expect(output).toContain('INSTALL OFFICIAL PLUGINS')
    expect(output).toContain('Use up/down to move, space to select, enter to continue.')
    expect(output).toContain('\u276f [Messaging]')
    expect(output).toContain('\u2714')
    expect(output).toContain('[Messaging]')
    expect(output).toContain('Planning and approvals')
    expect(output).toContain('[Projects] (installed)')
  })

  it('can embed multi-select without repeating the title', () => {
    const items = [
      { id: 'messaging', label: 'Messaging', description: 'Planning and approvals', selected: true },
    ]
    const output = renderToString(
      <MultiSelect
        title="Install official plugins"
        items={items}
        state={createMultiSelectState(items)}
        onChange={() => {}}
        onSubmit={() => {}}
        showTitle={false}
      />,
    )

    expect(output).not.toContain('INSTALL OFFICIAL PLUGINS')
    expect(output).toContain('Use up/down to move, space to select, enter to continue.')
    expect(output).toContain('\u276f [Messaging]')
  })
})
