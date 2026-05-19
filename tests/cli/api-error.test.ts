import { describe, expect, it } from 'bun:test'
import { extractApiErrorMessage, formatApiError } from '../../src/core/cli/api-error'

describe('CLI API error formatting', () => {
  it('extracts common JSON error fields', () => {
    expect(formatApiError(500, '{"error":"Failed to restore asset"}')).toBe('HTTP 500: Failed to restore asset')
    expect(formatApiError(400, '{"message":"Invalid input"}', { prefix: 'API error' })).toBe('API error 400: Invalid input')
  })

  it('includes validation issue messages when present', () => {
    expect(extractApiErrorMessage('{"error":"invalid input","issues":[{"message":"malformed JSON body"}]}')).toBe(
      'invalid input: malformed JSON body',
    )
  })

  it('falls back to plain text bodies', () => {
    expect(formatApiError(404, 'Not found')).toBe('HTTP 404: Not found')
  })
})
