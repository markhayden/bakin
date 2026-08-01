import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  buildPublicApiInventory,
  diffPublicApiInventory,
  type PublicApiInventory,
  validatePublicApiInventory,
} from '../../../scripts/ui/public-api'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const INVENTORY_PATH = join(REPO_ROOT, 'design-system/public-api.json')

function checkedInventory(): PublicApiInventory {
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as PublicApiInventory
}

describe('focused SDK migration API freeze', () => {
  it('matches the reviewed value and type inventory exactly', () => {
    const expected = checkedInventory()
    const actual = buildPublicApiInventory(REPO_ROOT)

    expect(validatePublicApiInventory(expected)).toEqual([])
    expect(diffPublicApiInventory(expected, actual)).toEqual([])
  })

  it('the frozen components barrel stays deleted from the reviewed inventory (P-final)', () => {
    const inventory = checkedInventory()
    const legacy = inventory.entrypoints.find((entry) => entry.specifier === '@makinbakin/sdk/components')

    expect(legacy).toBeUndefined()
    expect(inventory.summary.frozenLegacyEntrypoints).toBe(0)
    expect(inventory.entrypoints.some((entry) => entry.status === 'migration-only-frozen')).toBe(false)
  })

  it('gives every focused value and type one owning entrypoint', () => {
    const inventory = checkedInventory()
    const patterns = inventory.entrypoints.find((entry) => entry.specifier === '@makinbakin/sdk/patterns')
    if (!patterns) throw new Error('patterns inventory is missing')
    patterns.values.push('Button')
    patterns.values.sort((left, right) => left.localeCompare(right))

    expect(validatePublicApiInventory(inventory)).toContain(
      'focused value export Button has multiple owners: @makinbakin/sdk/ui, @makinbakin/sdk/patterns',
    )
  })

  it('keeps focused paths supported and records existing routing and stylesheet ownership', () => {
    const inventory = checkedInventory()
    const focused = inventory.entrypoints

    expect(focused).toHaveLength(7)
    expect(focused.every((entry) => entry.status === 'supported-prerelease')).toBe(true)
    expect(focused.every((entry) => entry.newConsumerPolicy === 'supported')).toBe(true)
    expect(inventory.contracts.routing).toContain('@makinbakin/sdk/routing')
    expect(inventory.contracts.routing).toContain('@makinbakin/sdk/navigation')
    expect(inventory.contracts.stylesheet).toBe('@makinbakin/sdk/styles.css')
  })
})
