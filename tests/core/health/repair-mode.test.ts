/**
 * The ONE mode policy (spec D2, §3.2): a repair self-heals unless it deletes
 * user content, spends money or widens what the operator authorized. Pure —
 * no storage, no mocks needed.
 */
import { describe, expect, it } from 'bun:test'
import { repairMode, type HealthRepairEffects } from '../../../packages/core/src/health/repair-mode'

const none: HealthRepairEffects = { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }

describe('repairMode', () => {
  it('all three booleans false → self-heal, whatever else the action does', () => {
    expect(repairMode(none)).toBe('self-heal')
    expect(repairMode({ ...none, restartsService: 'search-engine' })).toBe('self-heal')
    expect(repairMode({ ...none, restartsService: 'bakin', resolves: ['stale-backlog'] })).toBe('self-heal')
  })

  it.each([
    ['deletesUserContent', { ...none, deletesUserContent: true }],
    ['spendsMoney', { ...none, spendsMoney: true }],
    ['widensAuthorization', { ...none, widensAuthorization: true }],
    ['all three', { deletesUserContent: true, spendsMoney: true, widensAuthorization: true }],
  ] as const)('%s → one-click', (_label, effects) => {
    expect(repairMode(effects)).toBe('one-click')
  })
})
