/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import { totalmem } from 'os'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { usageByAgentSince, usageByDaySince, usageByAgentDaySince, toLocalDayKey } from '@bakin/core/usage-history/store'
import { listLiveRuns } from '../../src/core/execution-ledger'
import { buildAgentBurnReports } from '../../src/core/agent-burn'
import { getLastResults, runDiagnostics } from '../../src/core/doctor'
import { createLogger } from '../../src/core/logger'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import { startUsageHistoryTimer, stopUsageHistoryTimer, getLastUsageScan, DEFAULT_SCAN_MINUTES } from './lib/usage-history-timer'
import { DoctorRepairRequestNotFoundError } from '../../src/core/doctor-repair-store'
import { getContentDir } from '../../src/core/content-dir'
import { applyDoctorRepair, planDoctorRepair } from '../../src/core/doctor-repair'
import { delegateDoctorRepair, verifyDoctorRepairRequest } from '../../src/core/doctor-delegate'
import { getDoctorRepairRequest, listDoctorRepairRequests } from '../../src/core/doctor-repair-store'
import { getUsageFeed, getErrorCount, getStatsByMs, WINDOW_MS, type UsageKind, type WindowKey } from '../../src/core/usage'
import {
  listHealthChecks,
  getHealthCheck,
  type HealthCheckDef,
} from '../../src/core/health-check-registry'
import { checkContentDir } from './lib/system-checks/content-dir'
import { checkService } from './lib/system-checks/service'
import { checkRuntime } from './lib/system-checks/runtime'
import { checkSessionStore } from './lib/system-checks/session-store'
import { checkChannelApprovals } from './lib/system-checks/channel-approvals'
import { checkChannelAliases } from './lib/system-checks/channel-aliases'
import { checkRestartRecovery } from './lib/system-checks/restart-recovery'
import { checkExecutionSafety } from './lib/system-checks/execution-safety'
import { checkStartupContextSize } from './lib/system-checks/context-report'
import { checkBudget } from './lib/system-checks/budget'
import { checkAgentBurn } from './lib/system-checks/agent-burn'
import { checkSearchAdapter } from './lib/system-checks/search'
import { checkSearchOutbox, searchOutboxRepair } from './lib/system-checks/search-outbox'
import { checkSearchConsistency, searchConsistencyRepair } from './lib/system-checks/search-consistency'
import { checkAndSyncSkill, syncSkillRepair } from './lib/system-checks/sync-skill'
import { checkPluginAssets } from './lib/system-checks/plugin-assets'
import { checkPluginArtifacts } from './lib/system-checks/plugin-artifacts'

type RegistryAccessor = () => Array<Record<string, unknown>>
type McpSessionsAccessor = () => { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string }

function getRegistrySnapshot() {
  const fn = (globalThis as unknown as { __bakinGetRegistrySnapshot?: RegistryAccessor }).__bakinGetRegistrySnapshot
  return fn ? fn() : []
}

function getMcpSessions(): { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string } {
  const fn = (globalThis as unknown as { __bakinGetMcpSessions?: McpSessionsAccessor }).__bakinGetMcpSessions
  return fn ? fn() : { activeSessions: [], upSince: new Date().toISOString() }
}

const log = createLogger('health')

const stripRun = (def: HealthCheckDef) => ({
  id: def.id,
  name: def.name,
  pluginId: def.pluginId,
  autoFix: !!def.repair || !!def.autoFix,
})

function buildDoctorResponse(results: Array<{ status: string }> & unknown[]) {
  const errors = results.filter(r => r.status === 'error').length
  const warnings = results.filter(r => r.status === 'warn').length
  return { results, summary: { total: results.length, errors, warnings } }
}

function checkPluginRegistry() {
  const failed = getRegistrySnapshot().filter(plugin => plugin.status === 'failed')
  if (failed.length === 0) {
    return [{
      check: 'plugin-registry',
      status: 'ok' as const,
      message: 'All plugins activated',
      autoFixable: false,
    }]
  }

  return failed.map(plugin => {
    const id = String(plugin.id ?? 'unknown')
    const code = typeof plugin.errorCode === 'string' ? plugin.errorCode : 'activation_failed'
    const message = typeof plugin.errorMessage === 'string' && plugin.errorMessage.length > 0
      ? plugin.errorMessage
      : 'No failure details recorded'
    return {
      check: `plugin-registry:${id}`,
      status: 'error' as const,
      message: `${id} failed (${code}): ${message}`,
      autoFixable: false,
    }
  })
}

// ─── Schemas ─────────────────────────────────────────────────────────────

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()

const checksResponse = z.object({
  checks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    pluginId: z.string().optional(),
    autoFix: z.boolean(),
  })),
})

const summaryResponse = z.object({
  doctor: z.unknown().nullable(),
  errors1h: z.unknown(),  // recorder returns { total, byKind } — keep loose
  activeSessions: z.array(z.unknown()),
  upSince: z.string(),
  server: z.object({
    port: z.number(),
    pid: z.number(),
    nodeVersion: z.string(),
    memoryMB: z.number(),
    totalMemoryMB: z.number(),
  }),
})

const usageFeedQuery = z.object({
  kind: z.enum(['mcp', 'rest', 'agent']).optional(),
  window: z.enum(['5m', '1h', '24h']).default('1h'),
  agent: z.string().min(1).optional(),
})

const usageHistoryQuery = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
})

const agentEffortQuery = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
})

const AGENT_EFFORT_WINDOW_HOURS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
}

const USAGE_HISTORY_WINDOW_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const doctorQuery = z.object({
  fresh: z.union([z.literal('true'), z.literal('false')]).optional(),
  notifyAgent: z.union([z.literal('true'), z.literal('false')]).optional(),
})

const doctorResponse = z.object({
  results: z.array(passthrough),
  summary: z.object({
    total: z.number(),
    errors: z.number(),
    warnings: z.number(),
  }),
  cachedAt: z.string().optional(),
})

const doctorRepairApplyBody = z.object({
  accepted: z.boolean(),
  itemIds: z.array(z.string()).optional(),
  allowDestructive: z.boolean().optional(),
})

const acceptedBody = z.object({
  accepted: z.boolean(),
})

const repairRequestParams = z.object({
  requestId: z.string().min(1),
})

const searchStatusResponse = z.object({
  enabled: z.boolean(),
  tables: z.array(passthrough),
}).passthrough()

const registryResponse = z.object({
  plugins: z.array(passthrough),
})

// ─── Routes (declarative) ────────────────────────────────────────────────

const routes = [
  defineRoute({
    path: '/checks',
    method: 'GET',
    summary: 'List registered plugin health checks',
    description: 'Returns metadata only; does not execute the checks.',
    responses: { 200: checksResponse },
    handler: async () => {
      return Response.json({ checks: listHealthChecks().map(stripRun) })
    },
  }),

  defineRoute({
    path: '/summary',
    method: 'GET',
    summary: 'Aggregated health summary',
    description: 'Snapshot of doctor cache, recent error counts, MCP sessions, and host process metrics.',
    responses: { 200: summaryResponse },
    handler: async () => {
      const port = process.env.PORT || 3737
      const cached = getLastResults()
      const doctor = cached ? {
        results: cached.results,
        summary: {
          total: cached.results.length,
          errors: cached.results.filter(r => r.status === 'error').length,
          warnings: cached.results.filter(r => r.status === 'warn').length,
        },
        cachedAt: new Date(cached.timestamp).toISOString(),
      } : null
      const mcp = getMcpSessions()
      const errors1h = getErrorCount(WINDOW_MS['1h'])
      return Response.json({
        doctor,
        errors1h,
        activeSessions: mcp.activeSessions,
        upSince: mcp.upSince,
        server: {
          port: Number(port),
          pid: process.pid,
          nodeVersion: process.version,
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
        },
      })
    },
  }),

  defineRoute({
    path: '/usage-feed',
    method: 'GET',
    summary: 'Unified usage feed',
    description: 'Backs the tabbed usage section on the health page. Filters by kind, time window, and agent.',
    query: usageFeedQuery,
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const { kind, window, agent } = query
      return Response.json(getUsageFeed({
        ...(kind ? { kind: kind as UsageKind } : {}),
        window: window as WindowKey,
        ...(agent ? { agent } : {}),
      }))
    },
  }),

  defineRoute({
    path: '/search-status',
    method: 'GET',
    summary: 'Search adapter health',
    description: 'Returns search adapter readiness and per-table index stats.',
    responses: { 200: searchStatusResponse },
    handler: async (_req, ctx) => {
      const health = ctx.search.health ? await ctx.search.health() : { enabled: false, tables: [] }
      return Response.json(health)
    },
  }),

  defineRoute({
    path: '/search-telemetry',
    method: 'GET',
    summary: 'Search activity telemetry',
    description: 'Query/drain/enrichment activity from the shared usage recorder, outbox depth, and the latest search doctor rows.',
    responses: { 200: passthrough },
    handler: async () => {
      const { getUsageFeed } = await import('../../src/core/usage')
      const { outboxStats } = await import('../../src/core/search-outbox')

      const byName = (window: '1h' | '24h') => {
        const feed = getUsageFeed({ kind: 'rest', window })
        const pick = (name: string) => {
          const row = feed.topByName.find((r) => r.name === name)
          return { count: row?.count ?? 0, errors: row?.errors ?? 0, medianMs: row?.medianDurationMs ?? null }
        }
        return {
          query: pick('search.query'),
          drain: pick('search.drain'),
          enrich: pick('assets.enrich'),
        }
      }

      let enrichment: unknown = null
      try {
        const { getHookRegistry } = await import('../../packages/core/src/hooks/hook-registry-singleton')
        enrichment = await getHookRegistry().invoke('assets.enrichmentStats', {})
      } catch { /* assets plugin absent or hook unregistered */ }

      const doctor = getLastResults()
      const searchRows = (doctor?.results ?? []).filter((row) =>
        row.check === 'search' || row.check === 'search-outbox' || row.check === 'search-consistency')

      return Response.json({
        windows: { '1h': byName('1h'), '24h': byName('24h') },
        outbox: outboxStats(),
        enrichment,
        doctor: { rows: searchRows, at: doctor ? new Date(doctor.timestamp).toISOString() : null },
      })
    },
  }),

  defineRoute({
    path: '/usage',
    method: 'GET',
    summary: 'Agent context/token usage',
    description: 'Returns token + context usage per agent from runtime sessions.',
    responses: { 200: z.array(passthrough) },
    handler: async (_req, ctx) => {
      return Response.json(await getAllAgentUsage(ctx.runtime))
    },
  }),

  defineRoute({
    path: '/usage-history',
    method: 'GET',
    summary: 'Historical agent token usage',
    description: 'Durable per-agent and per-day token rollups from the usage-history store. Windows are day-aligned: a window includes every local calendar day it touches. Cost is runtime-reported only.',
    query: usageHistoryQuery,
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const windowMs = USAGE_HISTORY_WINDOW_MS[query.window]
      const since = toLocalDayKey(Date.now() - windowMs)
      const lastScan = getLastUsageScan()
      return Response.json({
        window: query.window,
        since,
        scannedAt: lastScan ? new Date(lastScan.at).toISOString() : null,
        byAgent: usageByAgentSince(since),
        byDay: usageByDaySince(since),
        byAgentDay: usageByAgentDaySince(since),
      })
    },
  }),

  defineRoute({
    path: '/live-now',
    method: 'GET',
    summary: 'In-flight dispatch runs',
    description: 'Every currently-running dispatch run across all agents (execution ledger), with running-for and heartbeat age. The honest answer to "is anything running right now".',
    responses: { 200: passthrough },
    handler: async (_req, ctx) => {
      const now = Date.now()
      const runs = await Promise.all(listLiveRuns().map(async (run) => {
        let taskTitle: string | null = null
        try {
          taskTitle = (await ctx.tasks.get(run.taskId))?.title ?? null
        } catch { /* task purged mid-flight — the run row still deserves display */ }
        return {
          agent: run.agent,
          taskId: run.taskId,
          taskTitle,
          runId: run.runId,
          startedAt: run.startedAt,
          runningForMs: Math.max(0, now - run.startedAt),
          heartbeatAgeMs: Math.max(0, now - run.heartbeatAt),
        }
      }))
      return Response.json({ runs, generatedAt: new Date(now).toISOString() })
    },
  }),

  defineRoute({
    path: '/agent-effort',
    method: 'GET',
    summary: 'Per-agent effort vs outcome',
    description: 'Token burn per agent joined with task completions and transcript-observed totals (Bakin-attributed vs total observed vs unattributed), plus warn-only burn flags. Same engine as the usage.agent-burn doctor check.',
    query: agentEffortQuery,
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const lastScan = getLastUsageScan()
      const agents = buildAgentBurnReports(Date.now(), { windowHours: AGENT_EFFORT_WINDOW_HOURS[query.window] })
      return Response.json({
        window: query.window,
        scannedAt: lastScan ? new Date(lastScan.at).toISOString() : null,
        agents,
      })
    },
  }),

  defineRoute({
    path: '/registry',
    method: 'GET',
    summary: 'List registered plugins',
    description: 'Returns the plugin registry snapshot — installed plugin metadata and route counts.',
    responses: { 200: registryResponse },
    handler: async () => {
      return Response.json({ plugins: getRegistrySnapshot() })
    },
  }),

  defineRoute({
    path: '/doctor',
    method: 'GET',
    summary: 'Run system diagnostics',
    description: 'Returns cached doctor results by default; pass ?fresh=true to force a fresh run.',
    query: doctorQuery,
    responses: { 200: doctorResponse, 500: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const fresh = query.fresh === 'true'
      if (!fresh) {
        const cached = getLastResults()
        if (cached) {
          return Response.json({
            ...buildDoctorResponse(cached.results),
            cachedAt: new Date(cached.timestamp).toISOString(),
          })
        }
      }
      try {
        const results = await runDiagnostics(getContentDir(), process.cwd(), {
          notifyAgent: query.notifyAgent === 'true',
        })
        return Response.json({
          ...buildDoctorResponse(results),
          cachedAt: new Date().toISOString(),
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/repair/plan',
    method: 'GET',
    summary: 'Plan deterministic doctor repairs',
    description: 'Runs diagnostics and returns safe/manual repair plan items without mutating state.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async () => {
      try {
        const report = await planDoctorRepair({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
        })
        return Response.json(report)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/repair/apply',
    method: 'POST',
    summary: 'Apply deterministic doctor repairs',
    description: 'Applies safe repair plan items only after accepted=true, then reruns affected checks for verification.',
    body: doctorRepairApplyBody,
    responses: { 200: passthrough, 409: passthrough, 500: errorResponse },
    handler: async (_req, _ctx, { body }) => {
      try {
        const report = await applyDoctorRepair({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
          accepted: body.accepted,
          itemIds: body.itemIds,
          allowDestructive: body.allowDestructive,
        })
        return Response.json(report, {
          status: report.status === 'confirmation_required' ? 409 : 200,
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/delegate',
    method: 'POST',
    summary: 'Create a delegated doctor repair task',
    description: 'Plans unresolved doctor findings and, after accepted=true, creates a linked task assigned to the runtime main agent and kicks dispatch.',
    body: acceptedBody,
    responses: { 200: passthrough, 409: passthrough, 500: errorResponse },
    handler: async (_req, _ctx, { body }) => {
      try {
        const report = await delegateDoctorRepair({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
          accepted: body.accepted,
        })
        return Response.json(report, {
          status: report.status === 'confirmation_required' ? 409 : 200,
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/repair',
    method: 'GET',
    summary: 'List doctor repair requests',
    description: 'Returns durable delegated doctor repair requests.',
    responses: { 200: passthrough },
    handler: async () => Response.json({ requests: listDoctorRepairRequests(getContentDir()) }),
  }),

  defineRoute({
    path: '/doctor/repair/:requestId',
    method: 'GET',
    summary: 'Show a doctor repair request',
    description: 'Returns one durable doctor repair request by id.',
    params: repairRequestParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const request = getDoctorRepairRequest(getContentDir(), params.requestId)
      if (!request) return Response.json({ error: 'Doctor repair request not found' }, { status: 404 })
      return Response.json({ request })
    },
  }),

  defineRoute({
    path: '/doctor/repair/:requestId/verify',
    method: 'POST',
    summary: 'Verify a doctor repair request',
    description: 'Reruns doctor planning and records whether the original delegated findings still reproduce.',
    params: repairRequestParams,
    responses: { 200: passthrough, 404: errorResponse, 500: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      try {
        return Response.json(await verifyDoctorRepairRequest({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
          requestId: params.requestId,
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = err instanceof DoctorRepairRequestNotFoundError ? 404 : 500
        return Response.json({ error: message }, { status })
      }
    },
  }),
]

const healthPlugin: BakinPlugin = definePlugin({
  id: 'health',
  name: 'Health',
  version: '1.0.0',
  routes,

  settingsSchema: {
    fields: [
      { key: 'refreshInterval', type: 'number', label: 'Refresh interval (seconds)', description: 'How often to poll for updated metrics', default: 30 },
      { key: 'showDetailedMetrics', type: 'boolean', label: 'Detailed metrics', description: 'Show per-plugin and per-tool breakdowns', default: true },
      { key: 'usageHistoryScanMinutes', type: 'number', label: 'Usage history scan interval (minutes)', description: 'How often session transcripts are swept into the durable usage history', default: 5 },
    ],
  },

  navItems: [
    { id: 'health', label: 'Health', icon: 'Activity', href: '/health', order: 85 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // ─── Usage-history scan timer (#359) ─────────────────────────────
    // First sweep runs one full interval after activation — boot does
    // zero scan work. onShutdown stops it (hot-reload safe).
    const settings = ctx.getSettings<{ usageHistoryScanMinutes?: number }>()
    startUsageHistoryTimer(ctx.runtime, settings.usageHistoryScanMinutes ?? DEFAULT_SCAN_MINUTES)

    // ─── Health-check registry hooks ─────────────────────────────────
    // `run` is not serializable and isn't useful to consumers that only
    // want registry metadata. Strip it at the boundary.
    ctx.hooks.register('health.list', () => listHealthChecks().map(stripRun), { label: 'List health checks.', summary: 'Returns the health checks registered by core and plugins without executing them. Use it when another surface needs to show the available diagnostics or autofix support.', hookKind: 'rpc' })
    ctx.hooks.register('health.getCheck', (d: Record<string, unknown>) => {
      const def = getHealthCheck(d.id as string)
      return def ? stripRun(def) : null
    }, { label: 'Get a health check.', summary: 'Returns metadata for one registered health check by id, without running the check. Use it when a plugin needs the check name, owner, and autofix capability before deciding what to show or run.', hookKind: 'rpc' })

    // --- Exec tools (MCP) ---

    ctx.registerExecTool({
      name: 'bakin_exec_health_status',
      label: 'Checked system health',
      description: 'Get a quick system health summary — uptime, memory, active MCP sessions, and doctor error/warning counts. Useful for checking system state before starting work.',
      parameters: {},
      handler: async () => {
        const cached = getLastResults()
        const mcp = getMcpSessions()
        const stats1h = getStatsByMs({ windowMs: WINDOW_MS['1h'] })

        const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024)
        const totalMemoryMB = Math.round(totalmem() / 1024 / 1024)

        return {
          ok: true,
          uptime: mcp.upSince,
          memoryMB,
          totalMemoryMB,
          memoryPercent: Math.round((memoryMB / totalMemoryMB) * 100),
          activeSessions: mcp.activeSessions.length,
          calls1h: stats1h.total,
          errors1h: stats1h.errors,
          doctorErrors: cached ? cached.results.filter(r => r.status === 'error').length : null,
          doctorWarnings: cached ? cached.results.filter(r => r.status === 'warn').length : null,
          doctorLastRun: cached ? new Date(cached.timestamp).toISOString() : null,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_health_doctor',
      label: 'Ran diagnostics',
      description: 'Run system diagnostics (agent roster, skill sync, runtime, taskboard, assets, etc.). Returns detailed check results. Use fresh=true to force a full re-check instead of returning cached results.',
      parameters: {
        fresh: z.boolean().optional().describe('Force fresh diagnostics instead of cached results'),
      },
      handler: async (params: Record<string, unknown>) => {
        const fresh = params.fresh === true

        if (!fresh) {
          const cached = getLastResults()
          if (cached) {
            return {
              ok: true,
              ...buildDoctorResponse(cached.results),
              cachedAt: new Date(cached.timestamp).toISOString(),
            }
          }
        }

        try {
          const results = await runDiagnostics(getContentDir(), process.cwd())
          return { ok: true, ...buildDoctorResponse(results), cachedAt: new Date().toISOString() }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    // ─── System health checks (migrated out of core/doctor.ts per #139 C6+) ──
    ctx.registerHealthCheck({
      id: 'content-dir',
      name: 'Content directory location',
      run: () => Promise.resolve(checkContentDir()),
    })
    ctx.registerHealthCheck({
      id: 'service',
      name: 'macOS LaunchAgent plist',
      run: () => Promise.resolve(checkService(process.cwd())),
    })
    ctx.registerHealthCheck({
      id: 'runtime',
      name: 'Runtime reachability',
      run: () => checkRuntime(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'session-store',
      name: 'Runtime session-store growth',
      run: () => checkSessionStore(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'channel-approvals',
      name: 'Runtime channel approval responses',
      run: () => checkChannelApprovals(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'channel-aliases',
      name: 'Runtime channel aliases',
      run: () => checkChannelAliases(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'restart-recovery',
      name: 'Restart recovery candidates',
      run: () => checkRestartRecovery(),
    })
    ctx.registerHealthCheck({
      id: 'execution-safety',
      name: 'Duplicate-execution suppression + ledger health',
      run: () => checkExecutionSafety(),
    })
    ctx.registerHealthCheck({
      id: 'context.startup-size',
      name: 'Per-dispatch startup context budget',
      run: () => checkStartupContextSize(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'budget',
      name: 'Spend vs budget caps',
      run: () => checkBudget(),
    })
    ctx.registerHealthCheck({
      id: 'usage.agent-burn',
      name: 'Agent token burn (effort, spikes, unattributed)',
      run: () => checkAgentBurn(),
    })
    ctx.registerHealthCheck({
      id: 'search',
      name: 'Search engine binary, supervision + connection',
      run: () => checkSearchAdapter(),
    })
    ctx.registerHealthCheck({
      id: 'search-outbox',
      name: 'Search write journal (outbox) drain state',
      run: () => checkSearchOutbox(),
      repair: searchOutboxRepair(),
    })
    ctx.registerHealthCheck({
      id: 'search-consistency',
      name: 'Search table consistency + deep sweep',
      run: () => checkSearchConsistency(),
      repair: searchConsistencyRepair(),
    })
    ctx.registerHealthCheck({
      id: 'skill',
      name: 'Bakin SKILL.md sync to runtime',
      run: () => checkAndSyncSkill(process.cwd(), ctx.runtime),
      repair: syncSkillRepair(process.cwd(), ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'plugin-assets',
      name: 'Plugin-shipped runtime skills install state',
      run: () => checkPluginAssets(),
    })
    ctx.registerHealthCheck({
      id: 'plugin-artifacts',
      name: 'Installed plugin artifact compatibility',
      run: () => Promise.resolve(checkPluginArtifacts()),
    })
    ctx.registerHealthCheck({
      id: 'plugin-registry',
      name: 'Plugin activation state',
      run: () => Promise.resolve(checkPluginRegistry()),
    })
  },

  onShutdown() {
    stopUsageHistoryTimer()
  },

  onReady() {
    const cached = getLastResults()
    if (cached) {
      const errors = cached.results.filter(r => r.status === 'error').length
      const warns = cached.results.filter(r => r.status === 'warn').length
      log.info(`Ready — baseline: ${errors} errors, ${warns} warnings from ${cached.results.length} checks`)
    } else {
      log.info('Ready — no cached doctor results yet')
    }
  },
})

export default healthPlugin
