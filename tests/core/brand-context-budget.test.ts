/**
 * Brand context budget clamp (#419, spec §5.2).
 *
 * dispatch.maxBrandContextBytes governs the brand card's share of the
 * dispatch prompt: unset/0/invalid → 12288 default, floor 1024. Mirrors
 * resolveWorkflowContextBudget semantics exactly.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-brand-budget-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({ dispatch: {} }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({ invoke: mock().mockResolvedValue(undefined), has: () => false, register: mock() }),
}))
// Not under test — their import chains reach runtime adapters.
mock.module('../../src/core/agent-packages/lesson-retrieval', () => ({
  formatLessonsForDispatch: () => '',
  retrieveAgentPackageLessons: mock().mockResolvedValue([]),
}))
mock.module('../../src/core/dispatch-failures', () => ({
  formatDispatchError: (e: unknown) => String(e),
}))

import { resolveBrandContextBudget } from '../../src/core/dispatch-context-blocks'

describe('resolveBrandContextBudget', () => {
  it('defaults when unset/zero/invalid and clamps to the minimum', () => {
    expect(resolveBrandContextBudget(undefined)).toBe(12288)
    expect(resolveBrandContextBudget(0)).toBe(12288)
    expect(resolveBrandContextBudget(-5)).toBe(12288)
    expect(resolveBrandContextBudget(Number.NaN)).toBe(12288)
    expect(resolveBrandContextBudget(10)).toBe(1024)
    expect(resolveBrandContextBudget(20000)).toBe(20000)
    expect(resolveBrandContextBudget(4096.7)).toBe(4096)
  })
})
