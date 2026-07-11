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
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: () => ({ columns: { blocked: [], review: [] } }),
}))

// Controllable summary returned by the mocked data hook.
let mockSummary: TaskSummary | null = null
mock.module('../../../plugins/tasks/hooks/use-task-summary', () => ({
  useTaskSummary: () => ({ summary: mockSummary }),
}))

// Mock the shared useNavBadge hook — its own behavior (effect-keying,
// setNavBadge wiring) is covered in tests/components/use-nav-badge.test.tsx.
// Here we only assert the provider derives + passes the right badge.
const useNavBadge = mock()
mock.module('@makinbakin/sdk/hooks', () => ({ useNavBadge }))

import { render } from '@testing-library/react'
import '../../rtl-settle'
import { TasksBadgeProvider } from '../../../plugins/tasks/components/tasks-badge-provider'

beforeEach(() => {
  mockSummary = null
  useNavBadge.mockClear()
})

describe('TasksBadgeProvider', () => {
  it('renders nothing', () => {
    const { container } = render(<TasksBadgeProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('passes a red error badge with the blocked count (blocked beats review)', () => {
    mockSummary = { blocked: 3, review: 5 }
    render(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 3, tone: 'error' })
  })

  it('falls back to an amber attention badge with the review count when nothing is blocked', () => {
    mockSummary = { blocked: 0, review: 5 }
    render(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 5, tone: 'attention' })
  })

  it('passes null when neither blocked nor review has tasks', () => {
    mockSummary = { blocked: 0, review: 0 }
    render(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', null)
  })

  it('passes null before the summary has loaded', () => {
    mockSummary = null
    render(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', null)
  })

  it('transitions blocked → review → cleared as the summary changes', () => {
    mockSummary = { blocked: 2, review: 1 }
    const { rerender } = render(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 2, tone: 'error' })

    mockSummary = { blocked: 0, review: 1 }
    rerender(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', { count: 1, tone: 'attention' })

    mockSummary = { blocked: 0, review: 0 }
    rerender(<TasksBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('tasks', 'tasks', null)
  })
})
