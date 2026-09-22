/**
 * UI intents → selection ops (D24): only refs that change are emitted.
 * Pure — no app modules with side effects are imported.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Blanket isolation rule: nothing in a test run may resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-selection-ops-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { aliasOps, policyDefaultsOps, routingDiffOps } from '../../../plugins/models/lib/selection-ops'

describe('policyDefaultsOps', () => {
  const current = { defaultModel: 'a', defaultSubagentModel: null, fallbackModels: ['x', 'y'] }

  it('emits nothing when nothing changed', () => {
    expect(policyDefaultsOps(current, { defaultModel: 'a', defaultSubagentModel: null, fallbackModels: ['x', 'y'] })).toEqual([])
  })

  it('diffs fallbacks per index and clears removed tail indices', () => {
    expect(policyDefaultsOps(current, { fallbackModels: ['x'] })).toEqual([{ ref: 'policy:fallback:1', set: { model: null } }])
    expect(policyDefaultsOps(current, { fallbackModels: ['y', 'x', 'z'] })).toEqual([
      { ref: 'policy:fallback:0', set: { model: 'y' } },
      { ref: 'policy:fallback:1', set: { model: 'x' } },
      { ref: 'policy:fallback:2', set: { model: 'z' } },
    ])
  })

  it('sets default + subagent default only when they differ', () => {
    expect(policyDefaultsOps(current, { defaultModel: 'b', defaultSubagentModel: 'c' })).toEqual([
      { ref: 'policy:defaultModel', set: { model: 'b' } },
      { ref: 'policy:defaultSubagentModel', set: { model: 'c' } },
    ])
  })
})

describe('aliasOps', () => {
  it('adds, changes, removes', () => {
    expect(aliasOps({ fast: 'a', old: 'b' }, { fast: 'c', fresh: 'd' })).toEqual([
      { ref: 'policy:alias:fast', set: { model: 'c' } },
      { ref: 'policy:alias:fresh', set: { model: 'd' } },
      { ref: 'policy:alias:old', set: { model: null } },
    ])
  })
})

describe('routingDiffOps', () => {
  it('emits only the changed classes/tags; inherit thinking normalizes to unset', () => {
    const before = { routes: [{ workClass: 'enrichment' as const, model: 'a', thinking: 'low' as const }, { workClass: 'relay' as const, model: 'b' }], tagOverrides: [{ tag: 'legal', model: 'a' }] }
    const after = { routes: [{ workClass: 'enrichment' as const, model: 'a', thinking: 'inherit' as const }, { workClass: 'relay' as const, model: 'b' }, { workClass: 'send' as const, model: 'c' }], tagOverrides: [{ tag: 'urgent', model: 'b', thinking: 'high' as const }] }
    expect(routingDiffOps(before, after)).toEqual([
      { ref: 'route:enrichment', set: { thinking: null } },
      { ref: 'route:send', set: { model: 'c' } },
      { ref: 'tag:urgent', set: { model: 'b', thinking: 'high' } },
      { ref: 'tag:legal', set: { model: null, thinking: null } },
    ])
  })

  it('identical configs produce no ops (S5 minimality)', () => {
    const cfg = { routes: [{ workClass: 'relay' as const, model: 'b' }], tagOverrides: [] }
    expect(routingDiffOps(cfg, { routes: [...cfg.routes], tagOverrides: [] })).toEqual([])
  })
})
