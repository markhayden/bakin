import { describe, expect, it } from 'bun:test'

import * as Slots from '@makinbakin/sdk/slots'
import * as Utils from '@makinbakin/sdk/utils'
import * as Patterns from '@makinbakin/sdk/patterns'

describe('SDK public surface cleanup', () => {
  it.each(['PageHeaderOverflowMenu', 'ASSIGNED_AGENT_VALUE'])('keeps %s private to pattern implementations', (name) => {
    expect(Object.hasOwn(Patterns, name)).toBe(false)
  })

  it('preserves the story-backed agent and color components', () => {
    expect(Patterns.AgentDot).toBeFunction()
    expect(Patterns.AgentStatus).toBeFunction()
    expect(Patterns.ColorPicker).toBeFunction()
    expect(Patterns.AgentSelect).toBeFunction()
  })
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
