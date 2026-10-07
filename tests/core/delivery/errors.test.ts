import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-delivery-errors-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { DeliveryError, isDeliveryError, summarizeDeliveryError } from '../../../packages/core/src/delivery/errors'

describe('DeliveryError', () => {
  it('carries a kind and detail and is identifiable by name and predicate', () => {
    const err = new DeliveryError('not_configured', 'Discord delivery bridge is missing_token', { state: 'missing_token' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('DeliveryError')
    expect(err.kind).toBe('not_configured')
    expect(err.detail.state).toBe('missing_token')
    expect(isDeliveryError(err)).toBe(true)
    expect(isDeliveryError(new Error('plain'))).toBe(false)
  })

  it('defaults detail to an empty object', () => {
    expect(new DeliveryError('transport', 'x').detail).toEqual({})
  })

  it('summarizes to a wire-safe { kind, message, at }', () => {
    const summary = summarizeDeliveryError(new DeliveryError('auth_failed', 'rejected', { status: 401 }), '2026-10-06T00:00:00.000Z')
    expect(summary).toEqual({ kind: 'auth_failed', message: 'rejected', at: '2026-10-06T00:00:00.000Z' })
  })
})
