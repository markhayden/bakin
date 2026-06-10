// @vitest-environment jsdom
/**
 * TaskRunHistory outcome rendering (#476): the header carries the task-level
 * outcome badge, the per-run `settled` badge is blue (green is reserved for
 * task done), and the section still renders nothing without runs.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-task-run-history-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// Inert — the component never touches the store/ledger (it renders hook data),
// but the isolation rules want the surface closed.
mock.module('../../../src/core/task-store', () => ({
  getTaskWithColumn: () => null,
}))
mock.module('../../../src/core/execution-ledger', () => ({
  getCompletion: () => null,
  listRunsByTask: () => [],
}))

interface HookResult {
  runs: Array<Record<string, unknown>>
  outcome?: { state: string; completedAt?: string; agent?: string }
  loading: boolean
}
let hookResult: HookResult = { runs: [], loading: false }

mock.module('@makinbakin/sdk/hooks', () => ({
  useTaskRunHistory: () => hookResult,
}))
mock.module('@makinbakin/sdk/ui', () => ({
  Badge: ({ children, className }: { children?: unknown; className?: string }) => (
    <span data-testid="badge" className={className}>{children as never}</span>
  ),
  Separator: () => <hr />,
}))

const { TaskRunHistory } = await import('../../../plugins/tasks/components/task-run-history')

function run(over: Record<string, unknown> = {}) {
  return {
    runId: 'task:t1:d1',
    taskId: 't1',
    seq: 1,
    agent: 'pixel',
    status: 'settled',
    startedAt: '2026-06-08T12:00:00.000Z',
    settledAt: '2026-06-08T12:01:00.000Z',
    durationMs: 60000,
    ...over,
  }
}

beforeEach(() => {
  hookResult = { runs: [], loading: false }
})

describe('TaskRunHistory task outcome', () => {
  it('shows a done outcome badge in the header', () => {
    hookResult = { runs: [run()], outcome: { state: 'done', completedAt: '2026-06-08T12:01:00.000Z', agent: 'pixel' }, loading: false }
    render(<TaskRunHistory taskId="t1" />)
    expect(screen.getByText('done')).toBeDefined()
  })

  it('shows an in-progress outcome so a settled run does not read as success', () => {
    hookResult = { runs: [run()], outcome: { state: 'in_progress' }, loading: false }
    render(<TaskRunHistory taskId="t1" />)
    expect(screen.getByText('in progress')).toBeDefined()
  })

  it('shows a blocked outcome badge', () => {
    hookResult = { runs: [run()], outcome: { state: 'blocked' }, loading: false }
    render(<TaskRunHistory taskId="t1" />)
    expect(screen.getByText('blocked')).toBeDefined()
  })

  it('renders the settled badge blue, never green', () => {
    hookResult = { runs: [run()], outcome: { state: 'in_progress' }, loading: false }
    render(<TaskRunHistory taskId="t1" />)
    const settled = screen.getByText('settled')
    expect(settled.className).toContain('blue')
    expect(settled.className).not.toContain('green')
  })

  it('reserves green for the done outcome badge', () => {
    hookResult = { runs: [run()], outcome: { state: 'done', completedAt: '2026-06-08T12:01:00.000Z' }, loading: false }
    render(<TaskRunHistory taskId="t1" />)
    expect(screen.getByText('done').className).toContain('green')
  })

  it('renders nothing without runs, even when an outcome exists', () => {
    hookResult = { runs: [], outcome: { state: 'done' }, loading: false }
    const { container } = render(<TaskRunHistory taskId="t1" />)
    expect(container.innerHTML).toBe('')
  })
})
