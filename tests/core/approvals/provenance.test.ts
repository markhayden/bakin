/**
 * Approval provenance (#898 D-H1..D-H8): built from the transport only,
 * one refusal policy, honest words.
 */
import { describe, expect, it } from 'bun:test'
import {
  approvalProvenanceFromRequest,
  approvalRefusal,
  describeApprovalProvenance,
  OPERATOR_DECLARATION_HEADERS,
} from '../../../packages/core/src/approvals/provenance'
import { CLI_OPERATOR, UI_OPERATOR, agentActor, discordUser } from '../../helpers/approval-provenance'

const req = (headers: Record<string, string> = {}) => new Request('http://bakin.test/x', { method: 'POST', headers })

describe('approvalProvenanceFromRequest', () => {
  it('the browser declaration is operator-declared UI; CLI origin makes it CLI', () => {
    expect(approvalProvenanceFromRequest(req({ ...OPERATOR_DECLARATION_HEADERS }))).toEqual(UI_OPERATOR)
    expect(approvalProvenanceFromRequest(req({ 'X-Bakin-Origin': 'cli', ...OPERATOR_DECLARATION_HEADERS }))).toEqual(CLI_OPERATOR)
  })

  it('no declaration is unknown — never assumed to be the operator', () => {
    expect(approvalProvenanceFromRequest(req()).actor.kind).toBe('unknown')
    expect(approvalProvenanceFromRequest(req({ 'X-Bakin-Operator': 'yes' })).actor.kind).toBe('unknown')
  })

  it('an agent context overrides any declaration; a malformed marker is unknown, never "no agent"', () => {
    expect(approvalProvenanceFromRequest(req({ 'X-Bakin-Origin': 'cli', 'X-Bakin-Agent-Context': 'researcher', ...OPERATOR_DECLARATION_HEADERS })))
      .toEqual(agentActor('researcher', 'cli'))
    for (const bad of ['', '   ', 'two words', 'x'.repeat(200)]) {
      expect(approvalProvenanceFromRequest(req({ 'X-Bakin-Agent-Context': bad, ...OPERATOR_DECLARATION_HEADERS })).actor.kind).toBe('unknown')
    }
  })

  it('the decision form field counts only as the exact scalar, and headers still win', () => {
    expect(approvalProvenanceFromRequest(req(), { formDeclaration: 'declared' })).toEqual(UI_OPERATOR)
    expect(approvalProvenanceFromRequest(req(), { formDeclaration: 'DECLARED' }).actor.kind).toBe('unknown')
    expect(approvalProvenanceFromRequest(req({ 'X-Bakin-Agent-Context': 'researcher' }), { formDeclaration: 'declared' }).actor.kind).toBe('agent')
  })
})

describe('approvalRefusal — the one policy', () => {
  it('accepts declared UI/CLI operators and provider-vouched channel users', () => {
    expect(approvalRefusal(UI_OPERATOR, null)).toBeNull()
    expect(approvalRefusal(CLI_OPERATOR, null)).toBeNull()
    expect(approvalRefusal(discordUser('u-1'), null)).toBeNull()
    expect(approvalRefusal({ channel: 'runtime', actor: { kind: 'channel-user', id: 'op' }, evidence: 'provider' }, null)).toBeNull()
  })

  it('refuses agents, agent tool contexts, undeclared callers and agent-only channels', () => {
    expect(approvalRefusal(UI_OPERATOR, { agentId: 'researcher' })?.code).toBe('agent_context')
    expect(approvalRefusal(agentActor('researcher'), null)?.code).toBe('agent_actor')
    expect(approvalRefusal(undefined, null)?.code).toBe('undeclared')
    expect(approvalRefusal({ channel: 'ui', actor: { kind: 'unknown' }, evidence: 'declared' }, null)?.code).toBe('undeclared')
    // A channel user claimed over UI, or an operator claimed by a provider, is not a combination any transport builds.
    expect(approvalRefusal({ channel: 'ui', actor: { kind: 'channel-user', id: 'u' }, evidence: 'provider' }, null)?.code).toBe('undeclared')
    expect(approvalRefusal({ channel: 'discord', actor: { kind: 'operator-declared' }, evidence: 'declared' }, null)?.code).toBe('undeclared')
    for (const channel of ['mcp', 'hook'] as const) {
      expect(approvalRefusal({ channel, actor: { kind: 'operator-declared' }, evidence: 'declared' }, null)?.code).toBe('channel_not_allowed')
    }
  })
})

describe('describeApprovalProvenance', () => {
  it('says what the transport knows — never "verified human"', () => {
    expect(describeApprovalProvenance(UI_OPERATOR)).toBe('Declared in UI')
    expect(describeApprovalProvenance(CLI_OPERATOR)).toBe('CLI --as human')
    expect(describeApprovalProvenance(discordUser('123', 'mark'))).toBe('Discord @mark')
    expect(describeApprovalProvenance(discordUser('123'))).toBe('Discord @123')
    expect(describeApprovalProvenance(undefined)).toBe('Provenance unavailable — legacy record')
    expect(describeApprovalProvenance(agentActor('researcher'))).toBe('Agent researcher (cli)')
  })
})
