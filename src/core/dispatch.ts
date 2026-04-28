/**
 * Task dispatch system for Bakin.
 * Periodically checks for TODO tasks and dispatches them to agents via the runtime adapter.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { recordUsage } from './usage'
import { getRuntimeAdapter } from './runtime-registry'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { isStale } from '../lib/format'
import { getHookRegistry } from '../lib/plugin-registry'
import { readProject } from '../../plugins/projects/lib/parser'

const log = createLogger('dispatch')
const hooks = () => getHookRegistry()

async function sendDispatchMessage(agentId: string, content: string): Promise<void> {
  await getRuntimeAdapter().messaging.send({ agentId, content })
}

// Upstream runtime error bodies land in task logs and audit JSONL via
// the dispatch catch handlers. Bound the blast radius — a runaway adapter
// response (HTML error page, stack trace, accidental secret echo) should
// not balloon the audit file or the task drawer.
const MAX_ERR_LEN = 500
function formatDispatchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.length > MAX_ERR_LEN ? `${raw.slice(0, MAX_ERR_LEN)}… (truncated)` : raw
}

type DispatchFailureKind = 'transient' | 'structural'

interface FailureRecord {
  lastAttempt: number
  count: number
  kind: DispatchFailureKind
}

interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[]
  failedDispatches: Record<string, FailureRecord>
}

type DispatchTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  description?: string
  projectId?: string
  log?: Array<{ timestamp: string }>
}

type DispatchColumns = {
  backlog: DispatchTask[]
  todo: DispatchTask[]
  inProgress: DispatchTask[]
  review: DispatchTask[]
  done: DispatchTask[]
  blocked: DispatchTask[]
  archived: DispatchTask[]
}

function emptyDispatchColumns(): DispatchColumns {
  return {
    backlog: [],
    todo: [],
    inProgress: [],
    review: [],
    done: [],
    blocked: [],
    archived: [],
  }
}

async function readDispatchColumns(): Promise<DispatchColumns> {
  const board = await hooks().invoke<{ columns: Partial<DispatchColumns> }>('tasks.readTaskboard', {})
  return { ...emptyDispatchColumns(), ...(board?.columns ?? {}) }
}

async function addTaskLog(taskId: string, author: string, message: string): Promise<void> {
  await hooks().invoke<void>('tasks.addTaskLog', { identifier: taskId, author, message })
}

async function moveTaskToInProgress(taskId: string, agent: string): Promise<void> {
  await hooks().invoke<void>('tasks.updateTask', {
    identifier: taskId,
    updates: { column: 'inProgress', agent },
  })
}

async function moveTask(taskId: string, to: string, from?: string): Promise<void> {
  await hooks().invoke<void>('tasks.moveTask', { identifier: taskId, to, from })
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

// Split dispatch failures into:
//   - transient: fetch/network errors that slipped past sendMessage's in-call
//     retry — e.g. node-undici's TypeError('fetch failed'), raw socket
//     errors surfaced via err.cause.code. Use the short cooldown.
//   - structural: adapter failures with an HTTP-like status. The runtime
//     answered and said no, so use the long cooldown.
// Default to 'structural' on unknown errors: treating an unknown failure as
// a real outage is the safer side — worst case we wait longer than needed,
// not shorter.
function classifyDispatchError(err: unknown): DispatchFailureKind {
  if (err instanceof Error && /\bfailed \(\d{3}\)/.test(err.message)) {
    return 'structural'
  }
  if (err instanceof TypeError && err.message.includes('fetch failed')) return 'transient'
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_CODES.has(cause.code)) return 'transient'
  if (err instanceof Error && err.name === 'AbortError') return 'transient'
  return 'structural'
}

let dispatching = false
let dispatchStartedAt = 0
let dispatchTimer: NodeJS.Timeout | null = null
const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes max per dispatch cycle

// Async mutex for .dispatch-state.json — serializes all reads/writes
let stateQueue = Promise.resolve() as Promise<unknown>
function withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = stateQueue.then(fn, fn) as Promise<T>
  stateQueue = next.then(() => {}, () => {})
  return next
}

function getStateFile(contentDir: string): string {
  return join(contentDir, '.dispatch-state.json')
}

function getFailureRecord(entry: FailureRecord | undefined): FailureRecord | null {
  if (!entry) return null
  return { ...entry, kind: entry.kind ?? 'structural' }
}

function cooldownForFailure(
  failure: FailureRecord,
  settings: { dispatch: { transientCooldownMs: number; failureCooldownMs: number } },
): number {
  return failure.kind === 'transient'
    ? settings.dispatch.transientCooldownMs
    : settings.dispatch.failureCooldownMs
}

function getDispatchMarkerTaskId(marker: string): string {
  const separator = marker.indexOf(':')
  return separator === -1 ? marker : marker.slice(0, separator)
}

export function loadDispatchState(contentDir: string): DispatchState {
  const stateFile = getStateFile(contentDir)
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (!Array.isArray(parsed.dispatched)) parsed.dispatched = []
      if (!parsed.failedDispatches || typeof parsed.failedDispatches !== 'object') parsed.failedDispatches = {}
      return parsed
    }
  } catch (err) {
    log.warn('Failed to read dispatch state', err)
  }
  return { lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {} }
}

function saveDispatchState(contentDir: string, state: DispatchState): void {
  writeFileSync(getStateFile(contentDir), JSON.stringify(state, null, 2), 'utf-8')
}

export async function dispatchTasks(contentDir: string, port: number): Promise<void> {
  // If a previous dispatch is stuck (>3min), force-release the mutex
  if (dispatching && dispatchStartedAt > 0 && (Date.now() - dispatchStartedAt) > DISPATCH_TIMEOUT_MS) {
    log.warn('Dispatch mutex stuck — force-releasing after timeout', { stuckSinceMs: Date.now() - dispatchStartedAt })
    dispatching = false
  }
  if (dispatching) return
  dispatching = true
  dispatchStartedAt = Date.now()

  const settings = getSettings()

  try {
    // Acquire state lock for the entire cycle to prevent races with dispatchSingleTask
    await withStateLock(async () => {
    const state = loadDispatchState(contentDir)
    const runtime = getRuntimeAdapter()
    const runtimeAgentIds = new Set((await runtime.agents.list()).map((agent) => agent.id))
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    // Reconcile dispatch state with taskboard reality
    const columns = await readDispatchColumns()
    const todoTasks = columns.todo
    const activeIds = new Set([
      ...columns.inProgress.map(t => t.id),
      ...columns.done.map(t => t.id),
      ...columns.archived.map(t => t.id),
    ])
    state.dispatched = state.dispatched.filter(id => activeIds.has(getDispatchMarkerTaskId(id)))
    // Rebuild dispatchedSet AFTER reconciliation so tasks moved back to todo are eligible
    const dispatchedSet = new Set(state.dispatched)
    for (const task of columns.inProgress) {
      if (!dispatchedSet.has(task.id)) {
        dispatchedSet.add(task.id)
        state.dispatched.push(task.id)
      }
    }

    // ─── Dispatch in-progress workflow tasks that changed step agents ──
    // After gate approval, the workflow advances to a new agent's step but
    // the task stays in inProgress. We need to dispatch the new agent.
    for (const task of columns.inProgress) {
      const wfTask = task as typeof task & { workflowId?: string }
      if (!wfTask.workflowId) continue

      // Check if the current workflow step agent has been dispatched
      const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string; effectiveTaskId?: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
      const needsDispatch = activeAgents.some(({ stepId }) => !dispatchedSet.has(`${task.id}:${stepId}`))
      if (!needsDispatch) continue

      try {
        await dispatchWorkflowTask(
          { ...wfTask, workflowId: wfTask.workflowId },
          contentDir, port, dispatchedSet, state,
          async () => {}, // already in progress, no column move needed
          addTaskLog,
          mainAgentId,
        )
      } catch (err) {
        log.error(`Failed to re-dispatch workflow task "${task.title}"`, err)
      }
    }

    if (todoTasks.length === 0) {
      saveDispatchState(contentDir, state)
      return
    }

    for (const task of todoTasks) {
      if (dispatchedSet.has(task.id)) continue

      // Check failure history with max retries
      const failure = getFailureRecord(state.failedDispatches?.[task.id])
      if (failure) {
        if (failure.count >= settings.dispatch.maxRetries) {
          // Escalate to blocked
          try {
            await hooks().invoke<void>('tasks.blockTask', { identifier: task.id, reason: `Dispatch failed ${failure.count} times — agent may be unavailable` })
            await addTaskLog(task.id, 'system', `Dispatch exhausted: ${failure.count} failed attempts. Task moved to blocked.`)
            appendAudit(contentDir, 'task.dispatch_exhausted', 'system', { id: task.id, title: task.title, count: failure.count })
            log.warn('Task blocked after max dispatch retries', { id: task.id, count: failure.count })
          } catch (err) {
            log.error('Failed to block exhausted task', err)
          }
          continue
        }
        if (Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings)) continue
      }

      if (task.agent && !runtimeAgentIds.has(task.agent)) continue

      // Workflow-aware dispatch path
      const taskWithWorkflow = task as typeof task & { workflowId?: string }
      if (taskWithWorkflow.workflowId) {
        try {
          await dispatchWorkflowTask({ ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId }, contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog, mainAgentId)
        } catch (err) {
          log.error(`Failed to dispatch workflow task "${task.title}"`, err)
        }
        continue
      }

      const targetAgent = task.agent ?? mainAgentId

      const message = buildDispatchMessage(task, targetAgent, contentDir, port, mainAgentId)

      try {
        // Move to inProgress BEFORE sending message to eliminate race condition
        // where fast agents complete before dispatch moves the task
        await moveTaskToInProgress(task.id, targetAgent)
        appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

        await sendDispatchMessage(targetAgent, message)
        dispatchedSet.add(task.id)

        appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title })
        log.info('Task dispatched', { id: task.id, title: task.title, agent: targetAgent })
      } catch (err) {
        log.error(`Failed to dispatch "${task.title}" to ${targetAgent}`, err)

        if (!state.failedDispatches) state.failedDispatches = {}
        const prev = getFailureRecord(state.failedDispatches[task.id])
        const kind = classifyDispatchError(err)
        state.failedDispatches[task.id] = { lastAttempt: Date.now(), count: (prev?.count || 0) + 1, kind }

        const errMsg = formatDispatchError(err)
        try {
          await addTaskLog(task.id, 'system', `Dispatch failed (attempt ${(prev?.count || 0) + 1}, ${kind}) → ${targetAgent}: ${errMsg}`)
        } catch {
          // best effort
        }

        appendAudit(contentDir, 'task.dispatch_failed', targetAgent, { id: task.id, title: task.title, error: errMsg, attempt: (prev?.count || 0) + 1, kind })
      }
    }

    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    if (state.dispatched.length > settings.dispatch.maxDispatched) {
      state.dispatched = state.dispatched.slice(-200)
    }
    saveDispatchState(contentDir, state)
    }) // end withStateLock
  } finally {
    dispatching = false
  }
}

/**
 * Immediately dispatch a single task by ID, bypassing the 5-minute cycle.
 * Used for kick (explicit) and auto-kick (subtask with parentId).
 */
export async function dispatchSingleTask(
  taskId: string,
  contentDir: string,
  port: number,
  source: 'kick' | 'subtask' = 'kick'
): Promise<void> {
  const settings = getSettings()

  await withStateLock(async () => {
    const columns = await readDispatchColumns()
    const task = columns.todo.find(t => t.id === taskId)
    if (!task) {
      log.debug('dispatchSingleTask: task not in todo, skipping', { taskId })
      return
    }

    const runtime = getRuntimeAdapter()
    const runtimeAgentIds = new Set((await runtime.agents.list()).map((agent) => agent.id))
    const mainAgentId = await getRuntimeMainAgentId(runtime)
    if (task.agent && !runtimeAgentIds.has(task.agent)) {
      log.warn('dispatchSingleTask: agent not in allowed list', { taskId, agent: task.agent })
      return
    }

    const state = loadDispatchState(contentDir)
    if (state.dispatched.includes(taskId)) {
      log.debug('dispatchSingleTask: already dispatched', { taskId })
      return
    }

    // Check failure history
    const failure = getFailureRecord(state.failedDispatches?.[taskId])
    if (failure) {
      if (failure.count >= settings.dispatch.maxRetries) {
        log.warn('dispatchSingleTask: task exhausted retries', { taskId, count: failure.count })
        return
      }
      if (Date.now() - failure.lastAttempt < cooldownForFailure(failure, settings)) {
        log.debug('dispatchSingleTask: task in cooldown', { taskId, kind: failure.kind })
        return
      }
    }

    // Workflow-aware dispatch path
    const taskWithWorkflow = task as typeof task & { workflowId?: string }
    if (taskWithWorkflow.workflowId) {
      const dispatchedSet = new Set(state.dispatched)
      const wfStart = Date.now()
      const wfAgent = task.agent ?? mainAgentId
      try {
        await dispatchWorkflowTask(
          { ...taskWithWorkflow, workflowId: taskWithWorkflow.workflowId },
          contentDir, port, dispatchedSet, state, moveTaskToInProgress, addTaskLog, mainAgentId,
        )
        state.dispatched = [...dispatchedSet]
        saveDispatchState(contentDir, state)
        appendAudit(contentDir, 'task.kicked', source, { id: taskId, title: task.title, workflow: true })
        log.info('Single-task dispatch (workflow)', { id: taskId, title: task.title, source })
        recordUsage({
          kind: 'agent',
          name: 'dispatch',
          agent: wfAgent,
          durationMs: Date.now() - wfStart,
          status: 'ok',
          meta: { taskId: task.id, title: task.title, workflow: true, source },
        })
      } catch (err) {
        log.error(`dispatchSingleTask: workflow dispatch failed for "${task.title}"`, err)
        recordUsage({
          kind: 'agent',
          name: 'dispatch',
          agent: wfAgent,
          durationMs: Date.now() - wfStart,
          status: 'error',
          meta: { taskId: task.id, title: task.title, workflow: true, source, error: formatDispatchError(err) },
        })
      }
      return
    }

    // Regular task dispatch
    const targetAgent = task.agent ?? mainAgentId
    const message = buildDispatchMessage(task, targetAgent, contentDir, port, mainAgentId)
    const dispatchStart = Date.now()

    try {
      // Move to inProgress BEFORE sending message to eliminate race condition
      await moveTaskToInProgress(task.id, targetAgent)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })

      await sendDispatchMessage(targetAgent, message)

      state.dispatched.push(task.id)
      saveDispatchState(contentDir, state)

      appendAudit(contentDir, 'task.dispatched', targetAgent, { id: task.id, title: task.title })
      appendAudit(contentDir, 'task.kicked', source, { id: task.id, title: task.title })
      log.info('Single-task dispatch', { id: task.id, title: task.title, agent: targetAgent, source })
      recordUsage({
        kind: 'agent',
        name: 'dispatch',
        agent: targetAgent,
        durationMs: Date.now() - dispatchStart,
        status: 'ok',
        meta: { taskId: task.id, title: task.title, source },
      })
    } catch (err) {
      log.error(`dispatchSingleTask: failed to dispatch "${task.title}" to ${targetAgent}`, err)

      if (!state.failedDispatches) state.failedDispatches = {}
      const prev = getFailureRecord(state.failedDispatches[task.id])
      const kind = classifyDispatchError(err)
      state.failedDispatches[task.id] = { lastAttempt: Date.now(), count: (prev?.count || 0) + 1, kind }
      saveDispatchState(contentDir, state)

      try {
        const errMsg = formatDispatchError(err)
        await addTaskLog(task.id, 'system', `Immediate dispatch failed (attempt ${(prev?.count || 0) + 1}, ${kind}) → ${targetAgent}: ${errMsg}`)
      } catch {
        // best effort
      }

      recordUsage({
        kind: 'agent',
        name: 'dispatch',
        agent: targetAgent,
        durationMs: Date.now() - dispatchStart,
        status: 'error',
        meta: { taskId: task.id, title: task.title, source, error: formatDispatchError(err) },
      })
    }
  })
}

/** @internal Exported for testing. */
export function buildDispatchMessage(
  task: { id: string; title: string; description?: string; agent?: string; projectId?: string },
  agentName: string,
  contentDir: string,
  _port: number,
  mainAgentId = 'main',
): string {
  void _port
  const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''

  // List attached assets by filename (stable identity). Agents open them
  // via bakin_exec_assets_open — disk paths are a view, not identity.
  // Under filename-as-identity, every asset lives under
  // assets/store/{YYYY-MM}/; the sidecar's taskId is the link.
  let assetsBlock = ''
  try {
    const storeRoot = join(contentDir, 'assets', 'store')
    const filenames: string[] = []
    if (existsSync(storeRoot)) {
      for (const month of readdirSync(storeRoot)) {
        if (month.startsWith('.')) continue
        const monthDir = join(storeRoot, month)
        let metas: string[]
        try { metas = readdirSync(monthDir).filter(f => f.endsWith('.meta.json')) } catch { continue }
        for (const metaFile of metas) {
          try {
            const meta = JSON.parse(readFileSync(join(monthDir, metaFile), 'utf-8'))
            if (meta.taskId !== task.id) continue
            const assetFilename = metaFile.replace(/\.meta\.json$/, '')
            if (assetFilename.includes('.thumb.') || assetFilename.includes('.opt.')) continue
            filenames.push(assetFilename)
          } catch { /* skip unreadable sidecars */ }
        }
      }
    }
    if (filenames.length > 0) {
      assetsBlock = `\n\n## Attached Assets\nThis task has ${filenames.length} linked asset(s). Review them for context before starting:\n${filenames.map(f => `- ${f}`).join('\n')}\nCall bakin_exec_assets_open with the filename to read the current content + sidecar metadata. Filenames are stable identity — do not store raw disk paths.`
    }
  } catch { /* assets directory may not exist */ }

  // Project context — lightweight mention if task has a projectId
  let projectBlock = ''
  if (task.projectId) {
    try {
      const project = readProject(task.projectId)
      if (project) {
        projectBlock = `\n\n**Project:** "${project.title}" (id: ${project.id}, ${project.progress}% complete)\nThe project spec contains detailed requirements. Call bakin_exec_project_get to read it before starting work.`
      }
    } catch { /* projects plugin may not be loaded */ }
  }
  const contactsRef = `Reference info is in ${join(contentDir, 'team/CONTACTS.md')}.`

  const server = `bakin-${agentName}`
  const mc = (tool: string, args: string) => `mcporter call ${server}.${tool} ${args}`

  if (!task.agent) {
    return `Triage this task: "${task.title}".${detailsBlock}${assetsBlock}\n\nEither handle it yourself or assign it to the right agent (patch=execution, pixel=design/media, rolo=content/comms, basil=research/strategy) via \`${mc('bakin_exec_tasks_assign', `taskId=${task.id} agent="<agent>"`)}\`. ${contactsRef}\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  if (task.agent === mainAgentId) {
    return `Work on this task: "${task.title}".${detailsBlock}${assetsBlock}\n\n${contactsRef} When done: \`${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you did>"`)}\`\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``
  }

  return `Work on this task: "${task.title}".${detailsBlock}${assetsBlock}${projectBlock}

## PROGRESS LOGGING — MANDATORY

You MUST log your progress at EVERY major step — not just start and done. These updates appear in the live activity feed so humans can monitor your work in real-time.

Required log points:
- Log at task start: what you are about to do and your approach
- Log after each major step (reading files, planning, each significant code change, after build)
- Share your reasoning and decisions as you go
- Log if blocked or anything unexpected happens
- Log on completion with a full summary
- If you have not logged in the last 2 minutes, log a status update — even if just "still working on X"

For Patch using Claude Code: log before spawning the agent, and after it completes.

## BAKIN TOOLS — via mcporter

All Bakin interactions use mcporter. Your server is \`${server}\`.

\`\`\`bash
# Log progress (mandatory, every major step)
${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<what you did or are doing>"`)}

# Report complete (when finished — includes summary + notifies orchestrator)
${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you accomplished>"`)}

# Block task (if stuck or cannot proceed)
${mc('bakin_exec_tasks_block', `taskId=${task.id} reason="<what went wrong>"`)}

# Create subtask for another agent
${mc('bakin_exec_tasks_create', `title="<subtask>" assignee="<agent>" description="<brief>" parentId=${task.id}`)}

# Register dependency (then stop — you'll be re-dispatched)
${mc('bakin_exec_tasks_set_dependency', `taskId=${task.id} dependsOn="<other-task-id>"`)}

# Check your task details
${mc('bakin_exec_tasks_get', `taskId=${task.id}`)}

# Find content directories (assets, team, etc.)
${mc('bakin_exec_get_paths', '')}
\`\`\`

## EXECUTION TOOLS — for doing actual work

These tools help you accomplish the work. Use them as your primary way to save files, post content, and generate assets.

\`\`\`bash
# Save any file as a managed asset (handles naming + sidecar metadata)
${mc('bakin_exec_save_asset', `taskId=${task.id} type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what it is>"`)}

# Post to a runtime channel (with optional image/video attachment)
${mc('bakin_exec_post_channel', `channel="<name>" content="<message>" taskId=${task.id}`)}

# Generate image via Nano Banana
${mc('bakin_exec_gen_image', `taskId=${task.id} prompt="<text>" preset=social-portrait model=flash`)}

# Check workflow gate statuses
${mc('bakin_exec_check_gates', `taskId=${task.id}`)}
${task.projectId ? `
# Project tools (this task is part of a project)
${mc('bakin_exec_project_get', `projectId="${task.projectId}"`)}
${mc('bakin_exec_project_mark_item', `projectId="${task.projectId}" taskItemId="<itemId>" checked=true`)}
${mc('bakin_exec_project_add_item', `projectId="${task.projectId}" title="<item title>"`)}` : `
# Projects: bakin_exec_project_list, bakin_exec_project_create, bakin_exec_project_get`}
\`\`\`

## DEPENDENCY PATTERN

If your task requires output from another agent:
1. Create their task with bakin_exec_tasks_create (use parentId for immediate dispatch)
2. Register the dependency with bakin_exec_tasks_set_dependency
3. Stop — you will be automatically re-dispatched when their task completes`
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()
  dispatchTimer = setInterval(() => {
    dispatchTasks(contentDir, port).catch(err => {
      log.error('Dispatch cycle failed', err)
      appendAudit(contentDir, 'system.dispatch_error', 'system', { error: err instanceof Error ? err.message : String(err) })
    })
  }, settings.dispatch.intervalMs)
  log.info('Dispatch started', { intervalMs: settings.dispatch.intervalMs })
}

export function stop(): void {
  if (dispatchTimer) {
    clearInterval(dispatchTimer)
    dispatchTimer = null
    log.info('Dispatch stopped')
  }
}

/**
 * Dispatch a workflow-backed task. Creates an instance if needed,
 * then sends only the current step's instructions to the assigned agent.
 */
async function dispatchWorkflowTask(
  task: { id: string; title: string; description?: string; agent?: string; workflowId: string },
  contentDir: string,
  port: number,
  dispatchedSet: Set<string>,
  state: DispatchState,
  moveTaskToInProgress: (id: string, agent: string) => Promise<void>,
  addTaskLog: (id: string, author: string, message: string) => Promise<void>,
  mainAgentId: string,
): Promise<void> {
  // Load or create workflow instance.
  // Pass the task assignee so $assigned steps resolve to whoever owns the task at start time.
  const instance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
  if (!instance) {
    await hooks().invoke<Record<string, unknown>>('workflows.createInstance', { taskId: task.id, workflowId: task.workflowId, assignee: task.agent })
    log.info('Created workflow instance', { taskId: task.id, workflowId: task.workflowId, resolvedAgent: task.agent })
  } else if (!instance.resolvedAgent && task.agent) {
    // Backfill resolvedAgent if instance was created before $assigned resolution was wired up
    instance.resolvedAgent = task.agent
    await hooks().invoke<void>('workflows.saveInstance', { instance })
    log.info('Backfilled resolvedAgent on existing instance', { taskId: task.id, resolvedAgent: task.agent })
  }

  // Get agents for current step
  const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string; effectiveTaskId?: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
  if (activeAgents.length === 0) {
    log.debug('No active agents for workflow step', { taskId: task.id })
    return
  }

  // Move task to in_progress BEFORE dispatching to agents — same pattern as
  // non-workflow tasks. Prevents the task from sitting in "todo" while the
  // agent is already working on it.
  if (!dispatchedSet.has(task.id)) {
    const { columns: fresh } = await hooks().invoke<{ columns: Record<string, Array<{ id: string; agent?: string; title?: string; workflowId?: string }>> }>('tasks.readTaskboard', {}) ?? { columns: {} }
    const stillInTodo = fresh.todo.some(t => t.id === task.id)
    if (stillInTodo) {
      const ownerAgent = task.agent || activeAgents[0]?.agent || mainAgentId
      await moveTaskToInProgress(task.id, ownerAgent)
      appendAudit(contentDir, 'task.moved', 'dispatch', { id: task.id, title: task.title, from: 'todo', to: 'inProgress' })
    }
    dispatchedSet.add(task.id)
  }

  for (const { agent, stepId, effectiveTaskId } of activeAgents) {
    // For nested workflows, use the child's taskId for step context resolution
    const contextTaskId = effectiveTaskId || task.id
    const stepContext = await hooks().invoke<Record<string, unknown>>('workflows.getCurrentStep', { taskId: contextTaskId, agentId: agent })
    if (!stepContext || 'status' in stepContext && (stepContext.status === 'complete' || stepContext.status === 'pending_approval')) {
      continue
    }

    const ctx = stepContext as {
      stepId: string; label: string; type?: string; instructions?: string;
      output_schema?: Record<string, unknown>; rejectionReason?: string;
      previousOutput?: Record<string, unknown>; priorStepOutput?: Record<string, unknown>;
      stepOutputs?: Record<string, Record<string, unknown>>; deny_tools?: string[]
    }
    const targetAgent = agent
    // Pass contextTaskId so the step/complete API targets the right instance
    const message = buildWorkflowDispatchMessage({ ...task, id: contextTaskId }, ctx, agent, port)

    try {
      await sendDispatchMessage(targetAgent, message)
      dispatchedSet.add(`${task.id}:${stepId}`)

      appendAudit(contentDir, 'task.dispatched', targetAgent, {
        id: task.id,
        title: task.title,
        workflowId: task.workflowId,
        stepId,
      })
      log.info('Workflow step dispatched', { taskId: task.id, stepId, agent: targetAgent })
    } catch (err) {
      log.error(`Failed to dispatch workflow step "${stepId}" to ${targetAgent}`, err)
      if (!state.failedDispatches) state.failedDispatches = {}
      const prev = getFailureRecord(state.failedDispatches[task.id])
      const kind = classifyDispatchError(err)
      state.failedDispatches[task.id] = { lastAttempt: Date.now(), count: (prev?.count || 0) + 1, kind }

      try {
        const errMsg = formatDispatchError(err)
        await addTaskLog(task.id, 'system', `Workflow dispatch failed (attempt ${(prev?.count || 0) + 1}, ${kind}) for step "${stepId}" → ${targetAgent}: ${errMsg}`)
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Build a dispatch message for a workflow step.
 * Contains ONLY the current step instructions — never future steps.
 *
 * Structure: identity frame → hard constraints → revision context → task → output → commands → stop.
 * Rules come BEFORE instructions (position primacy — LLMs weight early text more).
 */
function buildWorkflowDispatchMessage(
  task: { id: string; title: string; description?: string },
  stepContext: {
    stepId: string
    label: string
    type?: string
    instructions?: string
    output_schema?: Record<string, unknown>
    rejectionReason?: string
    previousOutput?: Record<string, unknown>
    priorStepOutput?: Record<string, unknown>
    stepOutputs?: Record<string, Record<string, unknown>>
    deny_tools?: string[]
  },
  agentName: string,
  _port: number
): string {
  void _port
  const lines: string[] = []

  // ─── Identity Frame ─────────────────────────────────────────────────
  lines.push('# WORKFLOW STEP ASSIGNMENT')
  lines.push('')
  lines.push('You are executing a single step in a managed workflow. You are NOT a general assistant right now — you are a workflow step executor.')
  lines.push('')
  lines.push(`**Task:** "${task.title}"`)
  if (task.description) {
    lines.push(`**Context:** ${task.description}`)
  }
  lines.push(`**Your step:** ${stepContext.label} (ID: ${stepContext.stepId})`)
  lines.push(`**Your agent name:** ${agentName}`)
  lines.push('')

  // ─── Hard Constraints ───────────────────────────────────────────────
  lines.push('## HARD CONSTRAINTS — violations are rejected server-side')
  lines.push('')
  lines.push('1. **SCOPE:** Do ONLY the work described in "YOUR TASK" below. Nothing more. If the task implies work for another step (e.g., generating images when your step is writing copy), STOP — that belongs to a different agent.')
  lines.push('2. **OUTPUT:** Submit via bakin_exec_submit_step. Describing results in conversation does NOT complete the step. The workflow will not advance.')
  lines.push('3. **SCHEMA:** Your output MUST match the JSON schema below. The server validates it. Missing fields = rejection. Extra fields = rejection. Wrong types = rejection.')
  lines.push('4. **NO SIDE EFFECTS:** Do not create subtasks, dispatch other agents, move the task to Done, or post to any channel. The workflow engine handles ALL downstream handoffs — the next agent is already defined in the workflow and will be dispatched automatically when your step is approved. Creating a subtask would duplicate the workflow\'s job.')
  lines.push('5. **ONE SUBMISSION:** Submit your output once via the API, then stop. Do not continue working after submission.')
  if (stepContext.deny_tools?.length) {
    lines.push(`6. **TOOL RESTRICTIONS:** Do NOT use: ${stepContext.deny_tools.join(', ')}. If this step requires those capabilities, BLOCK the task immediately.`)
  }
  lines.push('')

  // ─── Revision Context ───────────────────────────────────────────────
  if (stepContext.rejectionReason) {
    lines.push('## REVISION REQUIRED')
    lines.push('')
    if (stepContext.previousOutput) {
      lines.push('**Previous output (rejected):**')
      lines.push('```json')
      lines.push(JSON.stringify(stepContext.previousOutput, null, 2))
      lines.push('```')
      lines.push('')
    }
    lines.push(`**What to fix:** ${stepContext.rejectionReason}`)
    lines.push('')
    lines.push('You MUST address this specific feedback. Do NOT resubmit unchanged output — the server detects near-duplicate resubmissions and rejects them.')
    lines.push('')
  }

  // ─── Workflow Context (all prior step outputs) ─────────────────────
  if (stepContext.stepOutputs && Object.keys(stepContext.stepOutputs).length > 0) {
    lines.push('## WORKFLOW CONTEXT')
    lines.push('')
    lines.push('All completed step outputs from this workflow. Use as context for your work:')
    lines.push('')
    for (const [sid, output] of Object.entries(stepContext.stepOutputs)) {
      const label = sid === '__parentContext' ? 'Parent Workflow (upstream handoff)' : `Step: ${sid}`
      lines.push(`### ${label}`)
      // Surface parent task metadata prominently for child workflows
      if (sid === '__parentContext' && output && typeof output === 'object') {
        const ctx = output as Record<string, unknown>
        if (ctx._parentTaskTitle) {
          lines.push(`**Parent Task:** ${ctx._parentTaskTitle}`)
        }
        if (ctx._parentTaskDescription) {
          lines.push(`**Description:** ${ctx._parentTaskDescription}`)
        }
        // Show remaining output data (excluding internal metadata keys)
        const rest = Object.fromEntries(Object.entries(ctx).filter(([k]) => !k.startsWith('_parent')))
        if (Object.keys(rest).length > 0) {
          lines.push('```json')
          lines.push(JSON.stringify(rest, null, 2))
          lines.push('```')
        }
      } else {
        lines.push('```json')
        lines.push(JSON.stringify(output, null, 2))
        lines.push('```')
      }
      lines.push('')
    }
  } else if (stepContext.priorStepOutput) {
    lines.push('## PRIOR STEP OUTPUT')
    lines.push('')
    lines.push('The previous step in this workflow produced the following output. Use this as context for your work:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.priorStepOutput, null, 2))
    lines.push('```')
    lines.push('')
  }

  // ─── Task Instructions ──────────────────────────────────────────────
  lines.push('## YOUR TASK')
  lines.push('')
  if (stepContext.instructions) {
    lines.push(stepContext.instructions)
    lines.push('')
  }

  // ─── Required Output ────────────────────────────────────────────────
  if (stepContext.output_schema) {
    lines.push('## REQUIRED OUTPUT')
    lines.push('')
    lines.push('Your output must be valid JSON matching this schema:')
    lines.push('```json')
    lines.push(JSON.stringify(stepContext.output_schema, null, 2))
    lines.push('```')
    lines.push('')
  }

  // ─── Progress Logging ──────────────────────────────────────────────
  lines.push('## PROGRESS LOGGING — MANDATORY')
  lines.push('')
  const wfServer = `bakin-${agentName}`
  const wfMc = (tool: string, args: string) => `mcporter call ${wfServer}.${tool} ${args}`

  lines.push('You MUST log your progress throughout this workflow step. These updates appear in the live activity feed so humans can monitor your work in real-time.')
  lines.push('')
  lines.push('**When to log:**')
  lines.push('- IMMEDIATELY when you start working (what you are about to do and your approach)')
  lines.push('- After each significant action (reading files, generating content, making API calls, reviewing output)')
  lines.push('- Share your reasoning ("The brief calls for warm tones, going with golden hour lighting")')
  lines.push('- If anything unexpected happens or you are blocked')
  lines.push('- When you complete and submit your output (summary of what you produced)')
  lines.push('- If more than 2 minutes have passed since your last log, send a status update — even if just "Still working on X, currently Y"')
  lines.push('')

  // ─── Commands ───────────────────────────────────────────────────────
  lines.push('## COMMANDS')
  lines.push('')
  lines.push(`Your Bakin MCP server is \`${wfServer}\`. Use mcporter for all interactions:`)
  lines.push('')
  lines.push('```bash')
  lines.push(`# Submit your output (must match the schema above)`)
  lines.push(`${wfMc('bakin_exec_submit_step', `taskId=${task.id} stepId=${stepContext.stepId} --args '<json output>'`)}`)
  lines.push('')
  lines.push(`# Log progress (mandatory, every major step)`)
  lines.push(`${wfMc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}`)
  lines.push('')
  lines.push(`# Check your current step details if needed`)
  lines.push(`${wfMc('bakin_exec_get_step', `taskId=${task.id}`)}`)
  lines.push('')
  lines.push('# --- Execution tools for doing actual work ---')
  lines.push('')
  lines.push(`# Save any file as a managed asset`)
  lines.push(`${wfMc('bakin_exec_save_asset', `taskId=${task.id} type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what>"`)}`);
  lines.push('')
  lines.push(`# Generate image via Nano Banana`)
  lines.push(`${wfMc('bakin_exec_gen_image', `taskId=${task.id} prompt="<text>" preset=social-portrait model=flash`)}`);
  lines.push('')
  lines.push(`# Check workflow gate statuses`)
  lines.push(`${wfMc('bakin_exec_check_gates', `taskId=${task.id}`)}`);
  // Only include channel posting for output/publish steps (non-output steps have "NO SIDE EFFECTS" constraint)
  if (stepContext.type === 'output') {
    lines.push('')
    lines.push(`# Post to a runtime channel (with optional image/video attachment)`)
    lines.push(`${wfMc('bakin_exec_post_channel', `channel="<name>" content="<message>" taskId=${task.id}`)}`);
  }
  lines.push('```')
  lines.push('')

  // ─── Stop Instruction ───────────────────────────────────────────────
  lines.push('## AFTER SUBMITTING')
  lines.push('')
  lines.push('After bakin_exec_submit_step returns success, your work is done. Do NOT:')
  lines.push('- Generate additional outputs or deliverables')
  lines.push('- Start work on what you think the next step might be')
  lines.push('- Send messages about what should happen next')
  lines.push('- Move the task to Done (the workflow engine handles this)')

  return lines.join('\n')
}

/**
 * Run once on server startup to recover orphaned in-progress tasks.
 * If an agent's heartbeat is stale and the task has no recent logs, move back to todo.
 */
export async function reconcileOnStartup(contentDir: string): Promise<void> {
  const settings = getSettings()
  try {
    const { columns } = await hooks().invoke<{ columns: Record<string, Array<{ id: string; title: string; agent?: string; workflowId?: string; description?: string; projectId?: string; log?: Array<{ timestamp: string }> }>> }>('tasks.readTaskboard', {}) ?? { columns: {} }
    let recovered = 0

    for (const task of [...columns.inProgress]) {
      const agentStale = isAgentHeartbeatStale(contentDir, task.agent)
      const hasRecentLog = task.log?.some(e => {
        const ts = new Date(e.timestamp).getTime()
        return !isNaN(ts) && (Date.now() - ts) < settings.watchdog.stuckThresholdMs
      })

      if (agentStale && !hasRecentLog) {
        try {
          await hooks().invoke<void>('tasks.addTaskLog', { identifier: task.id, author: 'system', message: 'Recovered on server restart: agent heartbeat stale and no recent task logs.' })
          await moveTask(task.id, 'todo', 'inProgress')
          appendAudit(contentDir, 'task.startup_recovered', 'system', { id: task.id, title: task.title, agent: task.agent })
          recovered++
          log.info('Startup recovery: task moved to todo', { id: task.id, title: task.title })
        } catch (err) {
          log.error('Startup recovery failed for task', err, { id: task.id })
        }
      }
    }

    if (recovered > 0) {
      log.info('Startup reconciliation complete', { recovered })
    }
  } catch (err) {
    log.error('Startup reconciliation failed', err)
  }
}

function isAgentHeartbeatStale(contentDir: string, agent: string | undefined): boolean {
  if (!agent) return true
  const heartbeatPath = join(contentDir, 'heartbeats', `${agent}.json`)
  try {
    if (!existsSync(heartbeatPath)) return true
    const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8'))
    const ts = data.timestamp || data.ts
    if (!ts) return true
    return isStale(ts, 15 * 60 * 1000)
  } catch {
    return true
  }
}

export function getDispatchInfo(contentDir: string): Record<string, unknown> {
  const settings = getSettings()
  const state = loadDispatchState(contentDir)
  const now = Date.now()
  const interval = settings.dispatch.intervalMs
  const baseline = state.lastRun || state.serverStart || now

  // Calculate the next run time that's actually in the future.
  // If we've missed one or more intervals (e.g. dispatch was stuck),
  // advance to the next upcoming tick rather than showing 0:00.
  let nextRun = baseline + interval
  if (nextRun <= now) {
    const elapsed = now - baseline
    const missedIntervals = Math.floor(elapsed / interval)
    nextRun = baseline + (missedIntervals + 1) * interval
  }
  const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))

  return {
    intervalMs: interval,
    intervalMin: interval / 60000,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    nextRun: new Date(nextRun).toISOString(),
    secondsUntilNext,
    dispatching,
    dispatchedCount: state.dispatched.length,
  }
}
