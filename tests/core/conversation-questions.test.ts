/**
 * Structured question schema + registry (projects revamp D1/D2a).
 *
 * Pure module: no filesystem, no app services — the registry is in-memory.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conversation-questions-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  QUESTION_LIMITS,
  createQuestionRegistry,
  findQuestionToken,
  mintQuestionId,
  parseBakinQuestion,
  questionToken,
  validateBakinQuestionInput,
} from '../../packages/core/src/conversation/questions'

const valid = {
  question: 'Which inbox are we cleaning?',
  options: [
    { label: 'Just my personal Gmail', description: 'Fastest win.' },
    { label: 'Personal and work' },
  ],
  recommended: 0,
}

describe('validateBakinQuestionInput', () => {
  test('accepts a well-formed question and defaults allowOther to true', () => {
    const result = validateBakinQuestionInput(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.allowOther).toBe(true)
  })

  test('rejects too few and too many options', () => {
    expect(validateBakinQuestionInput({ ...valid, options: [{ label: 'Only' }] }).ok).toBe(false)
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `Option ${i}` }))
    expect(validateBakinQuestionInput({ ...valid, options: six }).ok).toBe(false)
  })

  test('rejects field caps with a message naming the field', () => {
    const result = validateBakinQuestionInput({ ...valid, question: 'x'.repeat(QUESTION_LIMITS.question + 1) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('question')
  })

  test('rejects a recommended index outside the options', () => {
    expect(validateBakinQuestionInput({ ...valid, recommended: 2 }).ok).toBe(false)
  })

  test('rejects duplicate option labels (case-insensitive)', () => {
    const result = validateBakinQuestionInput({ ...valid, options: [{ label: 'Yes' }, { label: 'yes' }] })
    expect(result.ok).toBe(false)
  })

  test('rejects unknown keys', () => {
    expect(validateBakinQuestionInput({ ...valid, multiSelect: true }).ok).toBe(false)
  })

  test('bounds the SERIALIZED size even when every field is within its cap', () => {
    // Quote-heavy text doubles under JSON escaping; five maxed options with
    // maxed descriptions stay within field caps but blow the byte budget.
    const quotes = '"'.repeat(QUESTION_LIMITS.description)
    const options = Array.from({ length: QUESTION_LIMITS.maxOptions }, (_, i) => ({
      label: `${i}${'"'.repeat(QUESTION_LIMITS.label - 1)}`,
      description: quotes,
    }))
    const result = validateBakinQuestionInput({ question: '"'.repeat(QUESTION_LIMITS.question), options })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('too large')
  })
})

describe('parseBakinQuestion', () => {
  test('round-trips a minted envelope', () => {
    const input = validateBakinQuestionInput(valid)
    if (!input.ok) throw new Error(input.error)
    const envelope = { v: 1 as const, id: mintQuestionId(), ...input.value }
    expect(parseBakinQuestion(envelope)).toEqual(envelope)
  })

  test('returns null for malformed envelopes', () => {
    expect(parseBakinQuestion(null)).toBeNull()
    expect(parseBakinQuestion({ ...valid, v: 1 })).toBeNull() // no id
    expect(parseBakinQuestion({ ...valid, v: 2, id: mintQuestionId() })).toBeNull()
    expect(parseBakinQuestion({ ...valid, v: 1, id: 'not-an-id' })).toBeNull()
  })
})

describe('question tokens', () => {
  test('a token embedded in arbitrary text is found', () => {
    const id = mintQuestionId()
    expect(findQuestionToken(`Question posted (${questionToken(id)}). End your turn.`)).toBe(id)
  })

  test('no token → null', () => {
    expect(findQuestionToken('Applied a project plan')).toBeNull()
    expect(findQuestionToken(undefined)).toBeNull()
  })
})

describe('createQuestionRegistry', () => {
  const mint = () => {
    const input = validateBakinQuestionInput(valid)
    if (!input.ok) throw new Error(input.error)
    return { v: 1 as const, id: mintQuestionId(), ...input.value }
  }

  test('take returns a question once, then it is gone', () => {
    const registry = createQuestionRegistry()
    const question = mint()
    registry.put(question)
    expect(registry.take(question.id)).toEqual(question)
    expect(registry.take(question.id)).toBeNull()
  })

  test('an entry expires after its TTL', () => {
    let now = 1_000
    const registry = createQuestionRegistry({ ttlMs: 500, now: () => now })
    const question = mint()
    registry.put(question)
    now += 501
    expect(registry.take(question.id)).toBeNull()
  })

  test('capacity evicts the oldest orphan first', () => {
    const registry = createQuestionRegistry({ capacity: 2 })
    const [a, b, c] = [mint(), mint(), mint()]
    registry.put(a)
    registry.put(b)
    registry.put(c)
    expect(registry.take(a.id)).toBeNull()
    expect(registry.take(b.id)).toEqual(b)
    expect(registry.take(c.id)).toEqual(c)
  })

  test('unknown ids are null', () => {
    expect(createQuestionRegistry().take(mintQuestionId())).toBeNull()
  })
})

describe('serialized size', () => {
  test('an input at the byte ceiling still mints an envelope parseBakinQuestion accepts', () => {
    const base = { question: 'q', options: [{ label: 'A' }, { label: 'B' }] }
    // Grow the question text until the INPUT is as large as validation allows.
    let accepted: Record<string, unknown> | null = null
    let hitCeiling = false
    for (let n = 1; n <= QUESTION_LIMITS.question; n++) {
      const candidate = {
        ...base,
        question: 'é'.repeat(n),
        // Four two-byte-heavy options leave the question to cross the ceiling.
        options: Array.from({ length: 4 }, (_, i) => ({
          label: `${i}${'é'.repeat(QUESTION_LIMITS.label - 1)}`,
          description: 'é'.repeat(QUESTION_LIMITS.description),
        })),
      }
      const result = validateBakinQuestionInput(candidate)
      if (!result.ok) { hitCeiling = true; break }
      accepted = { v: 1, id: mintQuestionId(), ...result.value }
    }
    expect(hitCeiling).toBe(true)
    expect(accepted).not.toBeNull()
    expect(parseBakinQuestion(accepted)).not.toBeNull()
  })
})
