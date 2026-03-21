/**
 * Watchdog — detects stuck in-progress tasks and alerts via Discord.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { broadcast } from './sse'
import * as openclaw from './openclaw-client'

const log = createLogger('watchdog')

let watchdogTimer: NodeJS.Timeout | null = null

function extractSection(content: string, heading: string): string | null {
  const lines = content.split('\n')
  let capture = false
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      if (capture) break
      if (line.includes(heading)) {
        capture = true
        continue
      }
    } else if (capture) {
      result.push(line)
    }
  }
  return result.length > 0 ? result.join('\n') : null
}

function parseInProgressTasks(content: string): { title: string; agent: string | null; lastLogTs: Date | null }[] {
  const section = extractSection(content, '🔵 In Progress')
  if (!section) return []

  const tasks: { title: string; agent: string | null; lastLogTs: Date | null }[] = []
  const lines = section.split('\n')
  let current: { title: string; agent: string | null; lastLogTs: Date | null } | null = null

  for (const line of lines) {
    if (line.startsWith('- [')) {
      if (current) tasks.push(current)
      const titleMatch = line.replace(/^- \[[ x]\] /, '').replace(/ @\w+/, '').replace(/ — .*$/, '').trim()
      const agentMatch = line.match(/@(\w+)/)
      current = { title: titleMatch, agent: agentMatch ? agentMatch[1] : null, lastLogTs: null }
    } else if (current && /^\s{2,}/.test(line) && line.trim()) {
      const logMatch = line.trim().match(/^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+\w+\]/)
      if (logMatch) {
        const ts = new Date(logMatch[1])
        if (!current.lastLogTs || ts > current.lastLogTs) {
          current.lastLogTs = ts
        }
      }
    }
  }
  if (current) tasks.push(current)
  return tasks
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()

  watchdogTimer = setInterval(() => {
    try {
      const taskboardPath = join(contentDir, 'TASKBOARD.md')
      if (!existsSync(taskboardPath)) return
      const content = readFileSync(taskboardPath, 'utf-8')
      const tasks = parseInProgressTasks(content)
      const now = Date.now()

      for (const task of tasks) {
        const lastActivity = task.lastLogTs ? task.lastLogTs.getTime() : (now - settings.watchdog.stuckThresholdMs - 1)
        const stuckMs = now - lastActivity
        if (stuckMs > settings.watchdog.stuckThresholdMs) {
          const minutesStuck = Math.round(stuckMs / 60000)
          const alertMsg = `Task stuck: "${task.title}" (@${task.agent || 'unassigned'}) — no log update in ${minutesStuck} minutes`

          broadcast({ type: 'alert', title: task.title, agent: task.agent, message: alertMsg })

          // Log on the task
          try {
            const logBody = JSON.stringify({ title: task.title, author: 'watchdog', message: `ALERT: No progress logged in ${minutesStuck}+ minutes` })
            const http = require('http')
            const logReq = http.request({
              hostname: 'localhost', port, path: '/api/tasks/log',
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(logBody) }
            })
            logReq.write(logBody)
            logReq.end()
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

          log.warn('Stuck task detected', { title: task.title, agent: task.agent, minutesStuck })
        }
      }
    } catch (err) {
      log.error('Watchdog error', err)
    }
  }, settings.watchdog.intervalMs)

  log.info('Watchdog started', { intervalMs: settings.watchdog.intervalMs, thresholdMs: settings.watchdog.stuckThresholdMs })
}

export function stop(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
    log.info('Watchdog stopped')
  }
}
