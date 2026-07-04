/**
 * Memory ⌘K hit renderer — hits deep-link to the exact record via
 * /memory?recordId=<rowId>, not a fuzzy ?q= re-search.
 */
import { describe, it, expect, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-memory-hit-renderer',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import '../../../plugins/memory/client'
import { getSearchHitRenderer } from '../../../packages/sdk/src/register'
import type { SearchResult } from '../../../packages/sdk/src/types/services'

const hit = (id: string, fields: Record<string, unknown> = {}): SearchResult =>
  ({ id, table: 'bakin_memory', score: 1, fields })

describe('memory hit renderer', () => {
  it('deep-links to the exact record by rowId', () => {
    const d = getSearchHitRenderer('memory')!(
      hit('durable:abc123', { tier: 'durable', agent: 'chef', content: 'soul body' }),
    )
    expect(d.href).toBe(`/memory?recordId=${encodeURIComponent('durable:abc123')}`)
    expect(d.subtitle).toContain('durable')
    expect(d.subtitle).toContain('chef')
    expect(d.icon).toBe('brain')
  })
})
