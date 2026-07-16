/**
 * Tasks plugin — server entry point.
 * Registers API routes (declarative) and MCP exec tools for task operations.
 */
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { readTaskboard, getTask } from '../../src/core/task-store'
import { createLogger } from '../../src/core/logger'
import { getContentDir } from '../../packages/core/src/content-dir'
import {
  checkSessionDeathIncidents,
  checkTaskboard,
  checkTaskConsistency,
  checkTaskPositionIntegrity,
  taskConsistencyRepair,
  taskOrderRepair,
} from './lib/health-checks'
import { queryAuditEvents } from '../../src/core/audit'
import type { Task, ColumnId } from './types'
import { tasksRoutes } from './lib/routes'
import { taskToSearchDoc } from './lib/search-doc'
import { registerTaskExecTools } from './lib/exec-tools'
import { listScheduledTaskEvents, rescheduleTaskEvent } from './lib/scheduled-events'
import { startMaintenance, stopMaintenance } from './lib/maintenance'
import type { ScheduledEventsQuery, ScheduledEventReschedule } from '@makinbakin/sdk'

const log = createLogger('tasks')

// ─── Plugin definition ───────────────────────────────────────────────────

const tasksPlugin: BakinPlugin = definePlugin({
  id: 'tasks',
  name: 'Tasks',
  version: '2.1.0',
  routes: tasksRoutes,

  settingsSchema: {
    fields: [
      { key: 'defaultColumn', type: 'select', label: 'Default column', description: 'Which column new tasks are created in', options: [{ value: 'backlog', label: 'Backlog' }, { value: 'todo', label: 'Todo' }], default: 'todo' },
      { key: 'showCompleted', type: 'boolean', label: 'Show completed tasks', description: 'Show tasks in the Done and Archived columns by default', default: true },
      { key: 'autoArchiveDays', type: 'number', label: 'Auto-archive after (days)', description: 'Move completed tasks to archive after this many days. 0 to disable.', default: 0 },
      { key: 'maxInProgress', type: 'number', label: 'Max in-progress tasks', description: 'Warn when more than this many tasks are in progress', default: 5 },
    ],
  },

  navItems: [
    { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
  ],

  activate(ctx: PluginContext) {
    // ─── Scheduled domain events (#191) ────────────────────────────────
    // Waiting (availableAt) and due (dueAt) tasks appear on the Schedule
    // calendars via the scheduledEvents contract; rescheduleEvent is the one
    // sanctioned mutation (moves the underlying date).
    ctx.hooks.register(
      'tasks.scheduledEvents',
      (data: ScheduledEventsQuery) => listScheduledTaskEvents(data),
      { hookKind: 'rpc', label: 'Scheduled task events', summary: 'Waiting/due tasks as read-only calendar events' },
    )
    ctx.hooks.register(
      'tasks.rescheduleEvent',
      (data: ScheduledEventReschedule) => rescheduleTaskEvent(data),
      { hookKind: 'rpc', label: 'Reschedule a task event', summary: "Move a task's availableAt/dueAt from the calendar" },
    )

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'tasks',
      // v2: brand_id keyword + facet (#419) — blue/green migrates in the background.
      schemaVersion: 2,
      schema: {
        title: { type: 'text' },
        description: { type: 'text' },
        agent: { type: 'keyword' },
        created_by: { type: 'keyword' },
        status: { type: 'keyword' },
        project_id: { type: 'keyword' },
        brand_id: { type: 'keyword' },
        workflow_id: { type: 'keyword' },
        source_plugin_id: { type: 'keyword' },
        source_entity_type: { type: 'keyword' },
        source_entity_id: { type: 'keyword' },
        source_purpose: { type: 'keyword' },
        available_at: { type: 'datetime' },
        due_at: { type: 'datetime' },
        log_text: { type: 'text' },
        blocked_reason: { type: 'text' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'description', 'log_text', 'blocked_reason'],
      rerankField: 'description',
      embeddingTemplate: '{{title}} {{description}} {{log_text}}',
      facets: ['status', 'agent', 'created_by', 'project_id', 'brand_id', 'source_plugin_id', 'source_entity_type'],
      chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
      reindex: async function* () {
        const board = readTaskboard()
        const columns = board.columns as unknown as Record<string, Task[]>
        for (const [colName, tasks] of Object.entries(columns)) {
          for (const task of tasks) {
            yield { key: task.id, doc: taskToSearchDoc(task, colName as ColumnId) }
          }
        }
      },
      verifyExists: async (key: string) => {
        return getTask(key) !== null
      },
    })

    // ─── MCP exec tools + background maintenance ──────────────────────
    registerTaskExecTools(ctx)
    startMaintenance(ctx)

    // ─── Health checks (migrated out of core/doctor.ts per #139 C2) ─────
    ctx.registerHealthCheck({
      id: 'taskboard',
      name: 'Taskboard SQLite reachability',
      run: () => Promise.resolve(checkTaskboard()),
    })
    ctx.registerHealthCheck({
      id: 'task-consistency',
      name: 'Task consistency (orphans, overload, stale in-progress)',
      run: () => checkTaskConsistency(getContentDir(), ctx.runtime.agents),
      repair: taskConsistencyRepair(),
    })
    ctx.registerHealthCheck({
      id: 'order-integrity',
      name: 'Task position / order integrity',
      run: () => Promise.resolve(checkTaskPositionIntegrity()),
      repair: taskOrderRepair(),
    })
    ctx.registerHealthCheck({
      id: 'session-death-incidents',
      name: 'Runtime session deaths (last 24h)',
      run: () => Promise.resolve(checkSessionDeathIncidents(getContentDir(), queryAuditEvents)),
    })
  },

  async onReady() {
    try {
      const board = await readTaskboard()
      if (board) {
        const columns = board.columns as unknown as Record<string, unknown[]>
        const counts = Object.entries(columns).map(([col, tasks]) => `${col}: ${tasks.length}`).join(', ')
        log.info(`Ready — ${counts}`)
      }
    } catch (err) {
      log.error('Failed to read task board on ready', err)
    }
  },

  onShutdown() {
    stopMaintenance()
    log.info('Shutting down tasks plugin')
  },
})

export default tasksPlugin
