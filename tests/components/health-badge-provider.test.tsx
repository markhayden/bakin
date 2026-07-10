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
let mockErrors: number | null = null
mock.module('../../plugins/health/hooks/use-health-summary', () => ({
  useHealthSummary: () => ({ errors: mockErrors }),
}))

// Mock the shared useNavBadge hook — its wiring is covered in
// tests/components/use-nav-badge.test.tsx. Assert the provider derives +
// passes the right badge.
const useNavBadge = mock()
mock.module('@makinbakin/sdk/hooks', () => ({ useNavBadge }))

import { cleanup, render } from '@testing-library/react'
import '../rtl-settle'
import { HealthBadgeProvider } from '../../plugins/health/components/health-badge-provider'

beforeEach(() => {
  mockErrors = null
  useNavBadge.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('HealthBadgeProvider', () => {
  it('renders nothing', () => {
    const { container } = render(<HealthBadgeProvider />)
    expect(container.firstChild).toBeNull()
  })

  it('passes a red error badge with the failing-check count', () => {
    mockErrors = 2
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', { count: 2, tone: 'error' })
  })

  it('passes null when there are zero errors', () => {
    mockErrors = 0
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })

  it('passes null before the summary has loaded', () => {
    mockErrors = null
    render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })

  it('transitions error count → 0 (cleared)', () => {
    mockErrors = 3
    const { rerender } = render(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', { count: 3, tone: 'error' })

    mockErrors = 0
    rerender(<HealthBadgeProvider />)
    expect(useNavBadge).toHaveBeenLastCalledWith('health', 'health', null)
  })
})
