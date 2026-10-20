/**
 * OpenClaw 2026.9.5 `agent` RPC params — the CLOSED property list, copied
 * from the installed dist (`AgentParamsSchema = closedObject({...})`,
 * src-BULWd1u1.mjs). The real gateway refuses any other key with
 * `invalid agent params: at root: unexpected property '<k>'; code=INVALID_REQUEST`
 * (#883 — that is how `toolsMode` was found). The mock mirrors that so the
 * suite catches adapter↔gateway drift before a live box does.
 *
 * Only `message` and `idempotencyKey` are non-optional in 9.5; the mock
 * enforces those two as well. The unexpected-property wording is verified
 * against the dist; the missing-property wording is the mock's own.
 */
export const AGENT_PARAM_KEYS: ReadonlySet<string> = new Set([
  'message', 'agentId', 'provider', 'model', 'to', 'replyTo', 'sessionId', 'sessionKey',
  'expectedExistingSessionId', 'thinking', 'deliver', 'attachments', 'channel', 'replyChannel',
  'accountId', 'replyAccountId', 'threadId', 'groupId', 'groupChannel', 'groupSpace', 'timeout',
  'bestEffortDeliver', 'lane', 'cwd', 'cleanupBundleMcpOnRunEnd', 'modelRun', 'promptMode',
  'extraSystemPrompt', 'bootstrapContextMode', 'bootstrapContextRunKind', 'acpTurnSource',
  'internalRuntimeHandoffId', 'internalExecutionIdentityRetry', 'internalExecutionIdentityRecoveryAttempt',
  'execApprovalFollowupExpectedSessionId', 'internalEvents', 'inputProvenance', 'suppressPromptPersistence',
  'sessionEffects', 'sourceReplyDeliveryMode', 'disableMessageTool', 'swarmCollector', 'swarmOutputSchema',
  'forceRestartSafeTools', 'forceCodeModeTools', 'voiceWakeTrigger', 'idempotencyKey', 'label',
])

const REQUIRED_NON_EMPTY_STRINGS = ['message', 'idempotencyKey'] as const

export interface AgentParamsRejection {
  ok: false
  error: { message: string; code: 'INVALID_REQUEST' }
}

/** The gateway's rejection for these params, or null when they are valid. */
export function validateAgentParams(params: Record<string, unknown>): AgentParamsRejection | null {
  for (const key of Object.keys(params)) {
    if (!AGENT_PARAM_KEYS.has(key)) {
      return { ok: false, error: { message: `invalid agent params: at root: unexpected property '${key}'`, code: 'INVALID_REQUEST' } }
    }
  }
  for (const key of REQUIRED_NON_EMPTY_STRINGS) {
    const value = params[key]
    if (typeof value !== 'string' || value.length === 0) {
      return { ok: false, error: { message: `invalid agent params: at root: missing required property '${key}'`, code: 'INVALID_REQUEST' } }
    }
  }
  return null
}
