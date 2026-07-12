/**
 * REST boundary validation for POST /api/runtime/switch — a type-confused
 * body (dryRun: "true") must 400, never silently run a REAL switch (the
 * preview flag failing open is the one mistake this endpoint cannot make).
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-switch-request-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { RuntimeSwitchRequestSchema } from '../../src/core/runtime-switch'

describe('RuntimeSwitchRequestSchema', () => {
  it('accepts a plain target and boolean flags', () => {
    expect(RuntimeSwitchRequestSchema.safeParse({ target: 'pi' }).success).toBe(true)
    expect(RuntimeSwitchRequestSchema.safeParse({ target: 'pi', dryRun: true, copyWorkspaces: false }).success).toBe(true)
  })

  it("rejects string booleans — dryRun: 'true' must never fail open into a real switch", () => {
    expect(RuntimeSwitchRequestSchema.safeParse({ target: 'pi', dryRun: 'true' }).success).toBe(false)
    expect(RuntimeSwitchRequestSchema.safeParse({ target: 'pi', copyWorkspaces: 'false' }).success).toBe(false)
  })

  it('rejects a missing/empty target and typo\'d keys', () => {
    expect(RuntimeSwitchRequestSchema.safeParse({}).success).toBe(false)
    expect(RuntimeSwitchRequestSchema.safeParse({ target: '' }).success).toBe(false)
    expect(RuntimeSwitchRequestSchema.safeParse({ target: 'pi', dryrun: true }).success).toBe(false)
  })
})
