import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-facade-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createPluginRuntimeFacade } from '../../src/lib/plugin-context-services'

describe('createPluginRuntimeFacade', () => {
  it('exposes runtime image generation without exposing generic runtime tools', async () => {
    const runtime = createMockRuntimeAdapter({
      images: {
        providers: mock(async () => [{ id: 'openai', configured: true, models: ['gpt-image-2'] }]),
        generate: mock(async () => ({ images: [{ filePath: '/tmp/image.png' }] })),
        edit: mock(async () => ({ images: [{ filePath: '/tmp/edited.png' }] })),
      },
    })

    const facade = createPluginRuntimeFacade(runtime)

    await expect(facade.images!.providers()).resolves.toEqual([
      expect.objectContaining({ id: 'openai', configured: true }),
    ])
    // The tools surface is gone from the contract — the facade must not
    // resurrect it.
    expect((facade as unknown as Record<string, unknown>).tools).toBeUndefined()
  })

  it('binds sessions.contextStats through when the adapter exposes it (this-binding + args verbatim)', async () => {
    const base = createMockRuntimeAdapter()
    const seen: Array<{ agentId: string; threadId: string }> = []
    const runtime = {
      ...base,
      sessions: {
        ...base.sessions,
        contextStats: async function (this: unknown, opts: { agentId: string; threadId: string }) {
          seen.push(opts)
          return { tokens: 45_300, contextWindow: 272_000, compactionThreshold: null }
        },
      },
    }
    const facade = createPluginRuntimeFacade(runtime)
    const stats = await facade.sessions.contextStats?.({ agentId: 'main', threadId: 'chat:abc' })
    expect(stats).toMatchObject({ tokens: 45_300, contextWindow: 272_000 })
    expect(seen).toEqual([{ agentId: 'main', threadId: 'chat:abc' }])
  })

  it('omits sessions.contextStats when the adapter omits it — absence stays absence', () => {
    const runtime = createMockRuntimeAdapter() // minimal shape: no contextStats
    const facade = createPluginRuntimeFacade(runtime)
    // Must be truly undefined (feature-detection contract) — a defined
    // throwing stub would be the dishonesty conformance bans.
    expect(facade.sessions.contextStats).toBeUndefined()
  })
})
