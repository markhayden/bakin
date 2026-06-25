/**
 * Tasks plugin background maintenance timers: hourly auto-archive of done
 * tasks (>24h) and periodic hard-delete of old completed tasks (when the
 * autoArchiveDays setting is enabled).
 *
 * Extracted from index.ts. `startMaintenance` clears any prior timers before
 * (re)starting, preserving the clear-before-start re-entrancy contract that
 * makes plugin hot-reload safe; `stopMaintenance` is called from onShutdown.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import { archiveOldTasks, autoArchiveDoneTasks } from '../../../src/core/task-store'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('tasks')

let maintenanceTimers: Array<ReturnType<typeof setInterval>> = []

/** Clear all maintenance timers. Idempotent. */
export function stopMaintenance(): void {
  for (const timer of maintenanceTimers) {
    clearInterval(timer)
  }
  maintenanceTimers = []
}

/**
 * Start the auto-archive + old-task-cleanup timers. Clears any existing timers
 * first so a re-activation (hot reload) doesn't stack duplicate intervals.
 */
export function startMaintenance(ctx: PluginContext): void {
  stopMaintenance()

  // Auto-archive: move done tasks to archived after 24 hours (runs hourly)
  const autoArchived = autoArchiveDoneTasks()
  if (autoArchived > 0) log.info(`Auto-archived ${autoArchived} done tasks (>24h)`)
  maintenanceTimers.push(setInterval(() => {
    const count = autoArchiveDoneTasks()
    if (count > 0) log.info(`Auto-archive: moved ${count} done tasks to archived`)
  }, 60 * 60 * 1000))

  // Hard-delete old completed tasks on startup + every 6 hours
  const taskSettings = ctx.getSettings<{ autoArchiveDays?: number }>()
  if (taskSettings?.autoArchiveDays && taskSettings.autoArchiveDays > 0) {
    const days = taskSettings.autoArchiveDays
    const deleted = archiveOldTasks(days)
    if (deleted > 0) log.info(`Deleted ${deleted} old tasks (>${days} days)`)
    maintenanceTimers.push(setInterval(() => {
      const count = archiveOldTasks(days)
      if (count > 0) log.info(`Periodic cleanup: deleted ${count} old tasks`)
    }, 6 * 60 * 60 * 1000))
  }
}
