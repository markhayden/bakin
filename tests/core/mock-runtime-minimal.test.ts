/**
 * R24 — the mock runtime defaults to the MINIMAL capability shape.
 *
 * `channels` and `cron` are OPTIONAL members of the runtime contract (the Pi
 * adapter omits both in production). The old mock always provided them, so
 * plugin code that skipped feature-detection passed its tests and then threw
 * on Pi (audit finding H2). The default mock now omits both; tests that
 * legitimately need those surfaces opt in via mockChannels()/mockCron().
 *
 * Pure contract-shape tests — no filesystem, no app modules with side effects.
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// Pure contract-shape test — nothing here touches the filesystem — but the
// repo-wide isolation rule mocks the content-dir resolvers unconditionally so
// no import chain can ever reach ~/.bakin (CLAUDE.md Testing Rules).
const testDir = join(tmpdir(), `bakin-test-mock-minimal-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))

import {
  createMockRuntimeAdapter,
  mockChannels,
  mockCron,
} from '../../packages/core/src/adapters/runtime/testing'

describe('createMockRuntimeAdapter minimal default (R24)', () => {
  it('omits channels and cron by default', () => {
    const runtime = createMockRuntimeAdapter()
    expect(runtime.channels).toBeUndefined()
    expect(runtime.cron).toBeUndefined()
  })

  it('a bare channels deref now fails instead of silently passing', () => {
    const runtime = createMockRuntimeAdapter()
    // The audit's failure mode: plugin code calling runtime.channels.list()
    // without feature-detecting. Against the default mock this is a TypeError
    // — the test-level safety net that used to be absent.
    expect(() =>
      (runtime as { channels: NonNullable<typeof runtime.channels> }).channels.list(),
    ).toThrow(TypeError)
    expect(() =>
      (runtime as { cron: NonNullable<typeof runtime.cron> }).cron.list(),
    ).toThrow(TypeError)
  })

  it('capabilities are honest for the minimal shape: delivery unavailable', async () => {
    const runtime = createMockRuntimeAdapter()
    const caps = await runtime.capabilities()
    expect(caps.delivery.mode).toBe('unavailable')
  })

  it('opting into channels restores the surface AND flips delivery to native', async () => {
    const runtime = createMockRuntimeAdapter({ channels: mockChannels() })
    expect(runtime.channels).toBeDefined()
    await expect(runtime.channels!.list()).resolves.toEqual([])
    const caps = await runtime.capabilities()
    expect(caps.delivery.mode).toBe('native')
  })

  it('opting into cron restores the surface without touching delivery', async () => {
    const runtime = createMockRuntimeAdapter({ cron: mockCron() })
    expect(runtime.cron).toBeDefined()
    const job = await runtime.cron!.create({ name: 'j', schedule: '* * * * *', command: 'x' })
    expect(job.enabled).toBe(true)
    const caps = await runtime.capabilities()
    expect(caps.delivery.mode).toBe('unavailable')
  })

  it('a capabilities override wins over the honesty fixup', async () => {
    const runtime = createMockRuntimeAdapter({
      channels: mockChannels(),
      capabilities: async () => ({
        toolCalling: { mode: 'native' as const, access: { style: 'in-process' as const } },
        delivery: { mode: 'unavailable' as const },
        imageGen: { mode: 'unavailable' as const },
        memory: { mode: 'unavailable' as const },
        sessions: { mode: 'unavailable' as const },
        workspaceFiles: { mode: 'unavailable' as const },
        concurrency: { sameAgentTurns: 'serialized' as const },
        input: { imageInput: false, audioInput: false },
      }),
    })
    const caps = await runtime.capabilities()
    expect(caps.toolCalling.access.style).toBe('in-process')
    expect(caps.delivery.mode).toBe('unavailable')
  })
})
