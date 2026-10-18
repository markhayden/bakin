/**
 * Approval provenance (#898 D-H1..D-H8) — the ONE place that turns a
 * transport into provenance, decides whether a decision may proceed, and
 * says it in words.
 *
 * Honest by construction: HTTP is unauthenticated and agents share the OS
 * user, so a UI/CLI decision is only ever operator-DECLARED, a channel
 * decision is vouched for by its provider, and a KNOWN agent context is
 * refused. An arbitrary shell `curl` carrying the declaration is
 * indistinguishable from the operator — a documented limit, not a claim.
 */
import type {
  ApprovalProvenance,
  ChannelApprovalDecision,
} from '../adapters/runtime/channels'

/** Browser decision clients (and the CLI with `--as human`) send this. */
export const APPROVAL_OPERATOR_HEADER = 'X-Bakin-Operator'
export const APPROVAL_OPERATOR_DECLARED = 'declared'
/** The CLI sends this whenever it runs in a detected agent context. */
export const APPROVAL_AGENT_CONTEXT_HEADER = 'X-Bakin-Agent-Context'
/** The server-rendered gate decision form posts this exact scalar field. */
export const APPROVAL_OPERATOR_FORM_FIELD = 'operator'

/**
 * Headers a browser decision client sends with an approval decision or a
 * non-safe repair confirmation — "the operator is making this call".
 * Declared, not verified: the HTTP API has no authentication.
 */
export const OPERATOR_DECLARATION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [APPROVAL_OPERATOR_HEADER]: APPROVAL_OPERATOR_DECLARED,
})

const AGENT_ID = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * Provenance for an HTTP decision, from headers only (plus the one exact
 * form field the server-rendered decision page posts). Never throws; an
 * unidentified caller comes back `unknown` and the policy refuses it.
 */
export function approvalProvenanceFromRequest(
  req: Request,
  opts: { formDeclaration?: string | null } = {},
): ApprovalProvenance {
  const channel = req.headers.get('x-bakin-origin') === 'cli' ? 'cli' : 'ui'
  const agentHeader = req.headers.get(APPROVAL_AGENT_CONTEXT_HEADER)
  if (agentHeader !== null) {
    // Agent context overrides any declaration; a malformed marker is never
    // read as "no agent".
    const id = agentHeader.trim()
    return AGENT_ID.test(id)
      ? { channel, actor: { kind: 'agent', id }, evidence: 'declared' }
      : { channel, actor: { kind: 'unknown' }, evidence: 'declared' }
  }
  const declared = req.headers.get(APPROVAL_OPERATOR_HEADER) === APPROVAL_OPERATOR_DECLARED
    || opts.formDeclaration === APPROVAL_OPERATOR_DECLARED
  return declared
    ? { channel, actor: { kind: 'operator-declared' }, evidence: 'declared' }
    : { channel, actor: { kind: 'unknown' }, evidence: 'declared' }
}

/** A runtime channel's report: the provider identifies the user. */
export function provenanceFromChannelDecision(decision: ChannelApprovalDecision): ApprovalProvenance {
  const { responder } = decision
  if (!responder?.id) return { channel: decision.channel, actor: { kind: 'unknown' }, evidence: 'provider' }
  return {
    channel: decision.channel,
    actor: {
      kind: 'channel-user',
      id: responder.id,
      ...(responder.displayName ? { displayName: responder.displayName } : {}),
    },
    evidence: 'provider',
  }
}

/** Machine-readable refusal codes — consumers branch on these, never on text. */
export type ApprovalRefusalCode = 'agent_context' | 'agent_actor' | 'undeclared' | 'channel_not_allowed'

export interface ApprovalRefusal {
  code: ApprovalRefusalCode
  message: string
}

/**
 * The ONE decision policy (D-H2/D-H6), used before ANY side effect of an
 * approval decision or an operator-confirmed repair. `agentInvocation` is
 * the server-owned in-process context (an exec tool is running).
 */
export function approvalRefusal(
  provenance: ApprovalProvenance | undefined,
  agentInvocation: { agentId: string } | null,
): ApprovalRefusal | null {
  if (agentInvocation) {
    return { code: 'agent_context', message: `Approvals are decided by the operator, not agents — refused inside agent "${agentInvocation.agentId}"'s tool call.` }
  }
  if (!provenance) {
    return { code: 'undeclared', message: 'This decision carries no provenance — decide from the Bakin UI, a channel, or `--as human` on the CLI.' }
  }
  const { channel, actor, evidence } = provenance
  if (actor.kind === 'agent') {
    return { code: 'agent_actor', message: `Approvals are decided by the operator, not agents — refused for agent "${actor.id ?? 'unknown'}".` }
  }
  if (actor.kind === 'unknown') return { code: 'undeclared', message: UNDECLARED_MESSAGE[channel] }
  if ((channel === 'ui' || channel === 'cli') && actor.kind === 'operator-declared' && evidence === 'declared') return null
  if ((channel === 'discord' || channel === 'runtime') && actor.kind === 'channel-user' && evidence === 'provider' && actor.id) return null
  if (channel === 'mcp' || channel === 'hook') {
    return { code: 'channel_not_allowed', message: `Approval decisions are not accepted from ${channel}.` }
  }
  // A combination no transport builds (a channel user over UI, an operator
  // vouched for by a provider) is treated as undeclared.
  return { code: 'undeclared', message: UNDECLARED_MESSAGE[channel] }
}

const UNDECLARED_MESSAGE: Record<ApprovalProvenance['channel'], string> = {
  ui: 'Approval decisions need an explicit operator declaration from the Bakin UI.',
  cli: 'Approval decisions from the CLI need an explicit operator declaration: add --as human.',
  discord: 'The discord channel did not say who decided — the decision is refused.',
  runtime: 'The runtime channel did not say who decided — the decision is refused.',
  mcp: 'Approval decisions are not accepted from agent tools.',
  hook: 'This decision carries no provenance — pass the provenance of the request you are serving (approvalProvenanceFromRequest).',
}

/**
 * Words for a decision's provenance (D-H3/D-H8) — what the transport knows,
 * never "verified human". Undefined = a record from before provenance.
 */
export function describeApprovalProvenance(provenance: ApprovalProvenance | undefined): string {
  if (!provenance) return 'Provenance unavailable — legacy record'
  const { channel, actor } = provenance
  if (actor.kind === 'operator-declared') return channel === 'cli' ? 'CLI --as human' : 'Declared in UI'
  if (actor.kind === 'channel-user') {
    const name = actor.displayName ?? actor.id ?? 'unknown user'
    return channel === 'discord' ? `Discord @${name}` : `Runtime channel user ${name}`
  }
  if (actor.kind === 'agent') return `Agent ${actor.id ?? 'unknown'} (${channel})`
  return `Unidentified (${channel})`
}
