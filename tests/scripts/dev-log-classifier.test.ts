import { describe, expect, it } from 'bun:test'
import { isBenignTailwindLine } from '../../scripts/dev-log-classifier'

describe('dev log classifier', () => {
  it('suppresses normal Tailwind and bunx dependency progress lines', () => {
    expect(isBenignTailwindLine('≈ tailwindcss v4.1.7')).toBe(true)
    expect(isBenignTailwindLine('Done in 120ms')).toBe(true)
    expect(isBenignTailwindLine('Resolving dependencies')).toBe(true)
    expect(isBenignTailwindLine('Resolved, downloaded and extracted [2]')).toBe(true)
    expect(isBenignTailwindLine('Saved lockfile')).toBe(true)
  })

  it('keeps real Tailwind stderr lines visible', () => {
    expect(isBenignTailwindLine('Cannot apply unknown utility class: text-brand')).toBe(false)
  })
})
