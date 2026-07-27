/**
 * Vision transport + model resolution (D8/T8). Provider calls are ALWAYS
 * mocked — no real billed calls. Invalid model output is an ERROR, never a
 * fabricated result.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-enrich-prov-${Date.now()}`)

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
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  callDirectVisionProvider,
  type DirectVisionRequest,
} from '../../../packages/core/src/media/direct-vision-provider'
import { resolveEnrichmentModel } from '@bakin/assets/lib/enrichment/providers'

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'] as const
const savedEnv = new Map<string, string | undefined>()

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'pic.png'), 'bytes')
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(testDir, { recursive: true, force: true })
})

function req(overrides: Partial<DirectVisionRequest>): DirectVisionRequest {
  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    apiKey: 'test-key',
    kind: 'image',
    mediaPath: join(testDir, 'pic.png'),
    mediaMime: 'image/png',
    ...overrides,
  }
}

const jsonFetch = (body: unknown) => (async () =>
  new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('callDirectVisionProvider', () => {
  it('anthropic: parses the text block as strict JSON', async () => {
    const result = await callDirectVisionProvider(req({
      fetchImpl: jsonFetch({ content: [{ type: 'text', text: '{"caption":"a red square","ocrText":"HI","suggestedTags":["red"]}' }] }),
    }))
    expect(result.caption).toBe('a red square')
    expect(result.ocrText).toBe('HI')
  })

  it('openai: reads choices[0].message.content; tolerates code fences', async () => {
    const result = await callDirectVisionProvider(req({
      provider: 'openai',
      model: 'gpt-4o',
      fetchImpl: jsonFetch({ choices: [{ message: { content: '```json\n{"caption":"fenced"}\n```' } }] }),
    }))
    expect(result.caption).toBe('fenced')
  })

  it('google: joins candidate parts; audio kind is accepted', async () => {
    writeFileSync(join(testDir, 'memo.mp3'), 'audio-bytes')
    const result = await callDirectVisionProvider(req({
      provider: 'google',
      model: 'gemini-2.5-flash',
      kind: 'audio',
      mediaPath: join(testDir, 'memo.mp3'),
      mediaMime: 'audio/mpeg',
      fetchImpl: jsonFetch({ candidates: [{ content: { parts: [{ text: '{"transcript":"hello world","caption":"a voice memo"}' }] } }] }),
    }))
    expect(result.transcript).toBe('hello world')
  })

  it('surfaces provider token usage from all three transports (#747 metering rider)', async () => {
    const anthropic = await callDirectVisionProvider(req({
      fetchImpl: jsonFetch({
        content: [{ type: 'text', text: '{"caption":"a"}' }],
        usage: { input_tokens: 1200, output_tokens: 45 },
      }),
    }))
    expect(anthropic.usage).toEqual({ inputTokens: 1200, outputTokens: 45 })

    const openai = await callDirectVisionProvider(req({
      provider: 'openai', model: 'gpt-4o',
      fetchImpl: jsonFetch({
        choices: [{ message: { content: '{"caption":"b"}' } }],
        usage: { prompt_tokens: 900, completion_tokens: 30 },
      }),
    }))
    expect(openai.usage).toEqual({ inputTokens: 900, outputTokens: 30 })

    const google = await callDirectVisionProvider(req({
      provider: 'google', model: 'gemini-2.0-flash',
      fetchImpl: jsonFetch({
        candidates: [{ content: { parts: [{ text: '{"caption":"c"}' }] } }],
        usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 25 },
      }),
    }))
    expect(google.usage).toEqual({ inputTokens: 700, outputTokens: 25 })
  })

  it('usage absent from the response → usage undefined, never fabricated', async () => {
    const result = await callDirectVisionProvider(req({
      fetchImpl: jsonFetch({ content: [{ type: 'text', text: '{"caption":"no usage"}' }] }),
    }))
    expect(result.usage).toBeUndefined()
  })

  it('anthropic/openai REJECT audio input (no guessing at unsupported transports)', async () => {
    writeFileSync(join(testDir, 'memo.mp3'), 'audio-bytes')
    const audio = { kind: 'audio' as const, mediaPath: join(testDir, 'memo.mp3'), mediaMime: 'audio/mpeg' }
    expect(callDirectVisionProvider(req({ ...audio }))).rejects.toThrow(/does not accept audio/)
    expect(callDirectVisionProvider(req({ ...audio, provider: 'openai', model: 'gpt-4o' }))).rejects.toThrow(/does not accept audio/)
  })

  it('non-JSON output is an ERROR — never fabricated', async () => {
    expect(callDirectVisionProvider(req({
      fetchImpl: jsonFetch({ content: [{ type: 'text', text: 'A lovely image of a square!' }] }),
    }))).rejects.toThrow(/non-JSON/)
  })

  it('schema-invalid output is an ERROR (no caption/summary/transcript)', async () => {
    expect(callDirectVisionProvider(req({
      fetchImpl: jsonFetch({ content: [{ type: 'text', text: '{"suggestedTags":["only-tags"]}' }] }),
    }))).rejects.toThrow(/validation/)
  })

  it('provider HTTP errors surface with status', async () => {
    const failing = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch
    expect(callDirectVisionProvider(req({ fetchImpl: failing }))).rejects.toThrow(/429/)
  })
})

describe('resolveEnrichmentModel', () => {
  it('auto picks the cheapest model whose provider has a configured key', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    const resolved = resolveEnrichmentModel({ enrichmentProvider: 'auto' })
    // anthropic budget model is first in tier order but has no key → openai standard wins
    expect(resolved?.descriptor.id).toBe('openai/gpt-4o')
    expect(resolved?.keySource).toBe('env')
  })

  it('tier order prefers budget when its provider is configured', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-a'
    process.env.OPENAI_API_KEY = 'sk-o'
    expect(resolveEnrichmentModel({})?.descriptor.id).toBe('anthropic/claude-haiku-4-5')
  })

  it('needsAudio narrows to audio-capable transports (google)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-a'
    expect(resolveEnrichmentModel({}, { needsAudio: true })).toBeNull()
    process.env.GEMINI_API_KEY = 'g-key'
    expect(resolveEnrichmentModel({}, { needsAudio: true })?.descriptor.id).toBe('google/gemini-2.5-flash')
  })

  it('explicit model override wins; disabled kills everything', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-a'
    expect(resolveEnrichmentModel({ enrichmentModel: 'anthropic/claude-sonnet-4-6' })?.descriptor.apiModel).toBe('claude-sonnet-4-6')
    expect(resolveEnrichmentModel({ enrichmentEnabled: false })).toBeNull()
  })
})
