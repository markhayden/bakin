/**
 * Re-homing table rows 189–190 (brands.integrity): broken references are the
 * operator's decision on the brand's recover page (required while tasks wait
 * on the brand or a manifest is unreadable); stale drafts are an observation.
 * Emission rides detach-refs.test.ts (the activated-plugin harness).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-brands-rehoming-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { BRANDS_INTEGRITY_INCIDENTS } from '../../../plugins/brands/lib/health-checks'

describe('brands re-homing — catalog', () => {
  it('row 189 is the one family (owner-decides); row 190 is an observation', () => {
    expect(BRANDS_INTEGRITY_INCIDENTS).toEqual([
      { id: 'integrity', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
    ])
  })
})
