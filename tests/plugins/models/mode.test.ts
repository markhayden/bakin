/**
 * Simple/Advanced classification + the customizations line (spec §3.4, D4):
 * Simple shows the agent lane (`policy:defaultModel`) and the five chores
 * routes' MODEL; everything else is a customization Simple cannot express.
 * Advanced if any customization exists, else Simple. `refLayer` decides
 * whether a `?ref=` deep link must flip the VIEW to Advanced.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure module, but it sits beside plugin server code: keep the isolation
// mocks so nothing it (or a future import) reaches can touch ~/.bakin.
const testDir = join(tmpdir(), 'bakin-test-models-mode')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { classifyMode, listCustomizations, refLayer, type SelectionStateWire } from '../../../plugins/models/lib/mode'

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'

function state(ref: string, model: string | null, extra: Partial<SelectionStateWire> = {}): SelectionStateWire {
  return { ref, model, document: ref.startsWith('policy') ? 'policy' : ref.startsWith('agent:') ? `agent:${ref.split(':')[1]}` : 'routing', label: ref, ...extra }
}

const CHORES = ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping']

function baseline(): SelectionStateWire[] {
  return [
    state('policy:defaultModel', LUNA),
    state('policy:defaultSubagentModel', null),
    state('agent:main:model', null),
    state('agent:main:subagentModel', null),
    state('agent:pixel:model', LUNA), // pinned to the default = not a customization
    ...['scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition', 'send'].map((c) => state(`route:${c}`, null)),
    ...CHORES.map((c) => state(`route:${c}`, MINI)),
    state('ui:mode', 'simple'),
  ]
}

describe('classifyMode / listCustomizations', () => {
  it('a plain two-lane install is Simple with zero customizations', () => {
    expect(listCustomizations(baseline())).toEqual([])
    expect(classifyMode(baseline())).toBe('simple')
  })

  it('every layer Simple cannot express is a customization ⇒ Advanced', () => {
    const cases: Array<[SelectionStateWire, string]> = [
      [state('agent:pixel:model', MINI), 'pixel'],
      [state('agent:main:subagentModel', MINI), 'subagent'],
      [state('policy:defaultSubagentModel', MINI), 'subagent'],
      [state('policy:fallback:0', MINI), 'Fallback'],
      [state('policy:alias:fast', MINI), 'Alias'],
      [state('route:adhoc', MINI), 'adhoc'],
      [state('route:send', MINI), 'send'],
      [state('route:relay', MINI, { thinking: 'low' }), 'thinking'],
      [state('tag:heavy', MINI), 'heavy'],
    ]
    for (const [override, expectedText] of cases) {
      const states = baseline().filter((s) => s.ref !== override.ref).concat(override)
      const found = listCustomizations(states)
      expect(found.length).toBe(1)
      expect(found[0]!.detail).toContain(expectedText)
      expect(classifyMode(states)).toBe('advanced')
    }
  })

  it('chores routes naming different models count once, as per-chore differences', () => {
    const states = baseline().map((s) => (s.ref === 'route:relay' ? { ...s, model: LUNA } : s))
    const found = listCustomizations(states)
    expect(found).toHaveLength(1)
    expect(found[0]!.detail).toContain('2 different models')
  })

  it('an unrouted chores class inherits the agent model — no customization, and not a difference on its own', () => {
    const states = baseline().map((s) => (s.ref.startsWith('route:') && CHORES.includes(s.ref.slice(6)) ? { ...s, model: null } : s))
    expect(listCustomizations(states)).toEqual([])
  })
})

describe('refLayer', () => {
  it('the agent lane and chores routes live in Simple; everything else deep-links into Advanced', () => {
    expect(refLayer('policy:defaultModel')).toBe('simple')
    expect(refLayer('route:relay')).toBe('simple')
    expect(refLayer('route:adhoc')).toBe('advanced')
    expect(refLayer('route:send')).toBe('advanced')
    expect(refLayer('agent:pixel:model')).toBe('advanced')
    expect(refLayer('policy:fallback:0')).toBe('advanced')
    expect(refLayer('tag:heavy')).toBe('advanced')
  })
})
