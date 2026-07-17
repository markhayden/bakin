/**
 * WorkClass taxonomy + per-turn model/thinking resolution. Pure functions,
 * no I/O — the routing policy that dispatch and system sends apply per turn.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure module under test (no storage), but mock the content-dir resolvers
// per the project's test-isolation rule so a transitive import can never leak.
const testDir = join(tmpdir(), 'bakin-test-model-routing')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import {
  classifyDispatchWorkClass,
  resolveTurnModel,
  resolveWorkClassRoute,
  WORK_CLASSES,
  DISPATCH_WORK_CLASSES,
  ROUTABLE_WORK_CLASSES,
  type RoutingConfig,
} from '../../src/core/model-routing'

const EMPTY: RoutingConfig = { routes: [], tagOverrides: [] }

describe('WORK_CLASSES taxonomy', () => {
  it('contains the 5 dispatch classes and 6 system classes', () => {
    const ids = WORK_CLASSES.map((c) => c.id)
    expect(ids).toEqual([
      'scheduled', 'workflow', 'adhoc', 'recovery', 'decomposition',
      'auto-title', 'enrichment', 'relay', 'team-routing', 'send', 'chat',
    ])
  })

  it('dispatch classes carry kind dispatch; system classes kind system', () => {
    for (const c of WORK_CLASSES) {
      const isDispatch = (DISPATCH_WORK_CLASSES as readonly string[]).includes(c.id)
      expect(c.kind).toBe(isDispatch ? 'dispatch' : 'system')
    }
  })

  it('chat is metered-only — the single unroutable class', () => {
    const unroutable = WORK_CLASSES.filter((c) => !c.routable).map((c) => c.id)
    expect(unroutable).toEqual(['chat'])
    expect(ROUTABLE_WORK_CLASSES).not.toContain('chat')
    expect(ROUTABLE_WORK_CLASSES).toHaveLength(WORK_CLASSES.length - 1)
  })

  it('cheap-tier recommendations: titles/relays/team-routing cheap; enrichment needs vision', () => {
    const byId = new Map(WORK_CLASSES.map((c) => [c.id, c]))
    expect(byId.get('auto-title')?.recommendedTier).toBe('cheap')
    expect(byId.get('relay')?.recommendedTier).toBe('cheap')
    expect(byId.get('team-routing')?.recommendedTier).toBe('cheap')
    expect(byId.get('enrichment')?.recommendedTier).toBe('cheap-vision')
    // dispatch classes carry no recommendation — the operator's call.
    for (const id of DISPATCH_WORK_CLASSES) expect(byId.get(id)?.recommendedTier).toBeUndefined()
  })

  it('every class has a human label and description', () => {
    for (const c of WORK_CLASSES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
    }
  })
})

describe('classifyDispatchWorkClass', () => {
  it('scheduled when the task carries a scheduleJobId', () => {
    expect(classifyDispatchWorkClass({ scheduleJobId: 'job-1' }, false)).toBe('scheduled')
  })
  it('workflow when the task carries a workflowId', () => {
    expect(classifyDispatchWorkClass({ workflowId: 'wf-1' }, false)).toBe('workflow')
  })
  it('decomposition when the task has a parentId (and is not workflow/scheduled)', () => {
    expect(classifyDispatchWorkClass({ parentId: 'parent-1' }, false)).toBe('decomposition')
  })
  it('adhoc when no origin signal is present', () => {
    expect(classifyDispatchWorkClass({}, false)).toBe('adhoc')
  })
  it('recovery (dispatch-context) overrides any task-shape class', () => {
    expect(classifyDispatchWorkClass({ scheduleJobId: 'job-1', workflowId: 'wf-1' }, true)).toBe('recovery')
  })
  it('workflow takes precedence over scheduled when both are present', () => {
    expect(classifyDispatchWorkClass({ scheduleJobId: 'job-1', workflowId: 'wf-1' }, false)).toBe('workflow')
  })
})

describe('resolveWorkClassRoute', () => {
  it('returns nothing for an empty config — inherit', () => {
    expect(resolveWorkClassRoute(EMPTY, 'auto-title')).toEqual({})
  })

  it('applies the matching work-class route', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'auto-title', model: 'anthropic/claude-haiku-4-5', thinking: 'off' }],
      tagOverrides: [],
    }
    expect(resolveWorkClassRoute(config, 'auto-title'))
      .toEqual({ model: 'anthropic/claude-haiku-4-5', thinking: 'off' })
  })

  it('other classes do not match — inherit', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'relay', model: 'm' }],
      tagOverrides: [],
    }
    expect(resolveWorkClassRoute(config, 'send')).toEqual({})
  })

  it('a tag override beats the class route when tags are provided', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'adhoc', model: 'anthropic/claude-haiku-4-5' }],
      tagOverrides: [{ tag: 'heavy', model: 'anthropic/claude-opus-4-6' }],
    }
    expect(resolveWorkClassRoute(config, 'adhoc', ['heavy']))
      .toEqual({ model: 'anthropic/claude-opus-4-6' })
  })

  it("treats a route thinking of 'inherit' as no override", () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'relay', model: 'm', thinking: 'inherit' }],
      tagOverrides: [],
    }
    expect(resolveWorkClassRoute(config, 'relay')).toEqual({ model: 'm' })
  })
})

describe('resolveTurnModel (dispatch wrapper)', () => {
  it('returns nothing for an empty config — unchanged dispatch (inherit)', () => {
    expect(resolveTurnModel({ task: {}, config: EMPTY })).toEqual({})
  })

  it('classifies the task and applies the matching route', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: { scheduleJobId: 'j' }, config }))
      .toEqual({ model: 'anthropic/claude-haiku-4-5', thinking: 'low' })
  })

  it('resolves model and thinking independently across layers', () => {
    // tag sets only thinking; class route sets only model → both apply.
    const config: RoutingConfig = {
      routes: [{ workClass: 'adhoc', model: 'anthropic/claude-sonnet-4-6' }],
      tagOverrides: [{ tag: 'careful', thinking: 'high' }],
    }
    expect(resolveTurnModel({ task: { tags: ['careful'] }, config }))
      .toEqual({ model: 'anthropic/claude-sonnet-4-6', thinking: 'high' })
  })

  it('recovery context routes to the recovery route', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'recovery', model: 'anthropic/claude-opus-4-6' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: { scheduleJobId: 'j' }, isRecovery: true, config }))
      .toEqual({ model: 'anthropic/claude-opus-4-6' })
  })

  it('returns nothing when no route matches the class', () => {
    const config: RoutingConfig = {
      routes: [{ workClass: 'scheduled', model: 'm' }],
      tagOverrides: [],
    }
    expect(resolveTurnModel({ task: {}, config })).toEqual({}) // adhoc, no route
  })
})
