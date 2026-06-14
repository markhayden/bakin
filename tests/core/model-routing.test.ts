/**
 * Origin classification + per-turn model/thinking resolution. Pure functions,
 * no I/O — the routing policy that dispatch applies before each turn.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure module under test (no storage), but mock the content-dir resolvers
// per the project's test-isolation rule so a transitive import can never leak.
const testDir = join(tmpdir(), 'bakin-test-model-routing')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { classifyOrigin, resolveTurnModel, type RoutingConfig } from '../../src/core/model-routing'

const EMPTY: RoutingConfig = { policies: [], tagOverrides: [] }

describe('classifyOrigin', () => {
  it('scheduled when the task carries a scheduleJobId', () => {
    expect(classifyOrigin({ scheduleJobId: 'job-1' }, false)).toBe('scheduled')
  })
  it('workflow when the task carries a workflowId', () => {
    expect(classifyOrigin({ workflowId: 'wf-1' }, false)).toBe('workflow')
  })
  it('decomposition when the task has a parentId (and is not workflow/scheduled)', () => {
    expect(classifyOrigin({ parentId: 'parent-1' }, false)).toBe('decomposition')
  })
  it('adhoc when no origin signal is present', () => {
    expect(classifyOrigin({}, false)).toBe('adhoc')
  })
  it('recovery (dispatch-context) overrides any task-shape origin', () => {
    expect(classifyOrigin({ scheduleJobId: 'job-1', workflowId: 'wf-1' }, true)).toBe('recovery')
  })
  it('workflow takes precedence over scheduled when both are present', () => {
    expect(classifyOrigin({ scheduleJobId: 'job-1', workflowId: 'wf-1' }, false)).toBe('workflow')
  })
})

describe('resolveTurnModel', () => {
  it('returns nothing for an empty config — unchanged dispatch (inherit)', () => {
    expect(resolveTurnModel({ task: {}, config: EMPTY })).toEqual({})
  })

  it('applies the matching origin policy', () => {
    const config: RoutingConfig = {
      policies: [{ origin: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: { scheduleJobId: 'j' }, config }))
      .toEqual({ model: 'anthropic/claude-haiku-4-5', thinking: 'low' })
  })

  it('a tag override beats the origin policy', () => {
    const config: RoutingConfig = {
      policies: [{ origin: 'adhoc', model: 'anthropic/claude-haiku-4-5' }],
      tagOverrides: [{ tag: 'heavy', model: 'anthropic/claude-opus-4-6' }],
    }
    expect(resolveTurnModel({ task: { tags: ['heavy'] }, config }))
      .toEqual({ model: 'anthropic/claude-opus-4-6' })
  })

  it('resolves model and thinking independently across layers', () => {
    // tag sets only thinking; origin sets only model → both apply.
    const config: RoutingConfig = {
      policies: [{ origin: 'adhoc', model: 'anthropic/claude-sonnet-4-6' }],
      tagOverrides: [{ tag: 'careful', thinking: 'high' }],
    }
    expect(resolveTurnModel({ task: { tags: ['careful'] }, config }))
      .toEqual({ model: 'anthropic/claude-sonnet-4-6', thinking: 'high' })
  })

  it("treats a policy thinking of 'inherit' as no override", () => {
    const config: RoutingConfig = {
      policies: [{ origin: 'adhoc', model: 'm', thinking: 'inherit' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: {}, config })).toEqual({ model: 'm' })
  })

  it('recovery context routes to the recovery policy', () => {
    const config: RoutingConfig = {
      policies: [{ origin: 'recovery', model: 'anthropic/claude-opus-4-6' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: { scheduleJobId: 'j' }, isRecovery: true, config }))
      .toEqual({ model: 'anthropic/claude-opus-4-6' })
  })

  it('returns nothing when no policy matches the origin', () => {
    const config: RoutingConfig = {
      policies: [{ origin: 'scheduled', model: 'm' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: {}, config })).toEqual({}) // adhoc, no policy
  })
})
