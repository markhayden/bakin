// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TaskSummary } from '../../../plugins/tasks/hooks/use-task-summary'

const testDir = join(tmpdir(), `bakin-test-tasks-badge-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md (this test touches neither, but
// the provider lives under a plugin so the rule applies).
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
// Defensive: the provider's real data hook is mocked below so task-store
// never loads, but satisfy the isolation checker so it can't ever leak.
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: () => ({ columns: { blocked: [], review: [] } }),
}))

// Controllable summary returned by the mocked hook.
let mockSummary: TaskSummary | null = null
mock.module('../../../plugins/tasks/hooks/use-task-summary', () => ({
  useTaskSummary: () => ({ summary: mockSummary, refresh: async () => {} }),
}))

const setNavBadge = mock()
mock.module('@makinbakin/sdk', () => ({ setNavBadge }))

import { cleanup, render } from '@testing-library/react'
import { TasksBadgeProvider } from '../../../plugins/tasks/components/tasks-badge-provider'

beforeEach(() => {
  mockSummary = null
  setNavBadge.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('TasksBadgeProvider', () => {
  it('renders nothing', () => {
    const { container } = render(<TasksBadgeProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a red error badge with the blocked count (blocked beats review)', () => {
    mockSummary = { blocked: 3, review: 5 }
    render(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenCalledWith('tasks', 'tasks', { count: 3, tone: 'error' })
  })

  it('falls back to an amber attention badge with the review count when nothing is blocked', () => {
    mockSummary = { blocked: 0, review: 5 }
    render(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenCalledWith('tasks', 'tasks', { count: 5, tone: 'attention' })
  })

  it('clears the badge (null) when neither blocked nor review has tasks', () => {
    mockSummary = { blocked: 0, review: 0 }
    render(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenCalledWith('tasks', 'tasks', null)
  })

  it('does not call setNavBadge before the summary has loaded', () => {
    mockSummary = null
    render(<TasksBadgeProvider />)
    expect(setNavBadge).not.toHaveBeenCalled()
  })

  it('transitions blocked → review → cleared as the summary changes', () => {
    mockSummary = { blocked: 2, review: 1 }
    const { rerender } = render(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 2, tone: 'error' })

    mockSummary = { blocked: 0, review: 1 }
    rerender(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 1, tone: 'attention' })

    mockSummary = { blocked: 0, review: 0 }
    rerender(<TasksBadgeProvider />)
    expect(setNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', null)
  })
})
