/**
 * S5 — Simple's save emits ONLY ops for the controls the user changed.
 * Property test: a random persisted baseline (agent model, chores routes
 * with random models/thinking, dispatch routes, send, tags) + ONE Simple
 * control change ⇒ exactly the expected ops, never `route:send`, never a
 * dispatch route, never a thinking field, never an agent pin.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-simple-minimality')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { draftOps, effectiveSelection, stageOp, type Draft } from '../../../plugins/models/lib/draft'
import { CHORES_CLASSES } from '../../../plugins/models/lib/mode'
import { choresLane, setAllChoresOps } from '../../../plugins/models/lib/simple'
import type { SelectionStateWire } from '../../../plugins/models/types'

const MODELS = ['openai-codex/gpt-5.6-luna', 'openai-codex/gpt-5.4-mini', 'anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-4-6']
const DISPATCH = ['scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition', 'send']
const THINKING = [undefined, 'low', 'high'] as const

/** Deterministic LCG so a failure is reproducible from its seed. */
function rng(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}
const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!

function baseline(seed: number): SelectionStateWire[] {
  const r = rng(seed)
  const states: SelectionStateWire[] = [
    { ref: 'policy:defaultModel', model: pick(r, MODELS), document: 'policy', label: 'Default model' },
    { ref: 'agent:pixel:model', model: r() < 0.5 ? pick(r, MODELS) : null, document: 'agent:pixel', label: 'pixel' },
  ]
  for (const c of [...DISPATCH, ...CHORES_CLASSES]) {
    const thinking = pick(r, THINKING)
    states.push({ ref: `route:${c}`, model: r() < 0.6 ? pick(r, MODELS) : null, ...(thinking ? { thinking } : {}), document: 'routing', label: c })
  }
  if (r() < 0.5) states.push({ ref: 'tag:heavy', model: pick(r, MODELS), document: 'routing', label: 'heavy' })
  return states
}

const FORBIDDEN = (ref: string) => ref === 'route:send' || DISPATCH.includes(ref.slice(6)) || ref.startsWith('agent:') || ref.startsWith('tag:')

describe('Simple save minimality (S5)', () => {
  it('changing the agent model stages exactly one policy op', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const states = baseline(seed)
      const current = states.find((s) => s.ref === 'policy:defaultModel')!.model
      const next = MODELS.find((m) => m !== current)!
      const draft = stageOp(new Map(), states, 'policy:defaultModel', { model: next })
      expect(draftOps(draft)).toEqual([{ ref: 'policy:defaultModel', set: { model: next } }])
    }
  })

  it('"Set all to…" / the chores picker stages ONLY the chores routes whose model differs — thinking untouched, never send/dispatch/agent/tag', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const states = baseline(seed)
      const r = rng(seed * 7919)
      const target = pick(r, MODELS)
      const draft: Draft = setAllChoresOps(target).reduce((acc, op) => stageOp(acc, states, op.ref, op.set), new Map() as Draft)
      const ops = draftOps(draft)
      const expected = CHORES_CLASSES
        .filter((c) => (states.find((s) => s.ref === `route:${c}`)!.model ?? null) !== target)
        .map((c) => ({ ref: `route:${c}`, set: { model: target } }))
        .sort((a, b) => a.ref.localeCompare(b.ref))
      expect(ops).toEqual(expected)
      expect(ops.some((op) => FORBIDDEN(op.ref))).toBe(false)
      expect(ops.some((op) => 'thinking' in op.set)).toBe(false)
      // After staging, the lane reads as ONE model unless thinking keeps it Mixed.
      const lane = choresLane((ref) => effectiveSelection(draft, states, ref))
      const thinkingSet = CHORES_CLASSES.some((c) => states.find((s) => s.ref === `route:${c}`)!.thinking)
      expect(lane.mixed).toBe(thinkingSet)
      if (!thinkingSet) expect(lane.model).toBe(target)
    }
  })

  it('"Same as the agent model" clears only the chores routes that were explicit', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const states = baseline(seed)
      const draft: Draft = setAllChoresOps(null).reduce((acc, op) => stageOp(acc, states, op.ref, op.set), new Map() as Draft)
      const expected = CHORES_CLASSES
        .filter((c) => states.find((s) => s.ref === `route:${c}`)!.model)
        .map((c) => ({ ref: `route:${c}`, set: { model: null } }))
        .sort((a, b) => a.ref.localeCompare(b.ref))
      expect(draftOps(draft)).toEqual(expected)
    }
  })
})
