/**
 * Reset to this plan (S6): every customization Simple cannot express goes
 * back to the two lanes — cleared where the runtime supports the knob,
 * skipped AND disclosed where it does not; chores routes land on the
 * plan's chores value with thinking cleared; the agent lane is untouched.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-model-reset')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { buildResetOps } from '../../src/core/model-reset'
import type { SelectionState } from '../../src/core/model-selections'

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
const HAIKU = 'anthropic/claude-haiku-4-5'

function state(ref: string, model: string | null, thinking?: SelectionState['thinking']): SelectionState {
  return { ref, model, ...(thinking ? { thinking } : {}), document: ref.startsWith('policy') ? 'policy' : ref.startsWith('agent:') ? `agent:${ref.split(':')[1]}` : 'routing', label: ref }
}

const states: SelectionState[] = [
  state('policy:defaultModel', LUNA),
  state('policy:defaultSubagentModel', MINI),
  state('policy:fallback:0', HAIKU),
  state('policy:alias:fast', MINI),
  state('agent:main:model', null),
  state('agent:pixel:model', HAIKU),
  state('agent:pixel:subagentModel', MINI),
  state('route:adhoc', HAIKU, 'high'),
  state('route:workflow', null, 'low'),
  state('route:send', MINI),
  state('route:scheduled', null),
  state('route:relay', HAIKU, 'low'),
  state('route:auto-title', MINI),
  state('route:enrichment', null),
  state('route:team-routing', MINI),
  state('route:skill-mapping', MINI),
  state('tag:heavy', LUNA),
  state('ui:mode', 'advanced'),
]
const FULL = { fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true }
const PI = { fallbackModels: false, defaultSubagentModel: false, aliases: false, perAgentSubagentModel: false }

describe('buildResetOps', () => {
  it('with full support: clears every customization and sets the five chores routes to the plan value', () => {
    const { ops, skipped } = buildResetOps(states, FULL, { chores: MINI })
    expect(skipped).toEqual([])
    const byRef = new Map(ops.map((op) => [op.ref, op.set]))
    expect(byRef.get('policy:defaultSubagentModel')).toEqual({ model: null })
    expect(byRef.get('policy:fallback:0')).toEqual({ model: null })
    expect(byRef.get('policy:alias:fast')).toEqual({ model: null })
    expect(byRef.get('agent:pixel:model')).toEqual({ model: null })
    expect(byRef.get('agent:pixel:subagentModel')).toEqual({ model: null })
    expect(byRef.get('route:adhoc')).toEqual({ model: null, thinking: null })
    expect(byRef.get('route:workflow')).toEqual({ thinking: null })
    expect(byRef.get('route:send')).toEqual({ model: null })
    expect(byRef.get('tag:heavy')).toEqual({ model: null, thinking: null })
    // Chores: relay moves to mini and drops its thinking; enrichment gets set; the rest already match.
    expect(byRef.get('route:relay')).toEqual({ model: MINI, thinking: null })
    expect(byRef.get('route:enrichment')).toEqual({ model: MINI })
    expect(byRef.has('route:auto-title')).toBe(false)
    // Never touched: the agent lane, unset refs, the page mode.
    expect(byRef.has('policy:defaultModel')).toBe(false)
    expect(byRef.has('agent:main:model')).toBe(false)
    expect(byRef.has('route:scheduled')).toBe(false)
    expect(byRef.has('ui:mode')).toBe(false)
  })

  it('on a runtime without those knobs (Pi): the unsupported clears are skipped AND disclosed, the rest proceeds', () => {
    const { ops, skipped } = buildResetOps(states, PI, { chores: null })
    expect(skipped.map((s) => s.ref).sort()).toEqual(['agent:pixel:subagentModel', 'policy:alias:fast', 'policy:defaultSubagentModel', 'policy:fallback:0'])
    expect(skipped.every((s) => s.reason.includes('runtime'))).toBe(true)
    const refs = ops.map((op) => op.ref)
    expect(refs).toContain('agent:pixel:model')
    expect(refs).not.toContain('policy:fallback:0')
    // chores: null ⇒ inherit — explicit chores routes are cleared.
    expect(ops.find((op) => op.ref === 'route:auto-title')?.set).toEqual({ model: null })
    expect(ops.find((op) => op.ref === 'route:relay')?.set).toEqual({ model: null, thinking: null })
    expect(ops.find((op) => op.ref === 'route:enrichment')).toBeUndefined()
  })

  it('a plain two-lane install resets to zero ops', () => {
    const plain = [state('policy:defaultModel', LUNA), state('agent:main:model', null), ...['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((c) => state(`route:${c}`, MINI))]
    expect(buildResetOps(plain, FULL, { chores: MINI })).toEqual({ ops: [], skipped: [] })
  })
})
