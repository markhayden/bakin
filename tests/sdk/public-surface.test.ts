import { describe, expect, it } from 'bun:test'

import * as Slots from '@makinbakin/sdk/slots'
import * as Utils from '@makinbakin/sdk/utils'

describe('SDK public surface cleanup', () => {
  it.each(['pluginApiUrl', 'copyToClipboard'])('keeps %s private to utility implementations', (name) => {
    expect(Object.hasOwn(Utils, name)).toBe(false)
  })

  it.each(['getSlotEntries', 'clearSlotsOwnedBy'])('keeps %s private to the slot registry', (name) => {
    expect(Object.hasOwn(Slots, name)).toBe(false)
  })

  it('preserves public fetch and slot operations', () => {
    expect(Utils.pluginFetch).toBeFunction()
    expect(Slots.Slot).toBeFunction()
    expect(Slots.registerSlot).toBeFunction()
    expect(Slots.getSlotNamesOwnedBy).toBeFunction()
  })
})
