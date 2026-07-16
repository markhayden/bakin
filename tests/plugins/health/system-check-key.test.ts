import { describe, expect, it } from 'bun:test'
import { stableKeyPart } from '../../../plugins/health/lib/system-checks/key'

describe('stableKeyPart', () => {
  it('normalizes external identifiers consistently', () => {
    expect(stableKeyPart(' Main Agent / Pixel ')).toBe('-main-agent---pixel-')
    expect(stableKeyPart('search.table:v2')).toBe('search.table:v2')
  })

  it('uses a non-empty fallback and bounds persisted keys', () => {
    expect(stableKeyPart('')).toBe('unknown')
    expect(stableKeyPart('x'.repeat(101))).toHaveLength(100)
  })
})
