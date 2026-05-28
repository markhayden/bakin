import { describe, expect, it, mock } from 'bun:test'
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
    await expect(facade.tools.invoke('main', 'image_generate', {})).rejects.toThrow('Runtime tool invocation is not exposed')
  })
})
