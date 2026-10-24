/**
 * The ONE brief builder (self-healing 1.5): the delegated-repair brief keeps
 * its sanctioned-fix lines and integrity rules; the fallback investigation
 * adds the engine attempts, the hand-back contract, the sanctioned verbs,
 * the Terminal convention and the turn budget — and never names a tool the
 * running release lacks.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// The brief builder is pure, but the content-dir resolvers are mocked per the repo-wide isolation rule.
const testDir = join(tmpdir(), `bakin-test-doctor-brief-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import type { HealthIncident } from '@makinbakin/sdk'
import { REFUSED_AGENT_VERBS, SANCTIONED_AGENT_VERBS, buildRepairBrief, type FallbackBriefInput } from '../../src/core/doctor-brief'

const incident = (over: Partial<HealthIncident> = {}): HealthIncident => ({
  id: 'health:search:unavailable',
  status: 'error',
  disposition: 'action_required',
  effectiveDisposition: 'action_required',
  title: 'Search engine is unavailable',
  impact: 'Nothing is indexed.',
  resources: [],
  resolution: { key: 'restart', type: 'repair', label: 'Restart', actionId: 'health.search-engine-restart' },
  observationIds: ['health.search:engine'],
  observedAt: '2026-10-24T00:00:00.000Z',
  staleAt: '2026-10-24T01:00:00.000Z',
  stale: false,
  ...over,
})

const fallback = (over: Partial<FallbackBriefInput> = {}): FallbackBriefInput => ({
  subject: { kind: 'service', id: 'search-engine', label: 'Search engine' },
  attempts: [
    { actionId: 'health.search-engine-restart', attempt: 1, outcome: 'failed', message: 'port 3738 still held', operationId: 'op-1', logExcerpt: 'bind: address in use\nretrying' },
    { actionId: 'health.search-engine-restart', attempt: 2, outcome: 'stalled', message: 'no progress for 10 min', operationId: 'op-2' },
  ],
  turnBudget: { total: 3, remaining: 2 },
  proposableActions: ['health.search-engine-install', 'health.search-engine-claim'],
  terminalAvailable: true,
  tools: { handback: true, repair: true },
  ...over,
})

describe('delegated-repair brief (today)', () => {
  it('names every incident, its sanctioned fix and the integrity rules', () => {
    const brief = buildRepairBrief({ requestId: 'req-1', incidents: [incident(), incident({ id: 'health:gh:auth', title: 'gh needs sign-in', resolution: { key: 'login', type: 'instructions', label: 'Sign in', steps: ['Run gh auth login'], command: 'gh auth login' } })] })
    expect(brief).toContain('Health repair request: req-1')
    expect(brief).toContain('health:search:unavailable')
    expect(brief).toContain('Sanctioned fix: one-click repair "Restart"')
    expect(brief).toContain('Sanctioned fix: Sign in — run `gh auth login`')
    expect(brief).toContain('INTEGRITY RULES')
    expect(brief).toContain('complete this task with a short summary')
    expect(brief).not.toContain('HAND-BACK')
    expect(brief).not.toContain('TURN BUDGET')
  })
})

describe('fallback investigation brief', () => {
  it('carries the subject, the engine attempts with excerpts, the hand-back shapes, the verbs, Terminal and the budget', () => {
    const brief = buildRepairBrief({ requestId: 'req-2', incidents: [incident()], fallback: fallback() })
    expect(brief).toContain('Health investigation: req-2')
    expect(brief).toContain('SUBJECT: service:search-engine (Search engine)')
    expect(brief).toContain('attempt 1: health.search-engine-restart → failed (operation op-1): port 3738 still held')
    expect(brief).toContain('    bind: address in use')
    expect(brief).toContain('attempt 2: health.search-engine-restart → stalled (operation op-2)')
    expect(brief).toContain('submit EXACTLY ONE of these through `bakin_exec_health_handback`')
    expect(brief).toContain('"kind": "proposal"')
    expect(brief).toContain('"kind": "human"')
    expect(brief).toContain('"kind": "upstream-blocked"')
    expect(brief).toContain('`bakin_exec_tasks_complete` refuses this task without an accepted hand-back')
    expect(brief).toContain('- health.search-engine-install')
    expect(brief).toContain('- health.search-engine-claim')
    for (const verb of SANCTIONED_AGENT_VERBS) expect(brief).toContain(`- ${verb}`)
    for (const verb of REFUSED_AGENT_VERBS) expect(brief).toContain(`- ${verb}`)
    expect(brief).toContain('Create ONE session titled "Health repair: service:search-engine (Search engine)" with `bakin_exec_terminal_session`')
    expect(brief).toContain('TURN BUDGET: 2 of 3 agent turns remain')
    expect(brief).toContain('submit it through `bakin_exec_health_repair`')
    expect(brief).toContain('No sub-delegation')
    expect(brief).toContain('INTEGRITY RULES')
    expect(brief).toContain('Do not keep working past an accepted hand-back')
  })

  it('never names a tool the release lacks: without the hand-back tool it asks for a blocked task in the same shapes', () => {
    const brief = buildRepairBrief({ requestId: 'req-3', incidents: [incident()], fallback: fallback({ tools: { handback: false, repair: false }, terminalAvailable: false, attempts: [], proposableActions: [] }) })
    expect(brief).not.toContain('bakin_exec_health_handback')
    expect(brief).not.toContain('bakin_exec_health_repair')
    expect(brief).not.toContain('bakin_exec_terminal_session')
    expect(brief).toContain('END by BLOCKING this task with a summary in EXACTLY ONE of these shapes')
    expect(brief).toContain('"kind": "proposal"')
    expect(brief).toContain('none — this incident has no deterministic repair, so it goes straight to diagnosis')
    expect(brief).toContain('PROPOSABLE ACTIONS: none registered for this subject')
    expect(brief).toContain('use your own shell')
    expect(brief).toContain('report it as a proposal and END your turn')
  })

  it('a long log excerpt is bounded to its first twelve lines', () => {
    const excerpt = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
    const brief = buildRepairBrief({ requestId: 'req-4', incidents: [incident()], fallback: fallback({ attempts: [{ actionId: 'a', attempt: 1, outcome: 'failed', message: 'm', logExcerpt: excerpt }] }) })
    expect(brief).toContain('    line 12')
    expect(brief).not.toContain('line 13')
  })
})
