import { describe, it, expect } from 'vitest'
import { validateStepOutput, detectRejectionRepeat } from '@bakin/workflows/schema-validator'

describe('schema-validator', () => {
  const schema = {
    type: 'object',
    required: ['caption', 'body'],
    properties: {
      caption: { type: 'string' },
      body: { type: 'string' },
      hashtags: { type: 'array', items: { type: 'string' } },
      views: { type: 'number' },
    },
  }

  it('accepts valid output with all required fields', () => {
    const result = validateStepOutput(schema, { caption: 'Hello', body: 'World' })
    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('rejects output missing required field', () => {
    const result = validateStepOutput(schema, { caption: 'Hello' })
    expect(result.valid).toBe(false)
    expect(result.errors).toBeDefined()
    expect(result.errors!.some(e => e.includes('body'))).toBe(true)
  })

  it('rejects type mismatch (string where number expected)', () => {
    const result = validateStepOutput(schema, { caption: 'Hello', body: 'World', views: 'not a number' })
    expect(result.valid).toBe(false)
    expect(result.errors).toBeDefined()
  })

  it('validates nested objects', () => {
    const nestedSchema = {
      type: 'object',
      required: ['meta'],
      properties: {
        meta: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string' } },
        },
      },
    }
    const good = validateStepOutput(nestedSchema, { meta: { title: 'Test' } })
    expect(good.valid).toBe(true)

    const bad = validateStepOutput(nestedSchema, { meta: {} })
    expect(bad.valid).toBe(false)
  })

  it('validates arrays', () => {
    const result = validateStepOutput(schema, {
      caption: 'Hello',
      body: 'World',
      hashtags: ['a', 'b', 'c'],
    })
    expect(result.valid).toBe(true)

    const bad = validateStepOutput(schema, {
      caption: 'Hello',
      body: 'World',
      hashtags: [1, 2, 3],
    })
    expect(bad.valid).toBe(false)
  })

  it('accepts any output when no schema is defined', () => {
    const result = validateStepOutput(undefined, { anything: 'goes' })
    expect(result.valid).toBe(true)
  })

  it('rejects empty output when schema has required fields', () => {
    const result = validateStepOutput(schema, {})
    expect(result.valid).toBe(false)
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  // ─── Strict schema enforcement ──────────────────────────────────────

  it('rejects extra properties when schema defines properties (additionalProperties: false)', () => {
    const result = validateStepOutput(schema, {
      caption: 'Hello',
      body: 'World',
      smuggled_image: '/path/to/image.png',
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('additional'))).toBe(true)
  })

  it('respects explicit additionalProperties: true in schema', () => {
    const permissiveSchema = {
      type: 'object',
      required: ['caption'],
      properties: { caption: { type: 'string' } },
      additionalProperties: true,
    }
    const result = validateStepOutput(permissiveSchema, {
      caption: 'Hello',
      extra: 'allowed',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects output exceeding 100KB size limit', () => {
    const bigOutput = { caption: 'a'.repeat(110_000), body: 'test' }
    const result = validateStepOutput(schema, bigOutput)
    expect(result.valid).toBe(false)
    expect(result.errors![0]).toContain('size limit')
  })
})

// ─── Rejection-repeat detection ─────────────────────────────────────

describe('detectRejectionRepeat', () => {
  it('returns null when no previous output', () => {
    expect(detectRejectionRepeat(undefined, { caption: 'test' })).toBeNull()
  })

  it('detects identical resubmission', () => {
    const output = { caption: 'Hello', body: 'World' }
    const result = detectRejectionRepeat(output, { ...output })
    expect(result).not.toBeNull()
    expect(result).toContain('identical')
  })

  it('detects near-duplicate resubmission (cosmetic changes only)', () => {
    const prev = { caption: 'Hello World this is a long caption for similarity detection', body: 'This is the body content that should be long enough to trigger similarity' }
    const curr = { caption: 'Hello World this is a long caption for similarity detection!', body: 'This is the body content that should be long enough to trigger similarity' }
    const result = detectRejectionRepeat(prev, curr)
    expect(result).not.toBeNull()
    expect(result).toContain('similar')
  })

  it('allows genuinely different output', () => {
    const prev = { caption: 'Original caption', body: 'Original body content' }
    const curr = { caption: 'Completely rewritten caption with new approach', body: 'Totally different body that addresses feedback thoroughly' }
    const result = detectRejectionRepeat(prev, curr)
    expect(result).toBeNull()
  })
})
