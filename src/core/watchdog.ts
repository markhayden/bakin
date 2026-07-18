/**
 * Watchdog — detects stuck in-progress tasks, auto-recovers when agent is stale,
 * and detects agents bypassing rules.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { broadcast } from './sse'
import { appendAudit } from './audit'
import { isStale } from '../lib/format'
import { getAppServices } from './app-services'
import { meterAgentTurn } from './agent-cost'
import { resolveSystemRoute, routeSendArgs } from './system-route'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { getStatsByMs } from './usage'
import {
  addTaskLog,
  blockTask,
  getTask,
  moveTask,
  readTaskboard,
} from './task-store'
import { getLiveRun, supersedeStaleRun } from './execution-ledger'
import {
  abortTurnsForTask,
  forceReleaseTurn,
  getInFlightTurnsSnapshot,
  ORPHAN_TURN_FORCE_RELEASE_GRACE_MS,
} from './dispatch-registry'

const log = createLogger('watchdog')
const hooks = () => getHookRegistry()

let watchdogTimer: NodeJS.Timeout | null = null
let lastMcpAlertAt = 0
let lastRestAlertAt = 0

// Bypass detection patterns — agents trying to work around errors instead of blocking
const BYPASS_PATTERNS = [
  /work(?:ing)?\s+around/i,
  /bypass(?:ing)?/i,
  /ignor(?:e|ing)\s+(?:the\s+)?error/i,
  /skip(?:ping)?\s+(?:the\s+)?(?:check|validation|test)/i,
  /instead\s+(?:i'll|I will|we can|let me)/i,
  /can't\s+(?:use|access|reach)\s+.*(?:so|instead)/i,
  // Workflow scope violations — agents doing extra work beyond their step
  /I(?:'ll| will) also (?:generate|create|write|produce)/i,
  /let me (?:also|additionally)/i,
  /while I(?:'m| am) at it/i,
  /moving (?:the )?task to done/i,
  /I(?:'ve| have) (?:also|additionally) (?:generated|created|written|produced)/i,
]

function getLastLogTimestamp(task: { log?: { timestamp: string }[] }): Date | null {
  if (!task.log || task.log.length === 0) return null
  let latest: Date | null = null
  for (const entry of task.log) {
    const ts = new Date(entry.timestamp)
    if (!isNaN(ts.getTime()) && (!latest || ts > latest)) {
      latest = ts
    }
  }
  return latest
}

/**
 * Restart recovery classifies some tasks 'manual' and writes a structured
 * hold marker ({restartRecovery:'manual'} in the entry data). While that
 * marker is the LATEST log entry the watchdog must not auto-recover the
 * task — 'manual' means a human decides. Any newer log entry (human or
 * agent activity) clears the hold naturally. Structured match only — never
 * message-text classification. Timestamp ties prefer the later array entry.
 */
function latestLogIsManualRecoveryHold(task: { log?: Array<{ timestamp: string; data?: Record<string, unknown> }> }): boolean {
  if (!task.log || task.log.length === 0) return false
  let latest: { timestamp: string; data?: Record<string, unknown> } | null = null
  let latestTs = Number.NEGATIVE_INFINITY
  for (const entry of task.log) {
    const ts = Date.parse(entry.timestamp)
    if (!Number.isNaN(ts) && ts >= latestTs) {
      latest = entry
      latestTs = ts
    }
  }
  return latest?.data?.restartRecovery === 'manual'
}

function isAgentHeartbeatStale(contentDir: string, agent: string | undefined): boolean {
  if (!agent) return true

  // Agent-written heartbeat file. A runtime liveness signal should be added
  // as an explicit adapter capability instead of hidden registry state.
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

function countAutoRecoveries(task: { log?: { message: string }[] }): number {
  if (!task.log) return 0
  return task.log.filter(e => e.message.startsWith('Auto-recovered:')).length
}

export function getNotificationChannel(settings: ReturnType<typeof getSettings>): string | null {
  const channel = settings.notifications.channel.trim()
  if (!channel || channel === 'none') return null
  if (channel.includes(':')) return channel
  // OpenClaw's message send REQUIRES a destination (--target). Settings carry
  // it separately (notifications.target) — compose the adapter's
  // channel:target ref, same as channel-aliases does. A bare channel with no
  // target fails at the CLI and alerts silently never arrive.
  const target = (settings.notifications.target ?? '').trim()
  return target ? `${channel}:${target}` : channel
}

async function sendWatchdogChannelMessage(channel: string, message: string): Promise<void> {
  const channels = getAppServices().runtime.channels
  if (!channels) {
    // Optional capability (P2.1): no channel layer on this runtime — the
    // alert degrades to log-only. The message content is already logged by
    // every caller before attempting delivery.
    log.warn('Watchdog alert not delivered — runtime has no channel layer', { channel })
    return
  }
  await channels.sendMessage({
    channels: [channel],
    message: {
      body: message,
    },
  })
}

async function sendMainAgentAlert(message: string): Promise<void> {
  const runtime = getAppServices().runtime
  const agentId = await getRuntimeMainAgentId(runtime)
  const route = await resolveSystemRoute('relay')
  const result = await runtime.messaging.send({ agentId, content: message, activityClass: 'system', ...routeSendArgs(route) })
  await meterAgentTurn({ agent: agentId, activityClass: 'system', result, workClass: 'relay', routeSource: route.source, resolvedModel: route.model, name: 'watchdog-alert' })
}

export function start(contentDir: string): void {
  const initialSettings = getSettings()

  watchdogTimer = setInterval(async () => {
    // Re-read settings every cycle so UI changes (alert channel, thresholds)
    // take effect without a server restart. updateSettings() busts the cache,
    // so this is just one JSON read per interval.
    const settings = getSettings()

    // #604: turns whose task was deleted mid-flight are invisible to the
    // board scan below — sweep the in-flight registry directly. Isolated
    // try/catch: a sweep failure must never break the stuck-task scan.
    try {
      sweepOrphanedTurns(contentDir)
    } catch (err) {
      log.error('Orphan turn sweep failed', err)
    }

    try {
      type WdTask = { id: string; title: string; agent?: string; workflowId?: string; updatedAt?: number; log?: Array<{ message: string; timestamp: string }> }
      const board = readTaskboard() as unknown as { columns: Record<string, WdTask[]> }
      const { columns } = board
      const inProgressTasks = columns.inProgress || []
      const now = Date.now()

      for (const task of inProgressTasks) {
        // Restart recovery flagged this task for MANUAL attention — hold off
        // while the structured marker is the latest log entry.
        if (latestLogIsManualRecoveryHold(task)) {
          log.debug('Skipping task under manual recovery hold', { id: task.id })
          continue
        }

        // Skip workflow tasks waiting on a gate or already complete — they're legitimately idle
        const wfCheck = task as typeof task & { workflowId?: string }
        if (wfCheck.workflowId) {
          const wfInstance = await hooks().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId: task.id })
          if (wfInstance && (wfInstance.status === 'pending_approval' || wfInstance.status === 'complete')) continue
        }

        // Fallback chain for "last activity":
        //   1. Most recent task log entry (agent or system)
        //   2. The flow row's updated_at — i.e. when the task was last
        //      mutated (created, moved, dispatched). Grants a fresh task
        //      a full stuckThresholdMs grace window before it's eligible
        //      for auto-recovery, so a just-dispatched task doesn't get
        //      declared "30 min stuck" on the very first watchdog tick.
        //   3. now() — guarantees we never synthesize an ancient timestamp.
        const lastLogTs = getLastLogTimestamp(task)
        const lastActivity = lastLogTs?.getTime() ?? task.updatedAt ?? now
        const stuckMs = now - lastActivity

        if (stuckMs <= settings.watchdog.stuckThresholdMs) {
          // Task has recent activity — check for bypass patterns instead
          checkBypassPatterns(task, contentDir)
          continue
        }

        const minutesStuck = Math.round(stuckMs / 60000)

        // For workflow tasks, check the workflow step's assigned agent — not the card's task.agent
        const wfTask = task as typeof task & { workflowId?: string }
        let effectiveAgent = task.agent
        if (wfTask.workflowId) {
          const activeAgents = await hooks().invoke<Array<{ agent: string; stepId: string }>>('workflows.getActiveAgents', { taskId: task.id }) ?? []
          if (activeAgents.length > 0) {
            effectiveAgent = activeAgents[0].agent
          }
        }
        const agentStale = isAgentHeartbeatStale(contentDir, effectiveAgent)

        if (settings.watchdog.autoRecover && agentStale) {
          // Supersede-first: the ledger arbitrates recovery. A live run with
          // a fresh heartbeat means the agent is genuinely working (it
          // replaces the old 60s updatedAt guard — heartbeats are the real
          // signal the file mtime was a proxy for). Zero live runs = a
          // stranded task, recover as before. A stale run is superseded
          // transactionally — of N racing recovery actors exactly one wins;
          // losers skip. Ledger failure = fail closed (no blind recovery).
          try {
            const liveRun = getLiveRun(task.id)
            if (liveRun) {
              const supersede = supersedeStaleRun(task.id, now - settings.watchdog.stuckThresholdMs)
              if (!supersede.superseded) {
                log.debug('Skipping auto-recovery: live run heartbeat is fresh', { id: task.id, runId: liveRun.runId })
                continue
              }
              appendAudit(contentDir, 'task.run_superseded', 'watchdog', {
                id: task.id,
                title: task.title,
                agent: task.agent,
                runIds: supersede.runIds,
                minutesStuck,
              })
            }
          } catch (err) {
            log.error('Ledger supersede failed — skipping auto-recovery this tick (fail closed)', err, { id: task.id })
            continue
          }

          // Both task and agent are stale — auto-recover
          const recoveryCount = countAutoRecoveries(task)

          if (recoveryCount >= settings.watchdog.maxAutoRecoveries) {
            // Escalate to blocked
            try {
              await blockTask(task.id, `Auto-recovery limit reached (${recoveryCount} attempts). Agent "${task.agent || 'unassigned'}" appears offline.`)
              await addTaskLog(task.id, 'watchdog', `Escalated to blocked: ${recoveryCount} auto-recoveries exhausted. Manual intervention required.`)
              appendAudit(contentDir, 'task.auto_recovery_exhausted', 'watchdog', { id: task.id, title: task.title, agent: task.agent, recoveryCount })
              log.warn('Task escalated to blocked after max recoveries', { id: task.id, title: task.title, recoveryCount })
            } catch (err) {
              log.error('Failed to escalate task to blocked', err, { id: task.id })
            }
          } else {
            // Move back to todo for re-dispatch
            try {
              await addTaskLog(task.id, 'watchdog', `Auto-recovered: no agent heartbeat or task log for ${minutesStuck}+ minutes. Moved back to Todo for re-dispatch.`)
              await moveTask(task.id, 'todo')
              appendAudit(contentDir, 'task.auto_recovered', 'watchdog', { id: task.id, title: task.title, agent: task.agent, minutesStuck })
              log.info('Task auto-recovered to todo', { id: task.id, title: task.title, minutesStuck })
            } catch (err) {
              log.error('Failed to auto-recover task', err, { id: task.id })
            }
          }
        } else {
          // Agent is alive but task is stale — alert only
          const alertMsg = `Task stuck: "${task.title}" (@${task.agent || 'unassigned'}) — no log update in ${minutesStuck} minutes${agentStale ? ' (agent offline)' : ' (agent online)'}`

          broadcast({ type: 'alert', title: task.title, agent: task.agent, message: alertMsg })

          try {
            await addTaskLog(task.id, 'watchdog', `ALERT: No progress logged in ${minutesStuck}+ minutes`)
          } catch (err) {
            log.warn('Failed to log watchdog alert on task', err)
          }

          const notificationChannel = getNotificationChannel(settings)
          if (notificationChannel) {
            sendWatchdogChannelMessage(
              notificationChannel,
              `⚠️ **Watchdog Alert**: Task "${task.title}" (@${task.agent || 'unassigned'}) has had no progress log in ${minutesStuck}+ minutes.`
            ).catch(err => {
              log.error('Watchdog channel alert failed', err)
            })
          }

          log.warn('Stuck task detected', { title: task.title, agent: task.agent, minutesStuck, agentStale })
        }
      }
      // ─── MCP 5xx error-rate alert ────────────────────────────────────
      // Wrapped in its own try/catch so a failure here can never take out
      // the stuck-task loop or the workflow checks below.
      try {
        const wd = settings.watchdog
        const mcpStats = getStatsByMs({ kind: 'mcp', windowMs: wd.mcpWindowMs })
        if (mcpStats.total >= wd.mcpMinSamples) {
          const errorRate = mcpStats.errors / mcpStats.total
          if (errorRate >= wd.mcpErrorThreshold) {
            const sinceLast = now - lastMcpAlertAt
            if (sinceLast >= wd.mcpAlertCooldownMs) {
              lastMcpAlertAt = now
              const pct = Math.round(errorRate * 100)
              const windowSec = Math.round(wd.mcpWindowMs / 1000)
              const alertMsg = `MCP server returning ${pct}% 5xx (${mcpStats.errors}/${mcpStats.total} requests in last ${windowSec}s) — agents can't call tools`

              broadcast({ type: 'alert', title: 'MCP unhealthy', message: alertMsg })
              appendAudit(contentDir, 'mcp.5xx_alert', 'watchdog', {
                errors: mcpStats.errors,
                total: mcpStats.total,
                errorRate,
                windowMs: wd.mcpWindowMs,
              })
              log.error('MCP 5xx alert', undefined, {
                errors: mcpStats.errors,
                total: mcpStats.total,
                errorRate,
              })

              const notificationChannel = getNotificationChannel(settings)
              if (notificationChannel) {
                sendWatchdogChannelMessage(
                  notificationChannel,
                  `⚠️ **MCP unhealthy** — ${alertMsg}. Check \`~/.bakin/logs/server.log\` and \`/health\`.`,
                ).catch(err => {
                  log.error('MCP 5xx channel alert failed', err)
                })
              }
            }
          }
        }
      } catch (err) {
        log.error('MCP 5xx alert check failed', err)
      }

      // ─── REST 5xx error-rate alert ───────────────────────────────────
      // Parallel to the MCP block above. Agents SHOULD be using MCP exec
      // tools, but the UI, CLI, and any misbehaving agent still route
      // through /api/plugins/*. Alert when that surface starts flapping.
      try {
        const wd = settings.watchdog
        const restStats = getStatsByMs({ kind: 'rest', windowMs: wd.restWindowMs })
        if (restStats.total >= wd.restMinSamples) {
          const errorRate = restStats.errors / restStats.total
          if (errorRate >= wd.restErrorThreshold) {
            const sinceLast = now - lastRestAlertAt
            if (sinceLast >= wd.restAlertCooldownMs) {
              lastRestAlertAt = now
              const pct = Math.round(errorRate * 100)
              const windowSec = Math.round(wd.restWindowMs / 1000)
              const alertMsg = `REST API returning ${pct}% 5xx (${restStats.errors}/${restStats.total} requests in last ${windowSec}s)`

              broadcast({ type: 'alert', title: 'REST API unhealthy', message: alertMsg })
              appendAudit(contentDir, 'rest.5xx_alert', 'watchdog', {
                errors: restStats.errors,
                total: restStats.total,
                errorRate,
                windowMs: wd.restWindowMs,
              })
              log.error('REST 5xx alert', undefined, {
                errors: restStats.errors,
                total: restStats.total,
                errorRate,
              })

              const notificationChannel = getNotificationChannel(settings)
              if (notificationChannel) {
                sendWatchdogChannelMessage(
                  notificationChannel,
                  `⚠️ **REST API unhealthy** — ${alertMsg}. Check \`~/.bakin/logs/server.log\` and \`/health\`.`,
                ).catch(err => {
                  log.error('REST 5xx channel alert failed', err)
                })
              }
            }
          }
        }
      } catch (err) {
        log.error('REST 5xx alert check failed', err)
      }

      // ─── Workflow step timeout detection ─────────────────────────────
      try {
        const wfSettings = settings.workflow
        const activeInstances = await hooks().invoke<Array<{ taskId: string; currentStepId: string; workflowId: string; status: string; stepStates: Record<string, { status: string; startedAt?: string; output?: unknown }>; history: Array<{ stepId: string; rejectionReason?: string }> }>>('workflows.instances.list', { statusFilter: 'in_progress' }) ?? []

        // Build set of task IDs on the board for orphan detection
        const boardTaskIds = new Set<string>()
        for (const col of Object.values(columns)) {
          for (const t of (col as Array<{ id: string }>)) boardTaskIds.add(t.id)
        }

        for (const instance of activeInstances) {
          // Skip orphaned instances — task was deleted from the board
          if (!boardTaskIds.has(instance.taskId)) continue

          const stepState = instance.stepStates[instance.currentStepId]
          if (!stepState || stepState.status !== 'in_progress' || !stepState.startedAt) continue

          const stepAge = now - new Date(stepState.startedAt).getTime()
          if (stepAge <= wfSettings.stepTimeoutMs) continue

          const minutesStuck = Math.round(stepAge / 60000)
          const taskId = instance.taskId

          // Count how many times we've already timed-out this step
          const timeoutLogs = instance.history.filter(
            h => h.stepId === instance.currentStepId && h.rejectionReason?.startsWith('TIMEOUT:')
          ).length

          if (timeoutLogs >= wfSettings.maxRedispatches) {
            // Escalate — block the task
            try {
              await blockTask(taskId, `Workflow step "${instance.currentStepId}" timed out after ${wfSettings.maxRedispatches} re-dispatches. Agent never submitted output via step/complete API.`)
              await addTaskLog(taskId, 'watchdog', `Workflow step timeout escalated to blocked after ${wfSettings.maxRedispatches} re-dispatches`)
              appendAudit(contentDir, 'workflow.step_timeout_blocked', 'watchdog', { taskId, stepId: instance.currentStepId, timeoutLogs })
              log.warn('Workflow step blocked after max timeouts', { taskId, stepId: instance.currentStepId })
            } catch (err) {
              log.error('Failed to block timed-out workflow step', err, { taskId })
            }
          } else {
            // Alert — the step will be re-dispatched on next dispatch cycle
            try {
              await addTaskLog(taskId, 'watchdog', `TIMEOUT: Workflow step "${instance.currentStepId}" has been in_progress for ${minutesStuck}+ minutes with no output submitted via step/complete API.`)
              appendAudit(contentDir, 'workflow.step_timeout', 'watchdog', { taskId, stepId: instance.currentStepId, minutesStuck })
              log.warn('Workflow step timeout', { taskId, stepId: instance.currentStepId, minutesStuck })
            } catch (err) {
              log.error('Failed to log workflow step timeout', err, { taskId })
            }
          }
        }
      } catch (err) {
        log.error('Workflow step timeout check failed', err)
      }

      // Gate approval notifications are owned by the workflows plugin: it posts
      // a rich context message + native approval card to the approvals channel
      // at gate-fire time (sendGateApprovalRequest). The watchdog no longer
      // pings the general channel per gate.
    } catch (err) {
      log.error('Watchdog error', err)
    }
  }, initialSettings.watchdog.intervalMs)

  log.info('Watchdog started', { intervalMs: initialSettings.watchdog.intervalMs, thresholdMs: initialSettings.watchdog.stuckThresholdMs })
}

/**
 * Abort in-flight turns whose task no longer exists, and force-release any
 * that survive their abort past the grace period (#604). Store lookup, not
 * board-column presence — done/archived tasks still exist and are never
 * orphans. First sighting fires the turn's AbortController (the 'aborted'
 * settle branch in dispatch-turns does the bookkeeping); a turn still
 * registered a full grace period later is dropped from the advisory registry
 * so a hung provider turn can't hold the agent's dispatch slot until restart.
 */
function sweepOrphanedTurns(contentDir: string): void {
  const now = Date.now()
  for (const turn of getInFlightTurnsSnapshot()) {
    // A nested-workflow step turn serves a child board task too — either id
    // missing makes the turn an orphan.
    const childGone = turn.childTaskId ? !getTask(turn.childTaskId) : false
    if (getTask(turn.taskId) && !childGone) continue
    if (!turn.abortedAt) {
      abortTurnsForTask(childGone && turn.childTaskId ? turn.childTaskId : turn.taskId, 'orphan-sweep')
      continue
    }
    if (now - turn.abortedAt < ORPHAN_TURN_FORCE_RELEASE_GRACE_MS) continue
    if (forceReleaseTurn(turn.marker)) {
      appendAudit(contentDir, 'task.turn_force_released', 'watchdog', {
        id: turn.taskId,
        agent: turn.agentId,
        runId: turn.threadId,
        marker: turn.marker,
        abortedAt: turn.abortedAt,
      })
      log.warn('Force-released hung orphan turn', { taskId: turn.taskId, agent: turn.agentId, runId: turn.threadId })
    }
  }
}

/** Scan recent task log entries for bypass pattern language */
function checkBypassPatterns(task: { id: string; title: string; agent?: string; log?: { message: string; timestamp: string }[] }, contentDir: string): void {
  if (!task.log || task.log.length === 0) return

  // Only check the last 3 log entries
  const recentLogs = task.log.slice(-3)
  for (const entry of recentLogs) {
    // Skip watchdog's own log entries
    if (entry.message.startsWith('ALERT:') || entry.message.startsWith('Auto-recovered:') || entry.message.startsWith('⚠️')) continue

    for (const pattern of BYPASS_PATTERNS) {
      const match = entry.message.match(pattern)
      if (match) {
        const alertMsg = `⚠️ Possible rule bypass detected on "${task.title}" (@${task.agent || 'unassigned'}): "${match[0]}"`

        broadcast({ type: 'alert', title: task.title, agent: task.agent, message: alertMsg })
        appendAudit(contentDir, 'task.bypass_detected', 'watchdog', { id: task.id, title: task.title, agent: task.agent, pattern: match[0] })

        sendMainAgentAlert(alertMsg).catch(() => {})

        log.warn('Bypass pattern detected', { id: task.id, title: task.title, pattern: match[0] })
        return // Only alert once per watchdog cycle per task
      }
    }
  }
}

export function stop(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
    log.info('Watchdog stopped')
  }
}
