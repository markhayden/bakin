/**
 * Context-report engine (#357): per-source measurement of the startup context
 * a fresh task-dispatch session pays for. Pure read-only — no side effects,
 * no content in the output (names + numbers only).
 *
 * Three data planes, one report:
 * - STATIC dispatch-prompt sections, measured by running the REAL prompt
 *   builders (dispatch-prompts / dispatch-workflow labeled sections) against
 *   a synthetic task — measurement path == production path, so these numbers
 *   cannot drift from what dispatch actually sends.
 * - DYNAMIC blocks (lessons, per-task description/assets), reported as their
 *   configured caps — never fabricated sizes.
 * - OBSERVED grounding: recent dispatch-run token usage from the execution
 *   ledger, labeled "observed turn input" because provider-reported input
 *   covers the whole agentic loop, not just the injected prompt.
 *
 * Doctor / CLI / REST all consume this one engine so their arithmetic can't
 * drift (same pattern as budget.ts reusing evaluateBudget).
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { getContentDir } from './content-dir'
import { buildDispatchSections } from './dispatch-prompts'
import { buildWorkflowDispatchSections } from './dispatch-workflow'
import { normalizeLessonRetrievalSettings } from './agent-packages/lesson-retrieval'
import { readReceipt } from './agent-packages/receipts'
import { recentRunsByAgent } from './execution-ledger'
import type { AgentRuntimeAdapter, WorkspaceFileStat } from '@bakin/core/adapters/runtime'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'

const log = createLogger('context-report')

/** Same shape as a freshly minted task id (8 hex chars) so the ~12 taskId
 *  interpolations in the templated tool docs measure at realistic length. */
const SYNTHETIC_TASK_ID = '00000000'

export const TOKEN_ESTIMATE_NOTE = 'token counts are approximate (chars/4); ground against observed turn input'
export const OBSERVED_LABEL = 'observed turn input (covers the whole agentic loop, not just the injected prompt)'

export interface SectionEstimate {
  source: string
  bytes: number
  approxTokens: number
}

export interface DynamicCap {
  source: string
  maxBytes: number
  /** settings.json path that owns this cap. */
  setting: string
}

export interface WorkspaceFileReport {
  name: string
  bytes: number
  kind: WorkspaceFileStat['kind']
  /** Bakin-composed managed-block bytes from the latest sync receipt, when this file carries one. */
  managedBlockBytes?: number
}

export interface ObservedRunReport {
  runId: string
  taskId: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  occurredAt: number
}

export interface AgentContextReport {
  agentId: string
  generatedAt: string
  tokenEstimateNote: string
  dispatch: {
    task: { sections: SectionEstimate[]; totalBytes: number; totalApproxTokens: number }
    workflow: { sections: SectionEstimate[]; totalBytes: number; totalApproxTokens: number }
    dynamicCaps: DynamicCap[]
    /** Static task-dispatch overhead plus every configured dynamic cap. */
    estimatedMaxTaskBytes: number
  }
  workspace: {
    available: boolean
    files: WorkspaceFileReport[]
    totalBytes: number
  }
  observed: {
    label: string
    runs: ObservedRunReport[]
  }
}

export interface ContextReportDeps {
  runtime: Pick<AgentRuntimeAdapter, 'agents'>
  contentDir: string
  mainAgentId: string
}

function estimate(sections: Array<{ source: string; text: string }>): SectionEstimate[] {
  return sections.map((s) => ({
    source: s.source,
    bytes: Buffer.byteLength(s.text, 'utf-8'),
    approxTokens: Math.ceil(s.text.length / 4),
  }))
}

function totals(sections: SectionEstimate[]): { totalBytes: number; totalApproxTokens: number } {
  return {
    totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
    totalApproxTokens: sections.reduce((n, s) => n + s.approxTokens, 0),
  }
}

/**
 * Static per-dispatch overhead for one agent, straight from the production
 * section builders with a synthetic task (empty title/description — the real
 * ones are per-task dynamic content, measured via caps + observed data).
 */
export function estimateDispatchSections(
  agentId: string,
  mainAgentId: string,
  contentDir: string,
): { task: SectionEstimate[]; workflow: SectionEstimate[] } {
  const syntheticTask = { id: SYNTHETIC_TASK_ID, title: '', agent: agentId }
  return {
    task: estimate(buildDispatchSections(syntheticTask, agentId, contentDir, mainAgentId)),
    workflow: estimate(
      buildWorkflowDispatchSections(syntheticTask, { stepId: 'step', label: '' }, agentId),
    ),
  }
}

/** Configured caps for the dynamic prompt blocks (a cap of 0 = injection disabled). */
export function configuredDynamicCaps(): DynamicCap[] {
  const lessons = normalizeLessonRetrievalSettings(getSettings().agentPackages?.lessonsRetrieval)
  return [
    {
      source: 'lessons',
      maxBytes: lessons.enabled && lessons.injectIntoDispatch ? lessons.maxCharacters : 0,
      setting: 'agentPackages.lessonsRetrieval.maxCharacters',
    },
  ]
}

async function collectWorkspace(
  runtime: Pick<AgentRuntimeAdapter, 'agents'>,
  agentId: string,
): Promise<AgentContextReport['workspace']> {
  const stats = await runtime.agents.workspaceFileStats?.(agentId).catch((err: unknown) => {
    log.warn('workspaceFileStats failed — reporting workspace as unavailable', { agentId, err: String(err) })
    return null
  })
  if (!stats) return { available: false, files: [], totalBytes: 0 }

  const receipt = readReceipt(agentId)
  const blockBytes = new Map<string, number>(
    (receipt?.blocks ?? []).map((b) => [b.file, b.bytes]),
  )
  const files = stats.map((s) => ({
    name: s.name,
    bytes: s.bytes,
    kind: s.kind,
    ...(blockBytes.has(s.name) ? { managedBlockBytes: blockBytes.get(s.name) } : {}),
  }))
  return {
    available: true,
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  }
}

function collectObserved(agentId: string): ObservedRunReport[] {
  try {
    return recentRunsByAgent(agentId, { limit: 10 }).map((r) => ({
      runId: r.runId,
      taskId: r.taskId,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      occurredAt: r.occurredAt,
    }))
  } catch (err) {
    // Diagnostics degrade, they never fail the surface that asked.
    log.warn('observed-run lookup failed — reporting without grounding', { agentId, err: String(err) })
    return []
  }
}

export async function buildAgentContextReport(
  agentId: string,
  deps: Partial<ContextReportDeps> = {},
): Promise<AgentContextReport> {
  const runtime =
    deps.runtime ?? (await import('./app-services')).getAppServices().runtime
  const contentDir = deps.contentDir ?? getContentDir()
  const mainAgentId = deps.mainAgentId ?? (await getRuntimeMainAgentId(runtime as AgentRuntimeAdapter))

  const sections = estimateDispatchSections(agentId, mainAgentId, contentDir)
  const dynamicCaps = configuredDynamicCaps()
  const task = { sections: sections.task, ...totals(sections.task) }

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    tokenEstimateNote: TOKEN_ESTIMATE_NOTE,
    dispatch: {
      task,
      workflow: { sections: sections.workflow, ...totals(sections.workflow) },
      dynamicCaps,
      estimatedMaxTaskBytes: task.totalBytes + dynamicCaps.reduce((n, c) => n + c.maxBytes, 0),
    },
    workspace: await collectWorkspace(runtime, agentId),
    observed: { label: OBSERVED_LABEL, runs: collectObserved(agentId) },
  }
}
