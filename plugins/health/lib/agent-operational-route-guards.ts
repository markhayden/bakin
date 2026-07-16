import type {
  ContextSettingsData,
  ContextSummaryData,
  LiveNowData,
} from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

export function isLiveNowData(value: unknown): value is LiveNowData {
  return isRecord(value)
    && isIsoTimestamp(value.generatedAt)
    && Array.isArray(value.runs)
    && value.runs.every((run) => isRecord(run)
      && typeof run.agent === 'string'
      && typeof run.taskId === 'string'
      && (run.taskTitle === null || typeof run.taskTitle === 'string')
      && typeof run.runId === 'string'
      && isNonNegativeNumber(run.startedAt)
      && isNonNegativeNumber(run.runningForMs)
      && isNonNegativeNumber(run.heartbeatAgeMs))
}

export function isContextSummaryData(value: unknown): value is ContextSummaryData {
  return isRecord(value)
    && value.ok === true
    && typeof value.tokenEstimateNote === 'string'
    && Array.isArray(value.agents)
    && value.agents.every((agent) => isRecord(agent)
      && typeof agent.agentId === 'string'
      && isNonNegativeNumber(agent.staticTaskBytes)
      && isNonNegativeNumber(agent.staticWorkflowBytes)
      && isNonNegativeNumber(agent.estimatedMaxTaskBytes)
      && typeof agent.workspaceAvailable === 'boolean'
      && isNonNegativeNumber(agent.workspaceTotalBytes)
      && (agent.lastObserved === null || (isRecord(agent.lastObserved)
        && isNullableNonNegativeNumber(agent.lastObserved.inputTokens)
        && isNullableNonNegativeNumber(agent.lastObserved.cacheReadTokens)
        && isNullableNonNegativeNumber(agent.lastObserved.cacheWriteTokens)
        && isNonNegativeNumber(agent.lastObserved.occurredAt))))
}

export function isContextSettingsData(value: unknown): value is ContextSettingsData {
  if (!isRecord(value)) return false
  if (value.dispatch === undefined) return true
  return isRecord(value.dispatch)
    && (value.dispatch.contextBudgetBytes === undefined
      || isNonNegativeNumber(value.dispatch.contextBudgetBytes))
}
