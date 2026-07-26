import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure binding under test — content-dir mocks are the standing isolation
// guard so an accidental future import can never reach ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-delivery-binding-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { sendApiFromTransport, type DiscordTransport } from '../../../src/core/delivery/discord/client'

/**
 * The binding is the ONE layer unit tests of send/approvals don't exercise
 * (they fake the SendApi). Live validation caught `components` being
 * silently dropped here — approval cards rendered without buttons. Pin the
 * full payload pass-through.
 */
describe('sendApiFromTransport payload mapping', () => {
  it('forwards content, embeds, components, and files to the REST call', async () => {
    const calls: Array<{ channelId: string; body: Record<string, unknown> }> = []
    const transport = {
      api: {
        channels: {
          createMessage: async (channelId: string, body: Record<string, unknown>) => {
            calls.push({ channelId, body })
            return { id: 'm1' }
          },
        },
      },
    } as unknown as DiscordTransport

    const api = sendApiFromTransport(transport)
    await api.createMessage('123', {
      content: 'hello',
      embeds: [{ title: 'card' }],
      components: [{ type: 1, components: [{ type: 2, custom_id: 'bkap:approve:', label: 'Approve', style: 1 }] }],
      files: [{ name: 'a.txt', data: new Uint8Array([1]), contentType: 'text/plain' }],
    })

    expect(calls).toHaveLength(1)
    const body = calls[0].body
    expect(body.content).toBe('hello')
    expect(body.embeds).toEqual([{ title: 'card' }])
    expect(body.components).toEqual([
      { type: 1, components: [{ type: 2, custom_id: 'bkap:approve:', label: 'Approve', style: 1 }] },
    ])
    expect((body.files as unknown[]).length).toBe(1)
  })

  it('omits absent fields instead of sending empty keys', async () => {
    const calls: Array<Record<string, unknown>> = []
    const transport = {
      api: { channels: { createMessage: async (_id: string, body: Record<string, unknown>) => { calls.push(body); return { id: 'm2' } } } },
    } as unknown as DiscordTransport

    await sendApiFromTransport(transport).createMessage('123', { content: 'plain' })
    expect(Object.keys(calls[0])).toEqual(['content'])
  })
})
