/**
 * T2 (#189): direct text-LLM transport — the text sibling of
 * direct-vision-provider. Structured-JSON-out, zod-validated, one
 * malformed-output retry, typed transient/structural errors (dispatch
 * classifies by kind, never message text).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'

const testHome = join(tmpdir(), `bakin-text-provider-test-${Date.now()}`)
process.env.BAKIN_HOME = testHome

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testHome, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testHome, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  callDirectTextProvider,
  DirectTextError,
} from '../../packages/core/src/llm/direct-text-provider'
import { resolveProviderKeySource } from '../../packages/core/src/llm/provider-keys'

const Pick = z.object({ agentId: z.string(), reason: z.string() })
const GOOD = JSON.stringify({ agentId: 'reviewer', reason: 'best match' })

type FetchCall = { url: string; init: RequestInit }

function fetchStub(responses: Array<{ status?: number; body: unknown }>): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let i = 0
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    const r = responses[Math.min(i++, responses.length - 1)]
    return new Response(
      typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
      { status: r.status ?? 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return { impl, calls }
}

const anthropicBody = (text: string) => ({ content: [{ type: 'text', text }] })
const openaiBody = (text: string) => ({ choices: [{ message: { content: text } }] })
const googleBody = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] })

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5-20251001',
    apiKey: 'test-key',
    system: 'You are a router.',
    prompt: 'Pick the best agent.',
    schema: Pick,
    ...overrides,
  }
}

describe('provider request shapes', () => {
  it('anthropic: POST /v1/messages with x-api-key, system, and model', async () => {
    const { impl, calls } = fetchStub([{ body: anthropicBody(GOOD) }])
    const out = await callDirectTextProvider(baseRequest({ fetchImpl: impl }))
    expect(out).toEqual({ agentId: 'reviewer', reason: 'best match' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.model).toBe('claude-haiku-4-5-20251001')
    expect(body.system).toBe('You are a router.')
    expect(body.messages[0].content).toBe('Pick the best agent.')
  })

  it('openai: POST /v1/chat/completions with bearer auth and system message', async () => {
    const { impl, calls } = fetchStub([{ body: openaiBody(GOOD) }])
    await callDirectTextProvider(baseRequest({ provider: 'openai', fetchImpl: impl }))
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a router.' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Pick the best agent.' })
    // Reasoning/GPT-5-family models 400 on max_tokens (review R4).
    expect(body.max_completion_tokens).toBe(1024)
    expect(body.max_tokens).toBeUndefined()
  })

  it('google: POST generateContent with key in query and system_instruction', async () => {
    const { impl, calls } = fetchStub([{ body: googleBody(GOOD) }])
    await callDirectTextProvider(baseRequest({ provider: 'google', fetchImpl: impl }))
    expect(calls[0].url).toContain('generativelanguage.googleapis.com')
    expect(calls[0].url).toContain('key=test-key')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.system_instruction.parts[0].text).toBe('You are a router.')
    expect(body.contents[0].parts[0].text).toBe('Pick the best agent.')
    expect(body.generationConfig.maxOutputTokens).toBe(1024)
  })
})

describe('malformed output retry', () => {
  it('retries once on non-JSON output, succeeds on the second call', async () => {
    const { impl, calls } = fetchStub([
      { body: anthropicBody('sure! the best agent is reviewer') },
      { body: anthropicBody(GOOD) },
    ])
    const out = await callDirectTextProvider(baseRequest({ fetchImpl: impl }))
    expect(out.agentId).toBe('reviewer')
    expect(calls).toHaveLength(2)
  })

  it('retries once on schema-invalid JSON, then throws transient', async () => {
    const { impl, calls } = fetchStub([
      { body: anthropicBody(JSON.stringify({ nope: true })) },
      { body: anthropicBody(JSON.stringify({ nope: 'again' })) },
    ])
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DirectTextError)
    expect((err as DirectTextError).kind).toBe('transient')
    expect(calls).toHaveLength(2)
  })

  it('strips accidental markdown fences before parsing', async () => {
    const { impl } = fetchStub([{ body: anthropicBody('```json\n' + GOOD + '\n```') }])
    const out = await callDirectTextProvider(baseRequest({ fetchImpl: impl }))
    expect(out.agentId).toBe('reviewer')
  })
})

describe('error classification by kind', () => {
  it('401 → structural (bad credentials), no retry', async () => {
    const { impl, calls } = fetchStub([{ status: 401, body: { error: 'unauthorized' } }])
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DirectTextError)
    expect((err as DirectTextError).kind).toBe('structural')
    expect(calls).toHaveLength(1)
  })

  it('404 → structural (unknown model)', async () => {
    const { impl } = fetchStub([{ status: 404, body: { error: 'no such model' } }])
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect((err as DirectTextError).kind).toBe('structural')
  })

  it('429 → transient', async () => {
    const { impl } = fetchStub([{ status: 429, body: { error: 'rate limited' } }])
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect((err as DirectTextError).kind).toBe('transient')
  })

  it('500 → transient', async () => {
    const { impl } = fetchStub([{ status: 500, body: { error: 'boom' } }])
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect((err as DirectTextError).kind).toBe('transient')
  })

  it('network failure → transient', async () => {
    const impl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const err = await callDirectTextProvider(baseRequest({ fetchImpl: impl })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DirectTextError)
    expect((err as DirectTextError).kind).toBe('transient')
  })
})

describe('resolveProviderKeySource', () => {
  it('prefers env var over the secret store', () => {
    process.env.ANTHROPIC_API_KEY = 'from-env'
    try {
      expect(resolveProviderKeySource('anthropic')).toEqual({ apiKey: 'from-env', source: 'env' })
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('returns null when neither env nor store has a key', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(resolveProviderKeySource('anthropic')).toBeNull()
  })
})
