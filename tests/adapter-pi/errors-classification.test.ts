/**
 * #852 — toRuntimeError's model-rejection branch. The provider verdict
 * "this account cannot call model X" must classify as the typed
 * model_not_supported kind (never generic runtime_failed) with the
 * qualified model id on providerInfo, while ambiguous 400s and
 * rate-limit/auth shapes keep their existing kinds.
 * Pure classification test: no PI_HOME, no provider.
 */
import { describe, test, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'

// Blanket isolation policy — no code path here touches storage.
const testDir = join(tmpdir(), `bakin-test-pi-errclass-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

import { toRuntimeError } from '../../packages/adapter-pi/src/errors'

const httpErr = (status: number, message: string) =>
  Object.assign(new Error(message), { status })

describe('toRuntimeError: model_not_supported classification (#852)', () => {
  test('the live Codex retirement shape (400 + "model is not supported") → model_not_supported with qualified model + provider', () => {
    const err = toRuntimeError(
      httpErr(400, "invalid_request_error: The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account"),
      { model: 'openai-codex/gpt-5.4-mini' },
    )
    expect(err.kind).toBe('model_not_supported')
    expect(err.providerInfo?.model).toBe('openai-codex/gpt-5.4-mini')
    expect(err.providerInfo?.provider).toBe('openai-codex')
  })

  test('code model_not_found → model_not_supported', () => {
    const raw = Object.assign(new Error('The model does not work here'), { status: 404, code: 'model_not_found' })
    expect(toRuntimeError(raw, { model: 'openai/gpt-x' }).kind).toBe('model_not_supported')
  })

  test('OpenAI "does not exist or you do not have access" shape → model_not_supported', () => {
    const err = toRuntimeError(
      httpErr(404, 'The model `gpt-9` does not exist or you do not have access to it.'),
      { model: 'openai/gpt-9' },
    )
    expect(err.kind).toBe('model_not_supported')
  })

  test('without ctx.model the kind still classifies but providerInfo carries no model (nothing to record)', () => {
    const err = toRuntimeError(httpErr(400, "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account"))
    expect(err.kind).toBe('model_not_supported')
    expect(err.providerInfo?.model).toBeUndefined()
  })

  test('ambiguous 400 stays runtime_failed — never touches the rejection path', () => {
    expect(toRuntimeError(httpErr(400, 'invalid_request_error: missing field input')).kind).toBe('runtime_failed')
  })

  test('rate-limit and auth shapes keep provider_cooldown even when the message mentions a model', () => {
    expect(toRuntimeError(httpErr(429, 'rate limit exceeded for model gpt-5.5')).kind).toBe('provider_cooldown')
    expect(toRuntimeError(httpErr(401, 'unauthorized: model gpt-5.5 requires login')).kind).toBe('provider_cooldown')
  })

  test('existing RuntimeErrors pass through untouched', () => {
    const original = toRuntimeError(httpErr(400, "The 'x' model is not supported here"), { model: 'p/x' })
    expect(toRuntimeError(original)).toBe(original)
  })
})
