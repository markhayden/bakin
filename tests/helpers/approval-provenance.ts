/**
 * Ready-made approval provenances for tests (#898) — what each transport
 * builds for a decision, so tests never hand-roll the shape.
 */
import type { ApprovalProvenance } from '../../packages/core/src/adapters/runtime/channels'

export const UI_OPERATOR: ApprovalProvenance = { channel: 'ui', actor: { kind: 'operator-declared' }, evidence: 'declared' }
export const CLI_OPERATOR: ApprovalProvenance = { channel: 'cli', actor: { kind: 'operator-declared' }, evidence: 'declared' }

export function discordUser(id: string, displayName?: string): ApprovalProvenance {
  return { channel: 'discord', actor: { kind: 'channel-user', id, ...(displayName ? { displayName } : {}) }, evidence: 'provider' }
}

export function agentActor(id: string, channel: ApprovalProvenance['channel'] = 'cli'): ApprovalProvenance {
  return { channel, actor: { kind: 'agent', id }, evidence: 'declared' }
}
