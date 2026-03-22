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
import * as openclaw from './openclaw-client'
import { readTaskboard, moveTask, addTaskLog, blockTask } from '../../plugins/tasks/taskboard'

const log = createLogger('watchdog')

let watchdogTimer: NodeJS.Timeout | null = null

// Bypass detection patterns — agents trying to work around errors instead of blocking
const BYPASS_PATTERNS = [
  /work(?:ing)?\s+around/i,
  /bypass(?:ing)?/i,
  /ignor(?:e|ing)\s+(?:the\s+)?error/i,
  /skip(?:ping)?\s+(?:the\s+)?(?:check|validation|test)/i,
  /instead\s+(?:i'll|I will|we can|let me)/i,
  /can't\s+(?:use|access|reach)\s+.*(?:so|instead)/i,
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

function countAutoRecoveries(task: { log?: { message: string }[] }): number {
  if (!task.log) return 0
  return task.log.filter(e => e.message.startsWith('Auto-recovered:')).length
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()

  watchdogTimer = setInterval(async () => {
    try {
      const { columns } = readTaskboard()
      const inProgressTasks = columns.inProgress
      const now = Date.now()

      for (const task of inProgressTasks) {
        const lastLogTs = getLastLogTimestamp(task)
        const lastActivity = lastLogTs ? lastLogTs.getTime() : (now - settings.watchdog.stuckThresholdMs - 1)
        const stuckMs = now - lastActivity

        if (stuckMs <= settings.watchdog.stuckThresholdMs) {
          // Task has recent activity — check for bypass patterns instead
          checkBypassPatterns(task, contentDir, port)
          continue
        }

        const minutesStuck = Math.round(stuckMs / 60000)
        const agentStale = isAgentHeartbeatStale(contentDir, task.agent)

        if (settings.watchdog.autoRecover && agentStale) {
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

          // Discord alert
          openclaw.sendChannelMessage(
            'discord',
            `channel:${settings.watchdog.alertChannelId}`,
            `⚠️ **Watchdog Alert**: Task "${task.title}" (@${task.agent || 'unassigned'}) has had no progress log in ${minutesStuck}+ minutes.`
          ).catch(err => {
            log.error('Watchdog Discord alert failed', err)
          })

          log.warn('Stuck task detected', { title: task.title, agent: task.agent, minutesStuck, agentStale })
        }
      }
    } catch (err) {
      log.error('Watchdog error', err)
    }
  }, settings.watchdog.intervalMs)

  log.info('Watchdog started', { intervalMs: settings.watchdog.intervalMs, thresholdMs: settings.watchdog.stuckThresholdMs })
}

/** Scan recent task log entries for bypass pattern language */
function checkBypassPatterns(task: { id: string; title: string; agent?: string; log?: { message: string; timestamp: string }[] }, contentDir: string, port: number): void {
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

        // Notify roscoe
        openclaw.sendMessage('main', alertMsg).catch(() => {})

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
