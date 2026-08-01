// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-task-filters-${process.pid}-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

mock.module('@makinbakin/sdk/patterns', () => ({
  AgentAvatar: ({ size }: { size?: string }) => <div data-testid="agent-avatar" data-size={size} />,
  AgentFilter: ({ options }: { options: Array<{ visual?: React.ReactNode }> }) => <div data-testid="agent-filter">{options.map((option, index) => <span key={index}>{option.visual}</span>)}</div>,
  FacetFilter: () => <div data-testid="facet-filter" />,
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgentIds: () => ['margo'],
  useAgentStore: (selector: (state: { agentMap: Record<string, { name: string; headshot?: string }>; displaySettings: Record<string, { displayName?: string; accentColor?: string }> }) => unknown) => selector({
    agentMap: { margo: { name: 'Margo' } },
    displaySettings: {},
  }),
}))

import { TaskFilters } from '../../../plugins/tasks/components/task-filters'

afterEach(cleanup)

describe('task filters', () => {
  it('leaves scheduled-task hover feedback to the switch instead of highlighting the row', () => {
    render(
      <TaskFilters
        agentFilter="all"
        onAgentChange={() => {}}
        showScheduled
        onShowScheduledChange={() => {}}
      />,
    )

    const scheduledFilter = screen.getByText('Scheduled Tasks').closest('[data-slot="scheduled-tasks-filter"]')
    expect(scheduledFilter?.className).not.toContain('hover:bg-accent')
    expect(scheduledFilter?.className).not.toContain('hover:text-foreground')
    expect(screen.getByText('Scheduled Tasks').className).toContain('text-bakin-typography-size-body')
    expect(screen.getByRole('switch', { name: /Hide scheduled tasks/ })).toBeTruthy()
    expect(screen.getByTestId('agent-avatar').getAttribute('data-size')).toBe('sm')
  })
})
