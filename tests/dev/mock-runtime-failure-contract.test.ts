import { afterEach, describe, expect, it } from 'bun:test'
import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // Iteration is the contract: streaming failures surface while consuming.
  }
}

describe('imitation-crab runtime failure contract', () => {
  let harness: ImitationCrabHarness | null = null

  afterEach(async () => {
    await harness?.close()
    harness = null
  })

  it('rejects loudly when the mock chat gateway returns an error', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'error' })
    const { runtime } = harness.services

    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'This should fail',
    })).rejects.toThrow('OpenClaw chat failed: Mock error mode; code=mock_error')

    await expect(drain(runtime.messaging.stream({
      agentId: 'jessica',
      content: 'This stream should fail',
    }))).rejects.toThrow('OpenClaw chat failed: Mock error mode; code=mock_error')
  })

  it('rejects raw tool calls when the mock tool gateway returns an error', async () => {
    harness = await createImitationCrabHarness({ toolMode: 'error' })
    const { runtime } = harness.services

    await expect(runtime.tools.invoke('pixel', 'message_send', { message: 'hello' }))
      .rejects.toThrow('OpenClaw invokeTool failed (500)')

    await expect(runtime.channels.sendMessage({
      channels: ['discord'],
      message: { body: 'This channel message should fail' },
    })).resolves.toEqual(expect.objectContaining({
      deliveries: [expect.objectContaining({ channelId: 'discord' })],
    }))
  })
})
