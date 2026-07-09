import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Isolation guard BEFORE app imports: the harness re-points BAKIN_HOME to its
// own mkdtemp home per test; this seed only guarantees no module-load path
// ever resolves the real ~/.bakin (per CLAUDE.md env-before-imports rule).
const seedHome = mkdtempSync(join(tmpdir(), 'bakin-mock-failure-contract-'))
process.env.BAKIN_HOME = seedHome

afterAll(() => {
  rmSync(seedHome, { recursive: true, force: true })
})

// Content-dir mocks DELEGATE to BAKIN_HOME (not a fixed dir) so the harness's
// per-test mkdtemp home keeps working while ~/.bakin stays unreachable.
const home = () => process.env.BAKIN_HOME!
const mockedContentDir = {
  getContentDir: () => home(),
  getBakinPaths: () => ({
    home: home(),
    memoryLog: join(home(), 'MEMORY-LOG.md'),
    audit: join(home(), 'audit.jsonl'),
    assets: join(home(), 'assets'),
    'assets.store': join(home(), 'assets', 'store'),
    'assets.inbox': join(home(), 'assets', 'inbox'),
    'assets.trash': join(home(), 'assets', '.trash'),
    agents: join(home(), 'agents'),
    personas: join(home(), 'team', 'personas'),
    team: join(home(), 'team'),
    heartbeats: join(home(), 'heartbeats'),
    inbox: join(home(), 'inbox'),
    tasks: join(home(), 'tasks'),
    workflows: join(home(), 'workflows'),
    brands: join(home(), 'brands'),
    chat: join(home(), 'chat'),
    settings: join(home(), 'settings.json'),
    logs: join(home(), 'logs'),
    antfly: join(home(), 'antfly'),
    db: join(home(), 'bakin.db'),
  }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)

import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
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

    // Gateway error frames are now typed RuntimeErrors passed through
    // unwrapped (the old 'OpenClaw chat failed:' wrap stripped `cause` and
    // broke classification).
    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'This should fail',
    })).rejects.toThrow('Mock error mode; code=mock_error')

    // Streams never throw from iteration (SPEC R5 contract): the terminal
    // failure surfaces as one `error` chunk carrying the typed kind, then end.
    const chunks = await collect(runtime.messaging.stream({
      agentId: 'jessica',
      content: 'This stream should fail',
    }))
    const last = chunks[chunks.length - 1] as { type: string; content?: string; data?: { kind?: string } }
    expect(last.type).toBe('error')
    expect(last.content).toContain('Mock error mode; code=mock_error')
    expect(typeof last.data?.kind).toBe('string')
    expect(chunks.some((c) => (c as { type: string }).type === 'done')).toBe(false)
  })

  it('rejects raw tool calls when the mock tool gateway returns an error', async () => {
    harness = await createImitationCrabHarness({ toolMode: 'error' })
    const { runtime } = harness.services

    await expect(runtime.tools.invoke('pixel', 'message_send', { message: 'hello' }))
      .rejects.toThrow('OpenClaw invokeTool failed (500)')

    await expect(runtime.channels!.sendMessage({
      channels: ['discord'],
      message: { body: 'This channel message should fail' },
    })).resolves.toEqual(expect.objectContaining({
      deliveries: [expect.objectContaining({ channelId: 'discord' })],
    }))
  })
})
