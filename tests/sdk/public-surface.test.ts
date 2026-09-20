import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import * as Slots from '@makinbakin/sdk/slots'
import * as Utils from '@makinbakin/sdk/utils'
import * as Patterns from '@makinbakin/sdk/patterns'
import * as Hooks from '@makinbakin/sdk/hooks'
import { useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'

describe('SDK public surface cleanup', () => {
  it.each(['useFormGuard', 'useFileDrop', 'useVerticalResize'])('removes the unused %s hook', (name) => {
    expect(Object.hasOwn(Hooks, name)).toBe(false)
  })

  it.each(['use-form-guard', 'use-file-drop', 'use-vertical-resize'])('deletes the unused %s implementation', (name) => {
    expect(existsSync(resolve(import.meta.dir, `../../src/hooks/${name}.ts`))).toBe(false)
  })

  it('retains horizontal resize and the navigation dirty-exit contract', () => {
    expect(Hooks.useHorizontalResize).toBeFunction()
    expect(useUnsavedChangesGuard).toBeFunction()
  })

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
