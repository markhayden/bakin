/**
 * Schedule ⌘K hit renderer — global-search hits deep-link to the job
 * drawer via /schedule?jobId=<id> (the page already consumes ?jobId=).
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-schedule-hit-renderer',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import '../../../plugins/schedule/client'
import { getSearchHitRenderer } from '../../../packages/sdk/src/register'
import type { SearchResult } from '../../../packages/sdk/src/types/registration'

const hit = (id: string, fields: Record<string, unknown> = {}): SearchResult =>
  ({ id, table: 'bakin_schedule', score: 1, fields })

describe('schedule hit renderer', () => {
  let render: NonNullable<ReturnType<typeof getSearchHitRenderer>>

  beforeEach(() => {
    const renderer = getSearchHitRenderer('schedule')
    expect(renderer).toBeDefined()
    render = renderer!
  })

  it('deep-links to the job drawer with the raw job id', () => {
    const d = render(hit('job-abc', { name: 'Nightly sweep', schedule: '0 2 * * *', agent: 'patch' }))
    expect(d.href).toBe('/schedule?jobId=job-abc')
    expect(d.title).toBe('Nightly sweep')
    expect(d.subtitle).toContain('0 2 * * *')
    expect(d.subtitle).toContain('patch')
    expect(d.icon).toBe('calendar')
  })

  it('URL-encodes ids with special characters', () => {
    const d = render(hit('job with spaces&x', { name: 'x' }))
    expect(d.href).toBe(`/schedule?jobId=${encodeURIComponent('job with spaces&x')}`)
  })

  it('falls back to the id when name is missing', () => {
    const d = render(hit('job-2'))
    expect(d.title).toBe('job-2')
    expect(d.href).toBe('/schedule?jobId=job-2')
  })
})
