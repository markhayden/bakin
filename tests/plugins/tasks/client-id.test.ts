import { afterEach, describe, expect, it } from 'bun:test'
import { createShortClientId } from '../../../plugins/tasks/lib/client-id'

const originalCrypto = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: originalCrypto,
  })
})

describe('createShortClientId', () => {
  it('uses randomUUID when available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef',
      },
    })

    expect(createShortClientId()).toBe('12345678')
  })

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.set([0xab, 0xcd, 0xef, 0x12])
          return bytes
        },
      },
    })

    expect(createShortClientId()).toBe('abcdef12')
  })

  it('falls back without crypto APIs', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    })

    expect(createShortClientId()).toHaveLength(8)
  })
})
