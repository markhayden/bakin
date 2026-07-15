/**
 * Health plugin — server entry point.
 * Aggregates MCP stats, doctor diagnostics, request logs, and system info.
 */
import { totalmem } from 'os'
import { z } from 'zod'
import type { BakinPlugin, HealthRepairTarget, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { usageByAgentSince, usageByDaySince, usageByAgentDaySince, toLocalDayKey } from '@bakin/core/usage-history/store'
import { listLiveRuns } from '../../src/core/execution-ledger'
import { buildAgentBurnReports } from '../../src/core/agent-burn'
import { getLastReport, runDiagnostics, runTargetedDiagnostics } from '../../src/core/doctor'
import { createLogger } from '../../src/core/logger'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import { startUsageHistoryTimer, stopUsageHistoryTimer, getLastUsageScan, DEFAULT_SCAN_MINUTES } from './lib/usage-history-timer'
import { DoctorRepairRequestNotFoundError } from '../../src/core/doctor-repair-store'
import { getContentDir } from '../../src/core/content-dir'
import { applyDoctorRepair, planDoctorRepair } from '../../src/core/doctor-repair'
import { HealthContractError } from '../../src/core/health-contract'
import {
  DoctorRepairConfirmationError,
  DoctorRepairStalePlanError,
} from '../../src/core/doctor-repair-plans'
import { delegateDoctorRepair, verifyDoctorRepairRequest } from '../../src/core/doctor-delegate'
import { getDoctorRepairRequest, listDoctorRepairRequests } from '../../src/core/doctor-repair-store'
import {
  DEFAULT_FAILURE_GROUP_LIMIT,
  MAX_USAGE_AGENT_ROWS,
  MAX_FAILURE_GROUP_LIMIT,
  getInteractionSummary,
  getUsageFeed,
  getErrorCount,
  getStatsByMs,
  WINDOW_MS,
  type UsageKind,
  type WindowKey,
} from '../../src/core/usage'
import {
  listHealthChecks,
  getHealthCheck,
  type HealthCheckDef,
} from '../../src/core/health-check-registry'
import { checkContentDir } from './lib/system-checks/content-dir'
import { checkCapabilities } from './lib/system-checks/capabilities'
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
import { searchOutboxRepair } from './lib/system-checks/search-outbox'
import { checkSearchConsistency, searchConsistencyRepair } from './lib/system-checks/search-consistency'
import { checkSearchSpin, searchSpinRepair } from './lib/system-checks/search-spin'
import { checkSearchCanary, checkSearchEngineBurn, searchCanaryRepair, searchEngineBurnRepair } from './lib/system-checks/search-engine-watch'
import { checkAndSyncSkill, syncSkillRepair } from './lib/system-checks/sync-skill'
import { checkPluginAssets } from './lib/system-checks/plugin-assets'
import { checkPluginArtifacts } from './lib/system-checks/plugin-artifacts'
import { checkPluginRegistry } from './lib/system-checks/plugin-registry'
import {
  healthChecksResponseSchema,
  healthErrorResponseSchema,
  healthLiveSummarySchema,
  healthRepairApplyReportSchema,
  healthRepairApplyRequestSchema,
  healthRepairPlanRequestSchema,
  healthRepairPlanSchema,
  healthRepairTargetSchema,
  healthReportSchema,
  searchReadinessResponseSchema,
} from './lib/route-schemas'

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
  localId: def.localId,
  name: def.name,
  description: def.description,
  owner: def.owner,
  group: def.group,
  ...(def.maxAgeMs === undefined ? {} : { maxAgeMs: def.maxAgeMs }),
})

// ─── Schemas ─────────────────────────────────────────────────────────────

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()

const usageFeedQuery = z.object({
  kind: z.enum(['mcp', 'rest', 'agent']).optional(),
  window: z.enum(['5m', '1h', '24h']).default('1h'),
  agent: z.string().min(1).optional(),
  includeRoutine: z.enum(['true', 'false']).default('false'),
  failureGroupOffset: z.coerce.number().int().nonnegative().default(0),
  failureGroupLimit: z.coerce.number().int().min(1).max(MAX_FAILURE_GROUP_LIMIT)
    .default(DEFAULT_FAILURE_GROUP_LIMIT),
  failureGroupTargetKind: z.enum(['mcp', 'rest', 'agent']).optional(),
  failureGroupTargetMethod: z.string().max(32).optional(),
  failureGroupTargetDestination: z.string().min(1).max(2_048).optional(),
}).strict().superRefine((query, ctx) => {
  const targetFields = [
    query.failureGroupTargetKind,
    query.failureGroupTargetMethod,
    query.failureGroupTargetDestination,
  ]
  const providedCount = targetFields.filter((field) => field !== undefined).length
  if (providedCount !== 0 && providedCount !== targetFields.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'failure group target fields must be provided together',
      path: ['failureGroupTargetKind'],
    })
  }
})

const interactionSummaryQuery = z.object({
  window: z.enum(['5m', '1h', '24h']).default('1h'),
}).strict()

const usageKindSchema = z.enum(['mcp', 'rest', 'agent'])
const activityClassSchema = z.enum(['user', 'system', 'routine'])
const interactionCategorySchema = z.enum(['tools', 'api', 'agents'])
const interactionTimeBucketSchema = z.object({
  start: z.string(),
  count: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  failureRate: z.number().min(0).max(1),
}).strict()
const interactionCoverageSchema = z.discriminatedUnion('reason', [
    z.object({
      startsAt: z.iso.datetime({ offset: true }),
      hasFullWindow: z.literal(true),
      reason: z.literal('full_window'),
    }).strict(),
    z.object({
      startsAt: z.iso.datetime({ offset: true }),
      hasFullWindow: z.literal(false),
      reason: z.literal('process_restart'),
    }).strict(),
    z.object({
      startsAt: z.iso.datetime({ offset: true }),
      hasFullWindow: z.literal(false),
      reason: z.literal('buffer_limit'),
    }).strict(),
  ])
const usageEntrySchema = z.object({
  id: z.string().min(1),
  ts: z.iso.datetime({ offset: true }),
  kind: usageKindSchema,
  activityClass: activityClassSchema,
  name: z.string(),
  agent: z.string().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  status: z.enum(['ok', 'error']),
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
  tokensCacheRead: z.number().nonnegative().optional(),
  tokensCacheWrite: z.number().nonnegative().optional(),
  costUsdMicros: z.number().nonnegative().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict()
const usageFeedResponseSchema = z.object({
  capabilities: z.object({
    exactFailureTargeting: z.literal(true),
    sourceBalancedActivity: z.literal(true),
  }).strict(),
  window: z.enum(['5m', '1h', '24h']),
  coverage: interactionCoverageSchema,
  totals: z.object({
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }).strict(),
  outcomes: z.object({
    failed: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
  }).strict(),
  byKind: z.array(z.object({
    kind: usageKindSchema,
    total: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
  }).strict()).length(3),
  failureGroups: z.array(z.object({
    kind: usageKindSchema,
    name: z.string(),
    destination: z.string(),
    method: z.string().min(1).nullable(),
    attempts: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    firstFailureAt: z.iso.datetime({ offset: true }),
    lastFailureAt: z.iso.datetime({ offset: true }),
    agents: z.array(z.string()),
    unattributedFailures: z.number().int().nonnegative(),
    systemFailures: z.number().int().nonnegative(),
    medianFailureDurationMs: z.number().nonnegative().nullable(),
    latestFailure: usageEntrySchema,
  }).strict()).max(MAX_FAILURE_GROUP_LIMIT),
  failureGroupPage: z.object({
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(MAX_FAILURE_GROUP_LIMIT),
    hasMore: z.boolean(),
  }).strict(),
  topByName: z.array(z.object({
    kind: usageKindSchema,
    method: z.string().min(1).nullable(),
    name: z.string(),
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    medianDurationMs: z.number().nonnegative().nullable(),
  }).strict()).max(10),
  agentCount: z.number().int().nonnegative(),
  byAgent: z.array(z.object({
    agent: z.string(),
    attributed: z.boolean(),
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    lastActivity: usageEntrySchema.nullable(),
  }).strict()).max(MAX_USAGE_AGENT_ROWS),
  recent: z.array(usageEntrySchema).max(50),
  recentFailures: z.array(usageEntrySchema).max(50),
  recentUnverified: z.array(usageEntrySchema).max(50),
  timeBuckets: z.array(interactionTimeBucketSchema),
}).strict().superRefine((data, ctx) => {
  const attributedRows = data.byAgent.filter((row) => row.attributed)
  const unattributedRows = data.byAgent.filter((row) => !row.attributed)
  const distinctAttributedAgents = new Set(attributedRows.map((row) => row.agent))
  if (data.agentCount > data.totals.count) {
    ctx.addIssue({ code: 'custom', path: ['agentCount'], message: 'agentCount cannot exceed total interactions' })
  }
  if (data.agentCount < distinctAttributedAgents.size) {
    ctx.addIssue({ code: 'custom', path: ['agentCount'], message: 'agentCount cannot be smaller than projected agents' })
  }
  if (attributedRows.length > 10 || distinctAttributedAgents.size !== attributedRows.length) {
    ctx.addIssue({ code: 'custom', path: ['byAgent'], message: 'attributed agent rows must be unique and bounded' })
  }
  if (unattributedRows.length > 1 || unattributedRows.some((row) => row.agent !== 'unknown')) {
    ctx.addIssue({ code: 'custom', path: ['byAgent'], message: 'the unattributed projection must use one unknown row at most' })
  }
})
const interactionSummaryResponseSchema = z.object({
  window: z.enum(['5m', '1h', '24h']),
  coverage: interactionCoverageSchema,
  totals: z.object({
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    foreground: z.number().int().nonnegative(),
    background: z.number().int().nonnegative(),
  }).strict(),
  categories: z.array(z.object({
    key: interactionCategorySchema,
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }).strict()).length(3),
  topDestinations: z.array(z.object({
    category: interactionCategorySchema,
    name: z.string(),
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    medianDurationMs: z.number().nonnegative().nullable(),
  }).strict()).max(10),
  timeBuckets: z.array(interactionTimeBucketSchema),
}).strict()

const usageHistoryQuery = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
}).strict()

const agentEffortQuery = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
}).strict()

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
}).strict()

const acceptedBody = z.object({
  accepted: z.boolean(),
  target: healthRepairTargetSchema.optional(),
}).strict()

const repairRequestParams = z.object({
  requestId: z.string().min(1),
}).strict()

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
    activityClass: 'routine',
    summary: 'List registered plugin health checks',
    description: 'Returns metadata only; does not execute the checks.',
    responses: { 200: healthChecksResponseSchema },
    handler: async () => {
      return Response.json({ checks: listHealthChecks().map(stripRun) })
    },
  }),

  defineRoute({
    path: '/summary',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Aggregated health summary',
    description: 'Live operational facts only: recent failures, MCP sessions, and host process metrics.',
    responses: { 200: healthLiveSummarySchema },
    handler: async () => {
      const port = process.env.PORT || 3737
      const mcp = getMcpSessions()
      const errors1h = getErrorCount(WINDOW_MS['1h'])
      return Response.json({
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
    activityClass: 'routine',
    summary: 'Unified usage feed',
    description: 'Backs failure-first Health Activity with kind, time-window, agent, and routine-success filtering.',
    query: usageFeedQuery,
    responses: { 200: usageFeedResponseSchema, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const {
        kind,
        window,
        agent,
        includeRoutine,
        failureGroupOffset,
        failureGroupLimit,
        failureGroupTargetKind,
        failureGroupTargetMethod,
        failureGroupTargetDestination,
      } = query
      return Response.json(getUsageFeed({
        ...(kind ? { kind: kind as UsageKind } : {}),
        window: window as WindowKey,
        ...(agent ? { agent } : {}),
        includeRoutine: includeRoutine === 'true',
        failureGroupOffset,
        failureGroupLimit,
        ...(failureGroupTargetKind !== undefined
          && failureGroupTargetMethod !== undefined
          && failureGroupTargetDestination !== undefined
          ? {
              failureGroupTarget: {
                kind: failureGroupTargetKind as UsageKind,
                method: failureGroupTargetMethod.trim().length > 0
                  ? failureGroupTargetMethod.trim().toUpperCase()
                  : null,
                destination: failureGroupTargetDestination,
              },
            }
          : {}),
      }))
    },
  }),

  defineRoute({
    path: '/interaction-summary',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Overview meaningful-interaction summary',
    description: 'Aggregates user and autonomous system activity into foreground/background volume, failures, result gaps, and destinations.',
    query: interactionSummaryQuery,
    responses: { 200: interactionSummaryResponseSchema, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      return Response.json(getInteractionSummary({ window: query.window as WindowKey }))
    },
  }),

  defineRoute({
    path: '/search-status',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Search adapter health',
    description: 'Returns search adapter readiness and per-table index stats.',
    responses: { 200: searchStatusResponse },
    handler: async (_req, ctx) => {
      const health = ctx.search.health ? await ctx.search.health() : { enabled: false, tables: [] }
      return Response.json(health)
    },
  }),

  defineRoute({
    path: '/search-readiness',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Refresh Search readiness',
    description: 'Refreshes the lightweight canonical Search source and returns the Search projection from the revised Health report.',
    responses: { 200: searchReadinessResponseSchema, 500: healthErrorResponseSchema },
    handler: async () => {
      try {
        const report = await runTargetedDiagnostics(['health.search'])
        return Response.json({ reportId: report.id, readiness: report.subsystems.search })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/search-telemetry',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Search activity telemetry',
    description: 'Query/drain/enrichment activity, journal depth, and canonical Search evidence from the current Health report.',
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

      const report = getLastReport()
      const searchObservations = report.observations.filter((row) => row.group.key === 'search')
      const searchIncidentIds = new Set(searchObservations.flatMap((row) => row.incidentId ? [row.incidentId] : []))

      return Response.json({
        windows: { '1h': byName('1h'), '24h': byName('24h') },
        outbox: outboxStats(),
        enrichment,
        reportId: report.id,
        readiness: report.subsystems.search,
        observations: searchObservations,
        incidents: report.incidents.filter((incident) => searchIncidentIds.has(incident.id)),
      })
    },
  }),

  defineRoute({
    path: '/usage',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Latest-session agent token traffic',
    description: 'Returns cumulative token traffic from each agent\'s newest runtime transcript; this is not context-window occupancy.',
    responses: { 200: z.array(passthrough) },
    handler: async (_req, ctx) => {
      return Response.json(await getAllAgentUsage(ctx.runtime))
    },
  }),

  defineRoute({
    path: '/usage-history',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Historical agent token usage',
    description: 'Durable per-agent and per-day token rollups from the usage-history store. Windows are day-aligned: a window includes every local calendar day it touches. Cost is runtime-reported only.',
    query: usageHistoryQuery,
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      const windowMs = USAGE_HISTORY_WINDOW_MS[query.window]
      const now = Date.now()
      const since = toLocalDayKey(now - windowMs)
      const lastScan = getLastUsageScan()
      return Response.json({
        window: query.window,
        since,
        throughDay: toLocalDayKey(now),
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
    activityClass: 'routine',
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
    activityClass: 'routine',
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
    activityClass: 'routine',
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
    activityClass: 'routine',
    summary: 'Run system diagnostics',
    description: 'Returns the canonical cached Health report by default; pass ?fresh=true to join or start a full sweep.',
    query: doctorQuery,
    responses: { 200: healthReportSchema, 500: healthErrorResponseSchema },
    handler: async (_req, _ctx, { query }) => {
      try {
        const report = query.fresh === 'true'
          ? await runDiagnostics(getContentDir(), process.cwd(), { notifyAgent: query.notifyAgent === 'true' })
          : getLastReport()
        return Response.json(report)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/repair/plan',
    method: 'POST',
    summary: 'Plan deterministic doctor repairs',
    description: 'Plans only the selected canonical incidents or observations without mutating state.',
    body: healthRepairPlanRequestSchema,
    responses: { 200: healthRepairPlanSchema, 500: healthErrorResponseSchema },
    handler: async (_req, _ctx, { body }) => {
      try {
        const plan = await planDoctorRepair({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
          target: body.target as HealthRepairTarget,
        })
        return Response.json(plan)
      } catch (err) {
        return Response.json({
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof HealthContractError ? { code: err.code } : {}),
        }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/doctor/repair/apply',
    method: 'POST',
    summary: 'Apply deterministic doctor repairs',
    description: 'Applies selected server-held plan items after validating freshness and individual non-safe confirmations, then verifies affected checks.',
    body: healthRepairApplyRequestSchema,
    responses: { 200: healthRepairApplyReportSchema, 409: healthErrorResponseSchema, 500: healthErrorResponseSchema },
    handler: async (_req, _ctx, { body }) => {
      try {
        const report = await applyDoctorRepair({
          contentDir: getContentDir(),
          projectRoot: process.cwd(),
          planId: body.planId,
          itemIds: body.itemIds,
          confirmedItemIds: body.confirmedItemIds,
        })
        return Response.json(report)
      } catch (err) {
        if (err instanceof DoctorRepairStalePlanError) {
          return Response.json({ error: err.message, code: err.code }, { status: 409 })
        }
        if (err instanceof DoctorRepairConfirmationError) {
          return Response.json({ error: err.message, code: err.code, itemIds: err.itemIds }, { status: 409 })
        }
        return Response.json({
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof HealthContractError ? { code: err.code } : {}),
        }, { status: 500 })
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
          ...(body.target ? { target: body.target as HealthRepairTarget } : {}),
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
    activityClass: 'routine',
    summary: 'List doctor repair requests',
    description: 'Returns durable delegated doctor repair requests.',
    responses: { 200: passthrough },
    handler: async () => Response.json({ requests: listDoctorRepairRequests(getContentDir()) }),
  }),

  defineRoute({
    path: '/doctor/repair/:requestId',
    method: 'GET',
    activityClass: 'routine',
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
  version: '1.4.0',
  routes,

  settingsSchema: {
    fields: [
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
    ctx.hooks.register('health.list', () => listHealthChecks().map(stripRun), { label: 'List health checks.', summary: 'Returns canonical metadata for registered Health checks without executing them.', hookKind: 'rpc' })
    ctx.hooks.register('health.getCheck', (d: Record<string, unknown>) => {
      const def = getHealthCheck(d.id as string)
      return def ? stripRun(def) : null
    }, { label: 'Get a health check.', summary: 'Returns canonical metadata for one registered Health check by stable id without executing it.', hookKind: 'rpc' })

    // --- Exec tools (MCP) ---

    ctx.registerExecTool({
      name: 'bakin_exec_health_status',
      label: 'Checked system health',
      description: 'Get a quick canonical system health summary with uptime, memory, connected session count, activity failures, and incident counts.',
      parameters: {},
      handler: async () => {
        const report = getLastReport()
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
          activeSessions: mcp.activeSessions.reduce((total, row) => total + row.sessions, 0),
          calls1h: stats1h.total,
          errors1h: stats1h.errors,
          overallStatus: report.overallStatus,
          reportId: report.id,
          reportGeneratedAt: report.generatedAt,
          incidents: report.summary.incidents,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_health_doctor',
      label: 'Ran diagnostics',
      description: 'Return the canonical Health report. Use fresh=true to join or start a full diagnostic sweep first.',
      parameters: {
        fresh: z.boolean().optional().describe('Force fresh diagnostics instead of cached results'),
      },
      handler: async (params: Record<string, unknown>) => {
        const fresh = params.fresh === true

        try {
          const report = fresh
            ? await runDiagnostics(getContentDir(), process.cwd())
            : getLastReport()
          return { ok: true, report }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    // ─── First-party Health producers ──────────────────────────────────────
    const systemGroup = { key: 'system', label: 'System' }
    const runtimeGroup = { key: 'runtime', label: 'Runtime' }
    const workGroup = { key: 'work-cost', label: 'Work & Cost' }
    const searchGroup = { key: 'search', label: 'Search' }
    const pluginsGroup = { key: 'plugins', label: 'Plugins' }

    ctx.registerHealthCheck({
      id: 'content-dir',
      name: 'Content directory location',
      description: 'Confirms where Bakin stores its local state.',
      group: systemGroup,
      maxAgeMs: 3_600_000,
      run: () => checkContentDir(),
    })
    ctx.registerHealthCheck({
      id: 'capabilities',
      name: 'Capability-pack readiness',
      description: 'Checks that installed capability packs have their required content and tools.',
      group: pluginsGroup,
      maxAgeMs: 900_000,
      run: () => checkCapabilities(),
    })
    ctx.registerHealthCheck({
      id: 'service',
      name: 'macOS LaunchAgent plist',
      description: 'Verifies the managed macOS background service is installed, current, and loaded.',
      group: systemGroup,
      maxAgeMs: 300_000,
      run: () => checkService(process.cwd()),
    })
    ctx.registerHealthCheck({
      id: 'runtime',
      name: 'Runtime reachability',
      description: 'Confirms the active agent runtime can serve turns.',
      group: runtimeGroup,
      maxAgeMs: 60_000,
      run: () => checkRuntime(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'session-store',
      name: 'Runtime session-store growth',
      description: 'Watches runtime session artifacts for excessive disk use and orphan growth.',
      group: runtimeGroup,
      maxAgeMs: 600_000,
      run: () => checkSessionStore(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'channel-approvals',
      name: 'Runtime channel approval responses',
      description: 'Checks whether runtime channels can return workflow approval decisions.',
      group: runtimeGroup,
      maxAgeMs: 300_000,
      run: () => checkChannelApprovals(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'channel-aliases',
      name: 'Runtime channel aliases',
      description: 'Validates configured channel aliases and the alert channel against the active runtime.',
      group: runtimeGroup,
      maxAgeMs: 300_000,
      run: () => checkChannelAliases(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'restart-recovery',
      name: 'Restart recovery candidates',
      description: 'Finds stale in-progress tasks that need automatic or manual restart recovery.',
      group: systemGroup,
      maxAgeMs: 120_000,
      run: () => checkRestartRecovery(),
    })
    ctx.registerHealthCheck({
      id: 'execution-safety',
      name: 'Duplicate-execution suppression + ledger health',
      description: 'Confirms the execution ledger is reachable and surfaces recently suppressed duplicate work.',
      group: systemGroup,
      maxAgeMs: 300_000,
      run: () => checkExecutionSafety(),
    })
    ctx.registerHealthCheck({
      id: 'context.startup-size',
      name: 'Per-dispatch startup context budget',
      description: 'Estimates each agent\'s injected startup context against the configured cost guardrail.',
      group: workGroup,
      maxAgeMs: 600_000,
      run: () => checkStartupContextSize(ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'budget',
      name: 'Spend vs budget caps',
      description: 'Evaluates spending policy, open holds, and current usage against every budget rule.',
      group: workGroup,
      maxAgeMs: 120_000,
      run: () => checkBudget(),
    })
    ctx.registerHealthCheck({
      id: 'usage.agent-burn',
      name: 'Agent token burn (effort, spikes, unattributed)',
      description: 'Flags unusually high, spiking, or unattributed agent token use.',
      group: workGroup,
      maxAgeMs: 600_000,
      run: () => checkAgentBurn(),
    })
    ctx.registerHealthCheck({
      id: 'search',
      name: 'Search engine and write journal',
      description: 'Checks Search enablement, engine installation and connectivity, supervision, and journal drain state.',
      group: searchGroup,
      maxAgeMs: 60_000,
      run: () => checkSearchAdapter(),
    })
    ctx.registerHealthCheck({
      id: 'search-consistency',
      name: 'Search table consistency + deep sweep',
      description: 'Verifies logical-to-physical index mappings and performs throttled orphan maintenance.',
      group: searchGroup,
      maxAgeMs: 300_000,
      run: () => checkSearchConsistency(),
    })
    ctx.registerHealthCheck({
      id: 'search-spin',
      name: 'Search backfill-spin watchdog (zero-progress building legs)',
      description: 'Detects index legs that remain building without queued work or measurable progress.',
      group: searchGroup,
      maxAgeMs: 300_000,
      run: () => checkSearchSpin(),
    })
    ctx.registerHealthCheck({
      id: 'search-canary',
      name: 'Search canary (a real query through the production path)',
      description: 'Runs a real cross-table query to verify Search serves production traffic, not only probes.',
      group: searchGroup,
      maxAgeMs: 120_000,
      run: () => checkSearchCanary(),
    })
    ctx.registerHealthCheck({
      id: 'search-engine-burn',
      name: 'Search engine burn watchdog (CPU + wedge signatures)',
      description: 'Watches Search process CPU and engine logs for a persistent zero-progress wedge.',
      group: searchGroup,
      maxAgeMs: 120_000,
      run: () => checkSearchEngineBurn(),
    })
    ctx.registerHealthCheck({
      id: 'skill',
      name: 'Bakin SKILL.md sync to runtime',
      description: 'Confirms the runtime has Bakin\'s current generated skill instructions.',
      group: runtimeGroup,
      maxAgeMs: 900_000,
      run: () => checkAndSyncSkill(process.cwd(), ctx.runtime),
    })
    ctx.registerHealthCheck({
      id: 'plugin-assets',
      name: 'Plugin-shipped runtime skills install state',
      description: 'Checks installation and drift for runtime skills shipped by plugins.',
      group: pluginsGroup,
      maxAgeMs: 900_000,
      run: () => checkPluginAssets(),
    })
    ctx.registerHealthCheck({
      id: 'plugin-artifacts',
      name: 'Installed plugin artifact compatibility',
      description: 'Verifies user-installed plugin artifacts are compatible with and trusted by this host.',
      group: pluginsGroup,
      maxAgeMs: 900_000,
      run: () => checkPluginArtifacts(),
    })
    ctx.registerHealthCheck({
      id: 'plugin-registry',
      name: 'Plugin activation state',
      description: 'Surfaces plugins that failed during activation and are unavailable.',
      group: pluginsGroup,
      maxAgeMs: 300_000,
      run: () => checkPluginRegistry(),
    })

    ctx.registerHealthRepairAction(searchOutboxRepair())
    ctx.registerHealthRepairAction(searchConsistencyRepair())
    ctx.registerHealthRepairAction(searchSpinRepair())
    ctx.registerHealthRepairAction(searchCanaryRepair())
    ctx.registerHealthRepairAction(searchEngineBurnRepair())
    ctx.registerHealthRepairAction(syncSkillRepair(process.cwd(), ctx.runtime))
  },

  onShutdown() {
    stopUsageHistoryTimer()
  },

  onReady() {
    const report = getLastReport()
    log.info('Ready — canonical Health baseline', {
      reportId: report.id,
      overallStatus: report.overallStatus,
      registeredChecks: report.summary.checks.registered,
      incidents: report.summary.incidents,
    })
  },
})

export default healthPlugin
