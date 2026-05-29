// @vitest-environment jsdom
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-content-store-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { useContentStore } from '@/hooks/use-content-store'

beforeEach(() => {
  useContentStore.setState({ doctorVersion: 0, taskboardVersion: 0 })
})

describe('useContentStore — doctorVersion signal', () => {
  it('bumpDoctor increments doctorVersion', () => {
    expect(useContentStore.getState().doctorVersion).toBe(0)
    useContentStore.getState().bumpDoctor()
    expect(useContentStore.getState().doctorVersion).toBe(1)
    useContentStore.getState().bumpDoctor()
    expect(useContentStore.getState().doctorVersion).toBe(2)
  })

  it('bumpDoctor does not touch taskboardVersion (and vice versa)', () => {
    useContentStore.getState().bumpDoctor()
    expect(useContentStore.getState().taskboardVersion).toBe(0)
    useContentStore.getState().bumpTaskboard()
    expect(useContentStore.getState().doctorVersion).toBe(1)
    expect(useContentStore.getState().taskboardVersion).toBe(1)
  })
})
