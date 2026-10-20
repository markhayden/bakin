// @vitest-environment jsdom
/**
 * ActivityFailureGroups (issue 966b review): a deep-link request that is
 * already pending when the component MOUNTS — an exact-target fetch clears
 * the resource and remounts it — opens the details in that first render,
 * exactly as a request arriving later does.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'
import { ActivityFailureGroups } from '../../../plugins/health/components/activity-failure-groups'
import type { UsageFailureGroup } from '../../../plugins/health/types'

const group: UsageFailureGroup = {
  kind: 'rest', name: '/api/plugins/search/reindex', destination: '/api/plugins/search/reindex', method: null,
  attempts: 1, failures: 1,
  firstFailureAt: '2026-07-12T12:02:00.000Z', lastFailureAt: '2026-07-12T12:02:00.000Z',
  agents: [], unattributedFailures: 0, systemFailures: 1, medianFailureDurationMs: 340,
  latestFailure: {
    id: 'usage-rest-failure', ts: '2026-07-12T12:02:00.000Z', kind: 'rest', activityClass: 'routine',
    name: '/api/plugins/search/reindex', agent: null, durationMs: 340, status: 'error', meta: { statusCode: 500 },
  },
} as UsageFailureGroup
const baseProps = {
  groups: [group],
  failures: [group.latestFailure!],
  totalFailures: 1,
  unverified: [],
  totalUnverified: 0,
  buckets: [],
  coverage: { startsAt: '2026-07-12T11:10:00.000Z', hasFullWindow: true as const, reason: 'full_window' as const },
  page: { total: 1, offset: 0, limit: 25, hasMore: false },
}
const disclosure = () => document.getElementById('activity-failure-pattern-disclosure')
afterEach(cleanup)

describe('ActivityFailureGroups — pending request at mount', () => {
  it('mounts expanded when a deep-link request is already pending', () => {
    render(<ActivityFailureGroups {...baseProps} failureRequest={{ requestId: 7, kind: 'rest', destination: '/api/plugins/search/reindex', method: null }} />)
    expect(disclosure()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('stays collapsed without a request, and opens when one arrives', () => {
    const view = render(<ActivityFailureGroups {...baseProps} />)
    expect(disclosure()?.getAttribute('aria-expanded')).toBe('false')
    view.rerender(<ActivityFailureGroups {...baseProps} failureRequest={{ requestId: 8, kind: 'rest', destination: '/api/plugins/search/reindex', method: null }} />)
    expect(disclosure()?.getAttribute('aria-expanded')).toBe('true')
  })
})
