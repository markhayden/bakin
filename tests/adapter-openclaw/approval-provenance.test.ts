/**
 * OpenClaw native-channel decisions (#898): the provider names who decided;
 * when it does not, the decision carries no responder — never an invented
 * 'openclaw-channel' user — and core refuses it.
 */
import { describe, expect, it } from 'bun:test'
import { approvalEventFromOpenClawPayload } from '../../packages/adapter-openclaw/src/approval-helpers'
import { approvalRefusal, provenanceFromChannelDecision } from '../../packages/core/src/approvals/provenance'

const payload = (resolvedBy?: string) => ({
  id: 'plugin:test-approval',
  decision: 'allow-once' as const,
  ...(resolvedBy !== undefined ? { resolvedBy } : {}),
  ts: Date.parse('2026-10-18T12:00:00Z'),
  request: { pluginId: 'bakin', toolName: 'workflow.gate', toolCallId: 'approval-1', turnSourceChannel: 'discord', turnSourceTo: 'c-1' },
})

describe('OpenClaw approval provenance', () => {
  it('a named resolver becomes a runtime channel user the policy accepts', () => {
    const event = approvalEventFromOpenClawPayload(payload('Main Operator'))!
    const provenance = provenanceFromChannelDecision(event.decision)
    expect(provenance).toEqual({ channel: 'runtime', actor: { kind: 'channel-user', id: 'Main Operator', displayName: 'Main Operator' }, evidence: 'provider' })
    expect(approvalRefusal(provenance, null)).toBeNull()
  })

  for (const resolvedBy of [undefined, '', '   ']) {
    it(`no resolver (${JSON.stringify(resolvedBy)}) means no responder, and the policy refuses`, () => {
      const event = approvalEventFromOpenClawPayload(payload(resolvedBy))!
      expect(event.decision.responder).toBeUndefined()
      expect(approvalRefusal(provenanceFromChannelDecision(event.decision), null)?.code).toBe('undeclared')
    })
  }
})
