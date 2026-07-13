// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-health-badge-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md (this test touches neither).
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// Controllable error count from the mocked data hook.
let mockCount: number | null = null
let mockTone: 'error' | 'attention' = 'attention'
mock.module('../../plugins/health/hooks/use-health-summary', () => ({
  useHealthSummary: () => ({ count: mockCount, tone: mockTone }),
}))

// Mock the shared useNavBadge hook — its wiring is covered in
// tests/components/use-nav-badge.test.tsx. Assert the provider derives +
// passes the right badge.
const useNavBadge = mock()
mock.module('@makinbakin/sdk/hooks', () => ({ useNavBadge }))

import { render } from '@testing-library/react'
import '../rtl-settle'
import { HealthBadgeProvider } from '../../plugins/health/components/health-badge-provider'

beforeEach(() => {
  mockCount = null
  mockTone = 'attention'
  useNavBadge.mockClear()
})

describe('HealthBadgeProvider', () => {
  it('renders nothing', () => {
    const { container } = render(<HealthBadgeProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('passes a red error badge with the failing-check count', () => {
    mockCount = 2
    mockTone = 'error'
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', { count: 2, tone: 'error' })
  })

  it('passes null when there are zero errors', () => {
    mockCount = 0
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })

  it('passes null before the summary has loaded', () => {
    mockCount = null
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })

  it('transitions error count → 0 (cleared)', () => {
    mockCount = 3
    mockTone = 'error'
    const { rerender } = render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', { count: 3, tone: 'error' })

    mockCount = 0
    rerender(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })
})
