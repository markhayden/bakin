/**
 * The Models page draft (S5/S10): only refs whose staged value differs from
 * the persisted state ride a save; staging back to the persisted value
 * unstages; a save's applied + pending refs leave the draft, failed refs
 * stay for Retry.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-models-draft')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { draftOps, effectiveSelection, retainFailed, stageOp, unstageOp, type Draft } from '../../../plugins/models/lib/draft'
import type { SelectionStateWire } from '../../../plugins/models/types'

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
const states: SelectionStateWire[] = [
  { ref: 'policy:defaultModel', model: LUNA, document: 'policy', label: 'Default model' },
  { ref: 'route:relay', model: MINI, thinking: 'low', document: 'routing', label: 'relay' },
  { ref: 'route:adhoc', model: null, document: 'routing', label: 'adhoc' },
]
const empty: Draft = new Map()

describe('stageOp', () => {
  it('stages a changed model; staging the persisted value again unstages the ref', () => {
    let draft = stageOp(empty, states, 'policy:defaultModel', { model: MINI })
    expect(draftOps(draft)).toEqual([{ ref: 'policy:defaultModel', set: { model: MINI } }])
    draft = stageOp(draft, states, 'policy:defaultModel', { model: LUNA })
    expect(draftOps(draft)).toEqual([])
  })

  it('merges fields per ref and compares thinking with inherit == unset', () => {
    let draft = stageOp(empty, states, 'route:relay', { thinking: 'high' })
    draft = stageOp(draft, states, 'route:relay', { model: LUNA })
    expect(draftOps(draft)).toEqual([{ ref: 'route:relay', set: { thinking: 'high', model: LUNA } }])
    // Back to the persisted pair ⇒ gone.
    draft = stageOp(draft, states, 'route:relay', { model: MINI, thinking: 'low' })
    expect(draftOps(draft)).toEqual([])
    // Unrouted class: 'inherit' thinking + null model is the persisted state.
    expect(draftOps(stageOp(empty, states, 'route:adhoc', { model: null, thinking: 'inherit' }))).toEqual([])
  })

  it('unstage drops one ref; ops sort by ref for a stable request body', () => {
    let draft = stageOp(empty, states, 'route:relay', { model: LUNA })
    draft = stageOp(draft, states, 'policy:defaultModel', { model: MINI })
    expect(draftOps(draft).map((op) => op.ref)).toEqual(['policy:defaultModel', 'route:relay'])
    expect(draftOps(unstageOp(draft, 'route:relay'))).toEqual([{ ref: 'policy:defaultModel', set: { model: MINI } }])
  })
})

describe('effectiveSelection', () => {
  it('renders the staged value when present, else the persisted one, and flags staging', () => {
    const draft = stageOp(empty, states, 'route:relay', { model: LUNA })
    expect(effectiveSelection(draft, states, 'route:relay')).toEqual({ model: LUNA, thinking: 'low', staged: true })
    expect(effectiveSelection(draft, states, 'policy:defaultModel')).toEqual({ model: LUNA, thinking: null, staged: false })
    expect(effectiveSelection(draft, states, 'route:adhoc')).toEqual({ model: null, thinking: null, staged: false })
  })
})

describe('retainFailed', () => {
  it('applied and pending refs leave the draft; failed ones stay for Retry', () => {
    let draft = stageOp(empty, states, 'route:relay', { model: LUNA })
    draft = stageOp(draft, states, 'policy:defaultModel', { model: MINI })
    draft = stageOp(draft, states, 'route:adhoc', { model: MINI })
    const left = retainFailed(draft, { applied: ['route:relay'], pending: ['route:adhoc'] })
    expect(draftOps(left)).toEqual([{ ref: 'policy:defaultModel', set: { model: MINI } }])
  })
})
