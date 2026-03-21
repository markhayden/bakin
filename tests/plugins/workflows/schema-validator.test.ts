import { describe, it, expect } from 'vitest'
import { validateStepOutput } from '@mc/workflows/schema-validator'

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
})
