/**
 * Runtime enrichment engine behavior (spec: enrichment-runtime-fallback
 * §4/§6) — mocked messaging.send, NO live agent calls. Covers the send
 * contract (ephemeral one-shot thread, attachments, no per-turn model —
 * bakin#584), the anti-confabulation sentinel (bakin#583 → failure, not
 * content), fence-stripping, the single corrective re-ask, and transport
 * rejection propagation.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-enrich-rt-engine-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { createRuntimeEngine } from '../../../plugins/assets/lib/enrichment/runtime'
import { createMockRuntimeAdapter } from '../../../packages/core/src/adapters/runtime/testing'
import type { AgentRuntimeAdapter, MessageArgs, MessageResult } from '../../../packages/core/src/adapters/runtime'
import type { EnrichmentJobInput } from '../../../plugins/assets/lib/enrichment/engine'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const GOOD_JSON = '{"caption":"a red barn at dusk","ocrText":"","suggestedTags":["red-barn","dusk","farm"]}'

/** Runtime whose messaging.send replays scripted replies (or throws). */
function scriptedRuntime(replies: Array<string | Error>): { runtime: AgentRuntimeAdapter; sent: MessageArgs[] } {
  const sent: MessageArgs[] = []
  const queue = [...replies]
  const base = createMockRuntimeAdapter()
  const runtime: AgentRuntimeAdapter = {
    ...base,
    messaging: {
      ...base.messaging,
      send: async (args: MessageArgs): Promise<MessageResult> => {
        sent.push(args)
        const next = queue.shift()
        if (next === undefined) throw new Error('scripted runtime exhausted')
        if (next instanceof Error) throw next
        return { id: `msg-${sent.length}`, content: next }
      },
    },
  }
  return { runtime, sent }
}

// Real file on disk: the engine stats + downscale-gates attachments before
// sending (fake paths would fail the size check, correctly).
const fixtureImage = join(testDir, 'v1.png')
mkdirSync(testDir, { recursive: true })
writeFileSync(fixtureImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const imageJob: EnrichmentJobInput = {
  kind: 'image',
  mediaPath: fixtureImage,
  mediaMime: 'image/png',
  jobKey: 'as-123:v1',
}

describe('createRuntimeEngine send contract', () => {
  it('one ephemeral turn on the deterministic thread with the attachment — and NEVER a model override (bakin#584)', async () => {
    const { runtime, sent } = scriptedRuntime([GOOD_JSON])
    const engine = createRuntimeEngine(runtime, 'enrich')
    expect(engine.name).toBe('runtime')
    expect(engine.modelId).toBe('runtime:enrich')

    const result = await engine.run(imageJob)
    expect(result.caption).toBe('a red barn at dusk')
    expect(result.suggestedTags).toEqual(['red-barn', 'dusk', 'farm'])

    expect(sent).toHaveLength(1)
    const args = sent[0]!
    expect(args.agentId).toBe('enrich')
    expect(args.threadId).toBe('enrich:as-123:v1')
    expect(args.ephemeral).toBe(true)
    expect(args.attachments).toEqual([{ path: fixtureImage, mimeType: 'image/png' }])
    expect('model' in args).toBe(false)
    expect(args.content).toContain('{"error":"no-image"}') // anti-confabulation contract in the prompt
  })

  it('document jobs send no attachment and inline the extracted text', async () => {
    const { runtime, sent } = scriptedRuntime(['{"summary":"Quarterly notes about barn repairs.","suggestedTags":["barn-repairs"]}'])
    const engine = createRuntimeEngine(runtime, 'enrich')
    const result = await engine.run({ kind: 'document', extractedText: 'Barn roof fixed in March.', jobKey: 'as-9:v2' })
    expect(result.summary).toContain('Quarterly notes')
    expect(sent[0]!.attachments).toBeUndefined()
    expect(sent[0]!.content).toContain('Barn roof fixed in March.')
  })
})

describe('createRuntimeEngine reply parsing', () => {
  it('accepts JSON wrapped in code fences', async () => {
    const { runtime, sent } = scriptedRuntime(['```json\n' + GOOD_JSON + '\n```'])
    const result = await createRuntimeEngine(runtime, 'enrich').run(imageJob)
    expect(result.caption).toBe('a red barn at dusk')
    expect(sent).toHaveLength(1) // no re-ask needed
  })

  it('the no-image sentinel is a FAILURE (bakin#583), never content — and no re-ask', async () => {
    const { runtime, sent } = scriptedRuntime(['{"error":"no-image"}'])
    await expect(createRuntimeEngine(runtime, 'enrich').run(imageJob))
      .rejects.toThrow('attachment did not reach the model — see bakin#583')
    expect(sent).toHaveLength(1) // re-asking cannot deliver a dropped attachment
  })

  it('garbage → ONE corrective re-ask on the same thread → still garbage → honest failure', async () => {
    const { runtime, sent } = scriptedRuntime(['Sure! Here is what I see: a barn.', 'Certainly, the barn is red.'])
    await expect(createRuntimeEngine(runtime, 'enrich').run(imageJob))
      .rejects.toThrow('not valid JSON')
    expect(sent).toHaveLength(2)
    expect(sent[1]!.threadId).toBe(sent[0]!.threadId)
    expect(sent[1]!.content).toContain('only the JSON object')
  })

  it('garbage → corrective re-ask → valid JSON succeeds', async () => {
    const { runtime, sent } = scriptedRuntime(['Here you go:', GOOD_JSON])
    const result = await createRuntimeEngine(runtime, 'enrich').run(imageJob)
    expect(result.caption).toBe('a red barn at dusk')
    expect(sent).toHaveLength(2)
  })

  it('schema-invalid JSON (no caption/summary/transcript) fails after the re-ask — never fabricated', async () => {
    const { runtime } = scriptedRuntime(['{"suggestedTags":["barn"]}', '{"suggestedTags":["barn"]}'])
    await expect(createRuntimeEngine(runtime, 'enrich').run(imageJob))
      .rejects.toThrow('schema validation')
  })

  it('transport rejection (e.g. oversized attachment) propagates as the failure reason', async () => {
    const { runtime, sent } = scriptedRuntime([new Error('attachment exceeds the 2MB gateway limit')])
    await expect(createRuntimeEngine(runtime, 'enrich').run(imageJob))
      .rejects.toThrow('attachment exceeds the 2MB gateway limit')
    expect(sent).toHaveLength(1)
  })
})
