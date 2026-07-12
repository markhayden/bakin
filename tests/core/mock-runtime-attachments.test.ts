/**
 * Mock runtime attachment coverage (T6.3) — the conformance mock echoes
 * attachments in its reply (pass-through assertable end-to-end) and the
 * opt-in mockImageInputCapabilities flips input.imageInput while the
 * minimal default stays honest-false.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-mock-attach-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  createMockRuntimeAdapter,
  mockImageInputCapabilities,
} from '../../packages/core/src/adapters/runtime/testing'

describe('mock runtime attachments', () => {
  it('stream echoes attachment file names in the reply text', async () => {
    const adapter = createMockRuntimeAdapter()
    const chunks: string[] = []
    for await (const chunk of adapter.messaging.stream({
      agentId: 'main',
      content: 'look at this',
      attachments: [{ path: '/tmp/x/shot.png', mimeType: 'image/png' }],
    })) {
      if (chunk.type === 'text') chunks.push(chunk.content)
    }
    expect(chunks.join('')).toContain('[attachments: shot.png]')
  })

  it('send echoes attachments; sends without attachments stay clean', async () => {
    const adapter = createMockRuntimeAdapter()
    const withAtt = await adapter.messaging.send({
      agentId: 'main',
      content: 'see it?',
      attachments: [{ path: '/a/b/ref.jpg', mimeType: 'image/jpeg' }],
    })
    expect(withAtt.content).toContain('[attachments: ref.jpg]')
    const plain = await adapter.messaging.send({ agentId: 'main', content: 'no pixels' })
    expect(plain.content).not.toContain('[attachments')
  })

  it('default mock declares imageInput false; the opt-in override flips it', async () => {
    const minimal = createMockRuntimeAdapter()
    expect((await minimal.capabilities()).input.imageInput).toBe(false)
    const withImages = createMockRuntimeAdapter({ capabilities: mockImageInputCapabilities() })
    expect((await withImages.capabilities()).input.imageInput).toBe(true)
  })
})
