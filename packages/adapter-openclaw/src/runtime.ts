import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { execFile } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { promisify } from 'util'
import type {
  AgentRuntimeAdapter,
  ApprovalResolveEvent,
  ChatChunk,
  ChannelInfo,
  CronJob,
  CronRun,
  CreateCronJobInput,
  CreateRuntimeAgentInput,
  MessageArgs,
  RuntimeAgent,
  RuntimeAvailableModel,
  RuntimeImageEditInput,
  RuntimeImageGenerateInput,
  RuntimeImageGenerationResult,
  RuntimeImageProvider,
  RuntimeMetadata,
  RuntimeMemorySearchResult,
  RuntimeSessionStoreStats,
  RuntimeSkill,
  UpdateCronJobInput,
  WorkspaceFile,
} from '@bakin/core/adapters/runtime'
import type { AdapterHealthCheckDefinition, AdapterInitOpts, AdapterLogger } from '@bakin/core/adapters/shared'
import { RuntimeError, RuntimeTurnError } from '@bakin/core/adapters/runtime'
import { readFileFrom, safeFileSize } from './file-utils'
import { inspectTrajectoryRun, trajectoryFilePathFor, watchTrajectoryForDeath, TrajectoryRecoveredTurn, type TrajectoryUsage } from './trajectory-forensics'
import { generateDirectImage, isDirectImageProvider, resolveProviderApiKeySource } from '@bakin/core/media'
import { isUserEdited } from '@bakin/core/agent-packages/markers'
import {
  agentListFrom,
  findAgentById,
  getAgentList,
  materializeImplicitMainAgent,
  readOpenClawConfig,
  resetOpenClawConfigCache,
  type OpenClawAgent,
  type OpenClawConfig,
} from './config'
import { getOpenClawHome, getOpenClawPath } from './home'
import { tryGetMainAgentId } from './main-agent'
import type { OpenClawRuntimeAdapterOptions } from './index'
import {
  OpenClawApprovalGatewayClient,
  type OpenClawPluginApprovalDecision,
  type OpenClawPluginApprovalResolvedPayload,
} from './approval-gateway'
import { OpenClawGatewayRpcClient } from './gateway-rpc'
import {
  getOpenClawMemoryEntry,
  getOpenClawMemoryWatchPaths,
  listOpenClawMemoryEntries,
  listOpenClawMemoryTiers,
  readOpenClawMemoryEntryRange,
  resolveOpenClawMemoryPath,
  statOpenClawMemoryEntry,
} from './memory'

interface OpenClawSettings {
  binaryPath: string
  gatewayUrl: string
  gatewayPort: number
}

const DEFAULT_SETTINGS: OpenClawSettings = {
  binaryPath: process.env.OPENCLAW_PATH || findOpenClawBinary() || '/opt/homebrew/bin/openclaw',
  gatewayUrl: 'http://127.0.0.1',
  gatewayPort: 18789,
}

const execFileAsync = promisify(execFile)

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const OPENCLAW_AGENT_TIMEOUT_MS = 600000
const OPENCLAW_AGENT_TIMEOUT_SECONDS = Math.ceil(OPENCLAW_AGENT_TIMEOUT_MS / 1000)
// Transport must outlast the server-side agent budget so the Gateway can deliver its own timeout.
const OPENCLAW_AGENT_TRANSPORT_TIMEOUT_MS = OPENCLAW_AGENT_TIMEOUT_MS + 30_000
const OPENCLAW_SESSION_ACTIVITY_POLL_MS = 200
const OPENCLAW_ACTIVITY_PREVIEW_CHARS = 500
const OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS = 600000
const OPENCLAW_CRON_TIMEOUT_MS = 30000
const OPENCLAW_CRON_PROCESS_TIMEOUT_MS = OPENCLAW_CRON_TIMEOUT_MS + 5000
const OPENCLAW_IMAGE_PROCESS_TIMEOUT_MS = 600000
const BAKIN_MCPORTER_CALL_TIMEOUT_MS = 600000
const OPENCLAW_IMAGE_OUTPUT_MAX_BUFFER = 16 * 1024 * 1024
const OPENCLAW_IMAGE_PROVIDERS_TTL_MS = 5000
const OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX = 'openclaw-plugin-approval:'
const OPENCLAW_PLUGIN_ID = 'bakin'
const OPENCLAW_WORKFLOW_GATE_TOOL = 'workflow.gate'
const OPENCLAW_MODELS_LIST_MAX_BUFFER = 16 * 1024 * 1024
const RENDER_ONLY_APPROVAL_NOTICE = [
  'This channel cannot return approval decisions to Bakin.',
  'Use the Bakin approval link or approve/reject this gate in the Bakin UI.',
].join(' ')
const REJECT_REASON_APPROVAL_NOTICE = [
  'This gate requires a reject reason.',
  'Use the Bakin approval link so reject decisions include the required reason.',
].join(' ')
const NATIVE_APPROVAL_NOTICE = [
  'Channel buttons are a convenience path and may expire before the Bakin gate does.',
  'The durable Bakin approval record remains canonical.',
].join(' ')
const NATIVE_APPROVAL_PROVIDERS = new Set(['discord', 'telegram', 'slack', 'matrix', 'qqbot'])
const OPENCLAW_PLUGIN_ALLOWLIST_WARNING = 'plugins.allow is empty'
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

interface OpenClawAgentTurnOptions {
  agentId: string
  messages: Array<{ role: string; content: string }>
  sessionKey?: string
  toolsMode?: MessageArgs['toolsMode']
  toolsAllow?: string[]
  toolsDeny?: string[]
  /** Per-turn model override (`provider/model`); omit to use the agent default. */
  model?: string
  /** Per-turn thinking level; omit to use the runtime default. */
  thinking?: string
  /** Oversized-output threshold for session-death diagnoses (core policy). */
  oversizedOutputBytes?: number
}

/** Result of one OpenClaw agent turn: the assistant text plus token usage
 *  (sourced from the trajectory `model.completed` event; absent when the
 *  runtime recorded none or the turn had no trajectory). */
interface OpenClawTurnResult {
  content: string
  usage?: TrajectoryUsage
}

class OpenClawCommandError extends RuntimeError {
  readonly args: string[]
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | string | undefined

  constructor(args: string[], cause: unknown) {
    const stdout = processOutput(cause, 'stdout')
    const stderr = processOutput(cause, 'stderr')
    const exitCode = processExitCode(cause)
    const details = [stderr, stdout].filter((part) => part.trim().length > 0).join('\n')
    super([
      `OpenClaw command failed${exitCode === undefined ? '' : ` (${exitCode})`}: openclaw ${args.join(' ')}`,
      details,
    ].filter(Boolean).join('\n'), { kind: 'runtime_failed', cause })
    this.name = 'OpenClawCommandError'
    this.args = args
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

function processOutput(cause: unknown, field: 'stdout' | 'stderr'): string {
  if (!cause || typeof cause !== 'object') return ''
  const value = (cause as Record<string, unknown>)[field]
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf-8')
  return ''
}

function processExitCode(cause: unknown): number | string | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const value = (cause as Record<string, unknown>).code
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

function openClawErrorOutput(err: unknown): string {
  if (err instanceof OpenClawCommandError) {
    return [err.stderr, err.stdout, err.message].filter(Boolean).join('\n')
  }
  if (!err || typeof err !== 'object') return String(err ?? '')
  const record = err as Record<string, unknown>
  return [
    typeof record.stderr === 'string' ? record.stderr : '',
    typeof record.stdout === 'string' ? record.stdout : '',
    typeof record.message === 'string' ? record.message : '',
  ].filter(Boolean).join('\n')
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function isPluginAllowlistOpenFailure(err: unknown): boolean {
  if (err instanceof OpenClawCommandError) {
    const stderr = stripAnsi(err.stderr).trim()
    const stdout = stripAnsi(err.stdout).trim()
    const nonWarningStderr = stderr
      .split('\n')
      .filter((line) => !line.includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING))
      .join('\n')
      .trim()
    return stdout.length === 0 && stderr.includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING) && nonWarningStderr.length === 0
  }
  return stripAnsi(openClawErrorOutput(err)).includes(OPENCLAW_PLUGIN_ALLOWLIST_WARNING)
}

interface OpenClawCronStore {
  version?: number
  jobs?: OpenClawCronStoreJob[]
}

interface OpenClawCronStoreJob {
  id: string
  agentId?: string
  sessionKey?: string
  name?: string
  description?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  schedule?: string | { kind?: string; type?: string; expr?: string; value?: string; tz?: string }
  sessionTarget?: string
  wakeMode?: string
  delivery?: { mode?: string; url?: string; to?: string; token?: string; channel?: string; threadId?: string; accountId?: string; bestEffort?: boolean; failureDestination?: unknown }
  payload?: { kind?: string; message?: string; text?: string; toolsAllow?: string[] } & Record<string, unknown>
  failureAlert?: unknown
  state?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  createdAtMs?: number
  updatedAtMs?: number
  metadata?: RuntimeMetadata
}

interface OpenClawCronRunEntry {
  runId?: string
  id?: string
  jobId?: string
  timestamp?: string
  startedAt?: string
  endedAt?: string
  status?: string
  output?: string
  error?: string
}

interface OpenClawModelListJson {
  models?: Array<{
    key?: string
    id?: string
    name?: string
    input?: string
    contextWindow?: number
    local?: boolean
    available?: boolean
    tags?: string[]
    missing?: boolean
  }>
}

interface OpenClawSessionStoreEntry {
  sessionId?: string
  sessionFile?: string
}

interface OpenClawSessionActivityCursor {
  sessionFile?: string
  offset: number
  partial: string
}

export class OpenClawRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = 'openclaw'
  readonly version = '0.0.1-rc.1'
  readonly requiredCoreVersion = '>=0.0.1-rc.1'

  private settings: OpenClawSettings
  private logger: AdapterLogger = noopLogger
  private approvalResponsesWarningLogged = false
  private approvalResolveWarningLogged = false
  private approvalGatewayClient: OpenClawApprovalGatewayClient | null = null
  private chatGatewayClient: OpenClawGatewayRpcClient | null = null
  private emittedApprovalResponseKeys: string[] = []
  private emittedApprovalResponseKeySet = new Set<string>()
  private lastModelListFailureMessage: string | null = null

  constructor(options: OpenClawRuntimeAdapterOptions = {}) {
    this.settings = mergeSettings(options.settings)
  }

  async initialize(opts: AdapterInitOpts): Promise<void> {
    this.logger = opts.logger ?? noopLogger
    this.settings = mergeSettings(opts.settings ?? (this.settings as unknown as Record<string, unknown>))
  }

  async shutdown(): Promise<void> {
    this.approvalGatewayClient?.close()
    this.approvalGatewayClient = null
    this.chatGatewayClient?.close()
    this.chatGatewayClient = null
  }

  async ping(): Promise<boolean> {
    for (const path of ['/health', '/healthz']) {
      try {
        const res = await fetch(`${this.baseUrl()}${path}`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) return true
      } catch {
        // try next path
      }
    }
    return false
  }

  async restart(): Promise<void> {
    await this.exec(['gateway', 'restart'])
  }

  getHealthChecks(): AdapterHealthCheckDefinition[] {
    return [
      {
        id: 'gateway',
        name: 'OpenClaw gateway',
        run: async () => {
          const reachable = await this.ping()
          return [{
            check: 'openclaw.gateway',
            status: reachable ? 'ok' : 'warn',
            message: reachable ? 'OpenClaw gateway is reachable' : 'OpenClaw gateway is unreachable',
            autoFixable: false,
          }]
        },
      },
      {
        id: 'channel-approval-responses',
        name: 'OpenClaw channel approval responses',
        run: async () => {
          const channels = await this.channels.list()
          const interactive = channels.filter(channel => channel.capabilities.includes('interactive-approval'))
          return [{
            check: 'openclaw.channel-approval-responses',
            status: interactive.length > 0 ? 'ok' : 'warn',
            message: interactive.length > 0
              ? `OpenClaw channel approval responses are enabled for ${interactive.map(channel => channel.id).join(', ')}.`
              : 'OpenClaw channel approval requests are render-only for configured channels. Approve/reject workflow gates in the Bakin UI until a channel advertises interactive-approval support.',
            autoFixable: false,
          }]
        },
      },
    ]
  }

  agents = {
    list: async (): Promise<RuntimeAgent[]> => getAgentList().map(agentToRuntime),
    get: async (agentId: string): Promise<RuntimeAgent | null> => {
      const agent = findAgentById(agentId)
      return agent ? agentToRuntime(agent) : null
    },
    create: async (input: CreateRuntimeAgentInput): Promise<RuntimeAgent> => {
      const id = input.id ?? slug(input.name)
      const workspace = getWorkspacePath(id)
      if (findAgentById(id)) throw new Error(`Agent already exists: ${id}`)
      const args = ['agents', 'add', id, '--workspace', workspace, '--non-interactive', '--json']
      if (input.model) args.splice(3, 0, '--model', input.model)
      const emoji = metadataValue(input.metadata, 'emoji')
      let createdViaConfigFallback = false
      try {
        await this.exec(args)
      } catch (err) {
        if (!isPluginAllowlistOpenFailure(err)) throw err
        this.logger.warn('OpenClaw CLI agent creation was blocked by plugin allow-list warning; writing agent config directly', {
          agentId: id,
          error: err instanceof Error ? err.message : String(err),
        })
        upsertOpenClawAgentConfig({ id, name: input.name, workspace, model: input.model, emoji })
        createdViaConfigFallback = true
      }
      if (!createdViaConfigFallback) {
        const identityArgs = ['agents', 'set-identity', '--agent', id]
        if (input.name) identityArgs.push('--name', input.name)
        if (emoji) identityArgs.push('--emoji', emoji)
        if (identityArgs.length > 4) {
          try {
            await this.exec(identityArgs)
          } catch (err) {
            if (!isPluginAllowlistOpenFailure(err)) throw err
            this.logger.warn('OpenClaw CLI identity update was blocked by plugin allow-list warning; writing agent identity directly', {
              agentId: id,
              error: err instanceof Error ? err.message : String(err),
            })
            updateOpenClawAgentIdentity(id, { name: input.name, emoji })
          }
        }
      }
      resetOpenClawConfigCache()
      if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true })
      return {
        id,
        name: input.name,
        role: input.role,
        model: input.model,
        status: 'active',
        metadata: { ...(input.metadata ?? {}), workspacePath: workspace },
      }
    },
    update: async (agentId: string, input: Partial<RuntimeAgent>): Promise<RuntimeAgent> => {
      if (!findAgentById(agentId)) throw new Error(`Agent not found: ${agentId}`)
      const args = ['agents', 'set-identity', '--agent', agentId]
      if (input.name) args.push('--name', input.name)
      const emoji = metadataValue(input.metadata, 'emoji')
      if (emoji) args.push('--emoji', emoji)
      if (args.length > 4) await this.exec(args)
      resetOpenClawConfigCache()
      const refreshed = findAgentById(agentId)
      if (refreshed) {
        return {
          ...agentToRuntime(refreshed),
          ...(input.role ? { role: input.role } : {}),
          ...(input.model ? { model: input.model } : {}),
          metadata: { ...(agentToRuntime(refreshed).metadata ?? {}), ...(input.metadata ?? {}) },
        }
      }
      return {
        id: agentId,
        name: input.name ?? agentId,
        role: input.role,
        model: input.model,
        status: 'active',
        metadata: input.metadata,
      }
    },
    remove: async (agentId: string): Promise<void> => {
      const workspace = getWorkspacePath(agentId)
      await this.exec(['agents', 'delete', agentId, '--force', '--json'])
      resetOpenClawConfigCache()
      removeOpenClawAgentConfig(agentId)
      removeOpenClawAgentArtifacts(agentId, workspace)
      removeOpenClawAgentCronArtifacts(agentId)
    },
    listWorkspaceFiles: async (agentId: string): Promise<string[]> => {
      const root = getWorkspacePath(agentId)
      try {
        return readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort()
      } catch {
        return []
      }
    },
    readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
      if (!isSafeWorkspaceFile(path)) return null
      const file = join(getWorkspacePath(agentId), path)
      try {
        return {
          path,
          content: readFileSync(file, 'utf-8'),
          updatedAt: statSync(file).mtime.toISOString(),
          metadata: {
            installedBy: readJsonFile(`${file}.installedBy`),
            userEdited: isUserEdited(file),
          },
        }
      } catch {
        return null
      }
    },
    writeWorkspaceFile: async (agentId: string, file: WorkspaceFile): Promise<void> => {
      if (!isSafeWorkspaceFile(file.path)) throw new Error(`Invalid workspace file path: ${file.path}`)
      const target = join(getWorkspacePath(agentId), file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content, 'utf-8')
      const installedBy = file.metadata?.installedBy
      if (installedBy) {
        writeFileSync(`${target}.installedBy`, JSON.stringify(installedBy, null, 2), 'utf-8')
      } else {
        rmSync(`${target}.installedBy`, { force: true })
      }
    },
    removeWorkspaceFile: async (agentId: string, path: string): Promise<void> => {
      if (!isSafeWorkspaceFile(path)) throw new Error(`Invalid workspace file path: ${path}`)
      const target = join(getWorkspacePath(agentId), path)
      rmSync(target, { force: true })
      rmSync(`${target}.installedBy`, { force: true })
    },
    updatePermissions: async (agentId: string, patch: { allow?: string[]; deny?: string[]; replace?: boolean }): Promise<void> => {
      updateAgentAllowlist(agentId, (current) => {
        const next = new Set(patch.replace ? [] : current)
        for (const id of patch.allow ?? []) next.add(id)
        for (const id of patch.deny ?? []) next.delete(id)
        next.delete(agentId)
        return Array.from(next)
      })
    },
    updateAllowlist: async (agentId: string, patch: { add?: string[]; remove?: string[]; replace?: string[] }): Promise<void> => {
      updateAgentAllowlist(agentId, (current) => {
        const next = new Set(patch.replace ?? current)
        for (const id of patch.add ?? []) next.add(id)
        for (const id of patch.remove ?? []) next.delete(id)
        next.delete(agentId)
        return Array.from(next)
      })
    },
  }

  messaging = {
    send: async (args: MessageArgs) => {
      const { content, usage } = await this.chatCompletion({
        agentId: args.agentId,
        messages: [{ role: 'user', content: args.content }],
        sessionKey: args.threadId,
        toolsMode: args.toolsMode,
        toolsAllow: args.toolsAllow,
        toolsDeny: args.toolsDeny,
        model: args.model,
        thinking: args.thinking,
        oversizedOutputBytes: oversizedOutputBytesFrom(args.metadata),
      })
      // Threaded sends expose the real (deterministic) provider session id
      // so callers can correlate the turn with forensics, usage, and audit.
      const sessionId = args.threadId ? openClawCliSessionId(args.agentId, args.threadId) : undefined
      return {
        id: `msg-${Date.now()}`,
        content,
        ...(usage ? { usage } : {}),
        ...(sessionId ? { metadata: { sessionId } } : {}),
      }
    },
    stream: (args: MessageArgs): AsyncIterable<ChatChunk> => this.streamChat({
      agentId: args.agentId,
      messages: [{ role: 'user', content: args.content }],
      sessionKey: args.threadId,
      toolsMode: args.toolsMode,
      toolsAllow: args.toolsAllow,
      toolsDeny: args.toolsDeny,
      model: args.model,
      thinking: args.thinking,
      oversizedOutputBytes: oversizedOutputBytesFrom(args.metadata),
    }),
  }

  tools = {
    invoke: async (_agentId: string, name: string, args: unknown) => {
      const value = await this.invokeTool(name, args as Record<string, unknown>)
      return { ok: true, output: value }
    },
  }

  channels = {
    list: async (): Promise<ChannelInfo[]> => readChannelInfos(),
    sendNotification: async (args: { channels: string[]; notification: { severity: string; title: string; body: string; metadata?: RuntimeMetadata } }) => {
      return this.channels.sendMessage({
        channels: args.channels,
        message: {
          title: args.notification.title,
          body: args.notification.body,
          metadata: args.notification.metadata,
        },
      })
    },
    sendMessage: async (args: { channels: string[]; message: { body: string; title?: string; threadId?: string; metadata?: RuntimeMetadata } }) => {
      const renderedAt = new Date().toISOString()
      const deliveries = []
      for (const channel of args.channels) {
        const ref = splitChannelRef(channel, args.message.metadata)
        const files = metadataFiles(args.message.metadata)
        const stdout = await this.exec(openClawMessageSendArgs(ref, args.message, files))
        deliveries.push({ channelId: channel, ref: deliveryRefFromOpenClawOutput(stdout) ?? `message:${Date.now()}`, renderedAt })
      }
      return { deliveries }
    },
    deliverContent: async (args: { channels: string[]; content: { title: string; body?: string; url?: string; files?: Array<{ name: string; path: string; contentType?: string }>; metadata?: RuntimeMetadata } }) => {
      return this.channels.sendMessage({
        channels: args.channels,
        message: {
          title: args.content.title,
          body: [args.content.body, args.content.url].filter(Boolean).join('\n\n'),
          metadata: {
            ...(args.content.metadata ?? {}),
            ...(args.content.files ? { files: args.content.files } : {}),
          },
        },
      })
    },
    createApproval: async (args: { approvalId: string; channels: string[]; request: { title: string; body: string; options: Array<{ id: string; label: string }>; context?: RuntimeMetadata } }) => {
      const renderedAt = new Date().toISOString()
      const deliveries = []
      const context = args.request.context ?? {}
      for (const channel of args.channels) {
        if (
          channelHasInteractiveApproval(channel)
          && !requiresRejectReason(context)
          && supportsNativeApprovalOptions(args.request.options)
        ) {
          const delivery = await this.tryCreateNativeApproval(channel, args, renderedAt)
          if (delivery) {
            deliveries.push(delivery)
            continue
          }
        }
        const fallback = await this.renderApprovalMessage(channel, args, context)
        deliveries.push(...fallback.deliveries)
      }
      return { deliveries }
    },
    editApproval: async (args: { deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }) => ({ deliveries: args.deliveries }),
    cancelApproval: async () => {},
    resolveApproval: async (args: { deliveries: Array<{ channelId: string; ref: string; renderedAt: string }>; response: { selectedOption: string } }) => {
      let sawNativeDelivery = false
      let sawRenderOnlyDelivery = false
      for (const delivery of args.deliveries) {
        const openClawApprovalId = parseNativeApprovalRef(delivery.ref)
        if (!openClawApprovalId) {
          sawRenderOnlyDelivery = true
          continue
        }
        sawNativeDelivery = true
        const decision = openClawDecisionFromBakinOption(args.response.selectedOption)
        if (!decision) continue
        try {
          await this.approvalGateway().resolvePluginApproval(openClawApprovalId, decision)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (isExpectedNativeApprovalResolveMiss(message)) {
            this.logger.debug('OpenClaw native approval was already resolved or expired', {
              openClawApprovalId,
              response: args.response.selectedOption,
            })
          } else {
            this.logger.warn('OpenClaw native approval resolve failed; durable Bakin approval remains canonical', {
              openClawApprovalId,
              error: message,
            })
          }
        }
      }

      if (!sawNativeDelivery && sawRenderOnlyDelivery && !this.approvalResolveWarningLogged) {
        this.logger.warn(
          'OpenClaw approval resolve is render-only; provider approval messages are not edited or resolved. The durable Bakin approval record remains canonical.'
        )
        this.approvalResolveWarningLogged = true
      }
    },
    subscribeApprovalResponses: (handler: (event: ApprovalResolveEvent) => void) => {
      if (!hasAnyInteractiveApprovalChannel()) {
        if (!this.approvalResponsesWarningLogged) {
          this.logger.warn(
            'OpenClaw channel approval responses are render-only for configured channels. Approve/reject workflow gates in the Bakin UI.'
          )
          this.approvalResponsesWarningLogged = true
        }
        return () => {}
      }
      return this.approvalGateway().subscribeResolved((payload) => {
        const event = approvalEventFromOpenClawPayload(payload)
        if (!event) return
        if (!this.markApprovalResponseEmitted(event)) return
        handler(event)
      })
    },
  }

  private async tryCreateNativeApproval(
    channel: string,
    args: { approvalId: string; request: { title: string; body: string; context?: RuntimeMetadata } },
    renderedAt: string,
  ): Promise<{ channelId: string; ref: string; renderedAt: string } | null> {
    const ref = splitChannelRef(channel, args.request.context)
    const approvalUrl = metadataValue(args.request.context, 'approvalUrl')
      ?? metadataValue(args.request.context, 'approvalDecisionUrl')
    try {
      const result = await this.approvalGateway().requestPluginApproval({
        pluginId: OPENCLAW_PLUGIN_ID,
        title: truncate(args.request.title, 80),
        description: renderNativeApprovalDescription(args.request.body, approvalUrl),
        severity: 'warning',
        toolName: OPENCLAW_WORKFLOW_GATE_TOOL,
        toolCallId: args.approvalId,
        turnSourceChannel: ref.channel,
        ...(ref.target ? { turnSourceTo: ref.target } : {}),
        timeoutMs: OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS,
        twoPhase: true,
      })
      if (!result.id || result.decision === null) {
        this.logger.warn('OpenClaw native approval request had no approval route; falling back to render-only message', {
          approvalId: args.approvalId,
          channel,
        })
        return null
      }
      return {
        channelId: channel,
        ref: `${OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX}${result.id}`,
        renderedAt,
      }
    } catch (err) {
      this.logger.warn('OpenClaw native approval request failed; falling back to render-only message', {
        approvalId: args.approvalId,
        channel,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async renderApprovalMessage(
    channel: string,
    args: { approvalId: string; request: { title: string; body: string; options: Array<{ id: string; label: string }>; context?: RuntimeMetadata } },
    context: RuntimeMetadata,
  ): Promise<{ deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }> {
    const optionText = args.request.options.map((option) => `- ${option.label} (${option.id})`).join('\n')
    const approvalUrl = metadataValue(context, 'approvalUrl') ?? metadataValue(context, 'approvalDecisionUrl')
    return this.channels.sendMessage({
      channels: [channel],
      message: {
        title: args.request.title,
        body: [
          args.request.body,
          optionText,
          approvalUrl ? `Open in Bakin: ${approvalUrl}` : undefined,
          approvalNoticeForMessage(channel, context),
        ].filter(Boolean).join('\n\n'),
        metadata: { ...context, approvalId: args.approvalId },
      },
    })
  }

  private approvalGateway(): OpenClawApprovalGatewayClient {
    if (!this.approvalGatewayClient) {
      this.approvalGatewayClient = new OpenClawApprovalGatewayClient({
        url: gatewayWebSocketUrl(this.settings),
        token: readGatewayToken,
        logger: this.logger,
      })
    }
    return this.approvalGatewayClient
  }

  private markApprovalResponseEmitted(event: ApprovalResolveEvent): boolean {
    const key = `${event.approvalId}:${event.response.selectedOption}:${event.response.respondedAt}`
    if (this.emittedApprovalResponseKeySet.has(key)) return false
    this.emittedApprovalResponseKeySet.add(key)
    this.emittedApprovalResponseKeys.push(key)
    while (this.emittedApprovalResponseKeys.length > 1000) {
      const old = this.emittedApprovalResponseKeys.shift()
      if (old) this.emittedApprovalResponseKeySet.delete(old)
    }
    return true
  }

  skills = {
    list: async (agentId?: string): Promise<RuntimeSkill[]> => {
      const roots = agentId ? [join(getWorkspacePath(agentId), 'skills')] : [getOpenClawPath('skills')]
      const out: RuntimeSkill[] = []
      for (const root of roots) {
        try {
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const path = join(root, entry.name, 'SKILL.md')
            out.push({
              name: entry.name,
              ...(existsSync(path) ? { path } : {}),
              metadata: { hasSkillMd: existsSync(path) },
            })
          }
        } catch {
          // no skills directory
        }
      }
      return out
    },
    get: async (name: string, agentId?: string): Promise<RuntimeSkill | null> => {
      const roots = agentId
        ? [join(getWorkspacePath(agentId), 'skills')]
        : [getOpenClawPath('skills'), join(getOpenClawPath('workspace'), 'skills')]
      for (const root of roots) {
        const dir = join(root, name)
        const file = join(dir, 'SKILL.md')
        try {
          return {
            name,
            path: file,
            instructions: readFileSync(file, 'utf-8'),
            files: readSkillTree(dir),
            metadata: {
              installedBy: readJsonFile(join(dir, '.installedBy')),
              userEdited: existsSync(join(dir, '.userEdited')),
            },
          }
        } catch {
          // try next root
        }
      }
      return null
    },
    write: async (skill: RuntimeSkill, agentId?: string): Promise<void> => {
      const dir = agentId
        ? join(getWorkspacePath(agentId), 'skills', skill.name)
        : join(getOpenClawPath('skills'), skill.name)
      mkdirSync(dir, { recursive: true })
      const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
      for (const [rel, content] of Object.entries(files)) {
        if (!isSafeSkillFilePath(rel)) throw new Error(`Invalid skill file path: ${rel}`)
        const target = join(dir, rel)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content, 'utf-8')
      }
      const installedBy = skill.metadata?.installedBy
      if (installedBy) {
        writeFileSync(join(dir, '.installedBy'), JSON.stringify(installedBy, null, 2), 'utf-8')
      } else {
        rmSync(join(dir, '.installedBy'), { force: true })
      }
    },
    remove: async (name: string, agentId?: string): Promise<void> => {
      const dir = agentId
        ? join(getWorkspacePath(agentId), 'skills', name)
        : join(getOpenClawPath('skills'), name)
      rmSync(dir, { recursive: true, force: true })
    },
  }

  sessions = {
    list: async () => [],
    get: async () => null,
    storeStats: async (): Promise<RuntimeSessionStoreStats[]> => {
      const agentsDir = getOpenClawPath('agents')
      if (!existsSync(agentsDir)) return []
      const stats: RuntimeSessionStoreStats[] = []
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const sessionsDir = join(agentsDir, entry.name, 'sessions')
        if (!existsSync(sessionsDir)) continue
        // Top-level files are session artifacts (transcripts, the store
        // itself); subtrees like skills-prompts/ are cache disk pressure
        // only and must not skew the orphan file count.
        let fileCount = 0
        let diskBytes = 0
        const walk = (dir: string, topLevel: boolean) => {
          for (const file of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, file.name)
            if (file.isDirectory()) {
              walk(path, false)
            } else if (file.isFile()) {
              if (topLevel) fileCount += 1
              diskBytes += statSync(path).size
            }
          }
        }
        walk(sessionsDir, true)
        let storeEntries = 0
        try {
          const store: unknown = JSON.parse(readFileSync(join(sessionsDir, 'sessions.json'), 'utf-8'))
          if (store && typeof store === 'object') storeEntries = Object.keys(store).length
        } catch (err) {
          this.logger.debug('Session store missing or unparsable while collecting stats', {
            agentId: entry.name,
            error: String(err),
          })
        }
        stats.push({ agentId: entry.name, storeEntries, fileCount, diskBytes })
      }
      return stats
    },
  }

  memory = {
    listTiers: async () => listOpenClawMemoryTiers(),
    listEntries: async (tierId: string, opts?: { agentId?: string }) => listOpenClawMemoryEntries(tierId, opts),
    getEntry: async (tierId: string, id: string, opts?: { agentId?: string }) => getOpenClawMemoryEntry(tierId, id, opts),
    statEntry: async (tierId: string, id: string, opts?: { agentId?: string }) => statOpenClawMemoryEntry(tierId, id, opts),
    readEntryRange: async (
      tierId: string,
      id: string,
      opts?: { agentId?: string; offset?: number; length?: number },
    ) => readOpenClawMemoryEntryRange(tierId, id, opts),
    resolvePath: async (path: string) => resolveOpenClawMemoryPath(path),
    watchPaths: async () => getOpenClawMemoryWatchPaths(),
    search: async (query: string, opts?: { agentId?: string; limit?: number }): Promise<RuntimeMemorySearchResult> => {
      const trimmed = query.trim()
      if (!trimmed) return { results: [] }
      const args = ['memory', 'search', '--query', trimmed, '--json']
      if (opts?.agentId) args.push('--agent', opts.agentId)
      if (typeof opts?.limit === 'number') args.push('--limit', String(opts.limit))
      const stdout = await this.exec(args)
      const parsed = parseJsonObject(stdout)
      const results = Array.isArray(parsed?.results) ? parsed.results : []
      return { results, metadata: parsed ?? undefined }
    },
  }

  models = {
    listAvailable: async (opts?: { includeUnavailable?: boolean }): Promise<RuntimeAvailableModel[]> => {
      const args = ['models', 'list']
      if (opts?.includeUnavailable) args.push('--all')
      args.push('--json')
      const stdout = await this.exec(args, opts?.includeUnavailable ? { maxBuffer: OPENCLAW_MODELS_LIST_MAX_BUFFER } : undefined)
      const parsed = parseJsonObject(stdout) as OpenClawModelListJson | null
      return (parsed?.models ?? [])
        .map((model): RuntimeAvailableModel | null => {
          const id = model.key ?? model.id
          if (!id) return null
          const available = model.available ?? !model.missing
          if (!opts?.includeUnavailable && available === false) return null
          const out: RuntimeAvailableModel = { id, available }
          if (model.name !== undefined) out.name = model.name
          if (model.input !== undefined) out.input = model.input
          if (model.contextWindow !== undefined) out.contextWindow = model.contextWindow
          if (model.local !== undefined) out.local = model.local
          if (model.tags !== undefined) out.tags = model.tags
          if (model.missing) out.metadata = { missing: true }
          return out
        })
        .filter((model): model is RuntimeAvailableModel => model !== null)
    },
  }

  private imageProvidersCache: { at: number; value: RuntimeImageProvider[] } | null = null

  images = {
    providers: async (): Promise<RuntimeImageProvider[]> => {
      const stdout = await this.exec(['infer', 'image', 'providers', '--json'], {
        timeout: OPENCLAW_IMAGE_PROCESS_TIMEOUT_MS,
        maxBuffer: OPENCLAW_IMAGE_OUTPUT_MAX_BUFFER,
      })
      const value = parseOpenClawImageProviders(stdout)
      this.imageProvidersCache = { at: Date.now(), value }
      return value
    },
    generate: async (input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult> => {
      // Native `infer image generate` has no file input, so a generate carrying
      // reference images is served by the edit-style invocation (#418). The shim
      // can't do references — the plugin rejects that combination upstream.
      if (input.referenceImages?.length) {
        const editInput: RuntimeImageEditInput = { ...input, files: input.referenceImages }
        return tagRuntimeServed(await this.runImageInference('edit', editInput))
      }
      if (await this.canServeImageNatively(input)) {
        return tagRuntimeServed(await this.runImageInference('generate', input))
      }
      // The requested model isn't in the runtime's advertised set. Prefer the
      // shared shim when a Bakin key is configured for a direct provider;
      // otherwise fall through to a native attempt as a LAST RESORT — the
      // runtime may still serve a model it didn't enumerate (provider listings
      // often report only a subset/defaultModel), so we must not pre-empt it.
      const provider = input.provider
      if (provider && isDirectImageProvider(provider)) {
        const shimmed = await this.generateImageViaShim(input)
        if (shimmed) return shimmed
      }
      return tagRuntimeServed(await this.runImageInference('generate', input))
    },
    edit: async (input: RuntimeImageEditInput): Promise<RuntimeImageGenerationResult> => {
      return tagRuntimeServed(await this.runImageInference('edit', input))
    },
  }

  media = {
    /**
     * Resolve an OpenClaw `media://<rel>` URI (how the runtime addresses
     * channel attachments, e.g. media://inbound/<file>) to its absolute path
     * under the OpenClaw home's media root. Null for other schemes, missing
     * files, or anything escaping the media root.
     */
    resolveUri: async (uri: string): Promise<string | null> => {
      const match = /^media:\/\/(.+)$/.exec(uri)
      if (!match) return null
      const root = resolve(getOpenClawPath('media'))
      const candidate = resolve(root, match[1])
      if (!candidate.startsWith(root + sep)) return null
      try {
        return statSync(candidate).isFile() ? candidate : null
      } catch {
        return null // missing file — "not found" is a value here, not an error
      }
    },
  }

  private async cachedImageProviders(): Promise<RuntimeImageProvider[]> {
    const cached = this.imageProvidersCache
    if (cached && Date.now() - cached.at < OPENCLAW_IMAGE_PROVIDERS_TTL_MS) return cached.value
    return this.images.providers()
  }

  /** Can OpenClaw serve this provider/model itself? Undeterminable → assume yes (let native try). */
  private async canServeImageNatively(input: RuntimeImageGenerateInput): Promise<boolean> {
    const provider = input.provider ?? providerFromImageModel(openClawImageModelArg(input))
    if (!provider) return true
    let providers: RuntimeImageProvider[]
    try {
      providers = await this.cachedImageProviders()
    } catch {
      return true // discovery failed — don't pre-empt the native attempt
    }
    const match = providers.find(candidate => candidate.id === provider)
    if (!match || match.configured !== true) return false
    if (!input.model) return true
    const models = match.models?.length ? match.models : match.defaultModel ? [match.defaultModel] : []
    return models.includes(input.model)
  }

  private async generateImageViaShim(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult | null> {
    const provider = input.provider
    if (!provider || !isDirectImageProvider(provider)) return null
    const resolved = resolveProviderApiKeySource(provider)
    if (!resolved) return null
    const model = input.model ?? ''
    const result = await generateDirectImage({
      provider,
      model,
      prompt: input.prompt,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      quality: imageQualityFromMetadata(input.metadata),
      apiKey: resolved.apiKey,
      // Forward the full generation option surface so the shim's guardrail
      // (assertShimCanHonor) sees what it can't honor and rejects BEFORE the
      // billed call — omitting these re-opens the silent drop #379 closed.
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
      ...(input.background !== undefined ? { background: input.background } : {}),
      ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
    })
    return {
      images: [{
        filePath: result.filePath,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        provider,
        ...(model ? { model } : {}),
      }],
      provider,
      ...(model ? { model } : {}),
      ...(result.providerText ? { providerText: result.providerText } : {}),
      metadata: {
        source: 'bakin.direct-image-provider',
        servedBy: 'shim',
        credentialSource: resolved.source === 'env' ? 'bakin-env' : 'bakin-store',
      },
    }
  }

  cron = {
    list: async (): Promise<CronJob[]> => this.listCronJobs(),
    get: async (id: string): Promise<CronJob | null> => this.getCronJob(id),
    create: async (input: CreateCronJobInput): Promise<CronJob> => this.createCronJob(input),
    update: async (id: string, patch: UpdateCronJobInput): Promise<CronJob> => this.updateCronJob(id, patch),
    remove: async (id: string): Promise<void> => {
      await this.execCron(['cron', 'rm', id, '--timeout', String(OPENCLAW_CRON_TIMEOUT_MS)])
    },
    runNow: async (jobId: string): Promise<CronRun> => {
      await this.exec(['cron', 'run', jobId])
      return readCronRuns(jobId, 1)[0] ?? {
        id: `run-${Date.now()}`,
        jobId,
        status: 'queued',
        startedAt: new Date().toISOString(),
      }
    },
    listRuns: async (jobId: string): Promise<CronRun[]> => this.listCronRuns(jobId),
    getRaw: async (id: string, reason: string): Promise<unknown | null> => {
      if (!reason) throw new Error('cron.getRaw requires a reason')
      const job = readCronJobs().find((entry) => entry.id === id)
      return job ? cloneJson(job) : null
    },
    restoreRaw: async (id: string, snapshot: unknown, reason: string): Promise<CronJob> => {
      if (!reason) throw new Error('cron.restoreRaw requires a reason')
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('cron.restoreRaw requires an object snapshot')
      }
      const restored = cloneJson(snapshot) as OpenClawCronStoreJob
      if (typeof restored.id !== 'string' || restored.id.length === 0) restored.id = id
      if (restored.id !== id) throw new Error(`Raw cron snapshot id mismatch: expected ${id}, got ${restored.id}`)
      const store = readCronStore()
      const jobs = store.jobs ?? []
      const index = jobs.findIndex((job) => job.id === id)
      if (index === -1) jobs.push(restored)
      else jobs[index] = restored
      writeCronStore({ ...store, jobs })
      return cronStoreJobToRuntime(restored)
    },
  }

  config = {
    get: async <T = Record<string, unknown>>() => {
      // Populate agents.list (synthesizing an implicit `main` for minimal
      // configs) so consumers like the models plugin can rely on it.
      const config = readOpenClawConfig()
      if (!config) return {} as T
      const list = config.agents?.list
      if (Array.isArray(list) && list.length > 0) return config as T
      return { ...config, agents: { ...config.agents, list: agentListFrom(config) } } as T
    },
    update: async (patch: Record<string, unknown>): Promise<void> => {
      const config = readOpenClawConfig() ?? {}
      writeOpenClawConfig(deepMerge(config as Record<string, unknown>, patch))
    },
    replace: async <T = Record<string, unknown>>(next: T, reason: string): Promise<void> => {
      if (!reason) throw new Error('config.replace requires a reason')
      writeOpenClawConfig(next as Record<string, unknown>)
    },
    raw: async <T = unknown>(key: string, reason: string): Promise<T> => {
      if (!key) throw new Error('config.raw requires a key')
      if (!reason) throw new Error('config.raw requires a reason')
      const authProfilesMatch = key.match(/^agents\.([^.]+)\.authProfiles$/)
      if (authProfilesMatch) {
        const profilePath = getOpenClawPath('agents', authProfilesMatch[1], 'agent', 'auth-profiles.json')
        if (!existsSync(profilePath)) return null as T
        return JSON.parse(readFileSync(profilePath, 'utf-8')) as T
      }
      const config = readOpenClawConfig()
      if (!config) return null as T
      return (key === '*' ? config : readPath(config as Record<string, unknown>, key)) as T
    },
  }

  private async listCronJobs(): Promise<CronJob[]> {
    const stdout = await this.execCron(['cron', 'list', '--all', '--json', '--timeout', String(OPENCLAW_CRON_TIMEOUT_MS)])
    return extractCronStoreJobs(stdout).map(cronStoreJobToRuntime)
  }

  private async getCronJob(id: string): Promise<CronJob | null> {
    const jobs = await this.listCronJobs()
    return jobs.find((job) => job.id === id) ?? null
  }

  private async createCronJob(input: CreateCronJobInput): Promise<CronJob> {
    const args = cronCreateArgs(input)
    const stdout = await this.execCron(args)
    const parsed = parseJsonValue(stdout)
    const rawJob = extractCronStoreJob(parsed)
    const id = cronJobIdFromCliResult(parsed) ?? rawJob?.id ?? input.id
    if (!id) throw new Error('OpenClaw cron add did not return a job id')

    const runtime = rawJob ? cronStoreJobToRuntime(withCronInputFallbacks(rawJob, id, input)) : cronJobFromInput(id, input)
    return {
      ...runtime,
      metadata: input.metadata ?? runtime.metadata,
      toolsAllow: normalizeCronToolsAllow(input.toolsAllow) ?? runtime.toolsAllow,
    }
  }

  private async updateCronJob(id: string, patch: UpdateCronJobInput): Promise<CronJob> {
    const current = await this.getCronJob(id)
    if (!current) throw new Error(`Cron job not found: ${id}`)

    const args = cronUpdateArgs(id, current, patch)
    if (args.length > 5) await this.execCron(args)

    const effective = cronJobFromUpdatePatch(id, current, patch)
    const refreshed = await this.getCronJob(id).catch(() => null)
    if (!refreshed) return effective

    const command = patch.command ?? refreshed.command
    const metadata = patch.metadata ?? refreshed.metadata
    return {
      ...refreshed,
      command,
      metadata,
      toolsAllow: patch.toolsAllow !== undefined ? effective.toolsAllow : refreshed.toolsAllow,
    }
  }

  private async listCronRuns(jobId: string): Promise<CronRun[]> {
    try {
      const stdout = await this.execCron([
        'cron',
        'runs',
        '--id',
        jobId,
        '--limit',
        '50',
        '--timeout',
        String(OPENCLAW_CRON_TIMEOUT_MS),
      ])
      const runs = extractCronRuns(stdout, jobId)
      return runs.length > 0 || stdout.trim().length === 0 ? runs : readCronRuns(jobId)
    } catch (err) {
      this.logger.debug('OpenClaw cron runs CLI failed; falling back to JSONL run history', {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      })
      return readCronRuns(jobId)
    }
  }

  private baseUrl(): string {
    return `${this.settings.gatewayUrl}:${this.settings.gatewayPort}`
  }

  private headers(agentId?: string, sessionKey?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = readGatewayToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (agentId) headers['x-openclaw-agent-id'] = agentId
    if (sessionKey) headers['x-openclaw-session-key'] = sessionKey
    return headers
  }

  private async chatCompletion(opts: OpenClawAgentTurnOptions): Promise<OpenClawTurnResult> {
    return this.runOpenClawAgentGateway(opts)
  }

  private async *streamChat(opts: OpenClawAgentTurnOptions): AsyncIterable<ChatChunk> {
    const primary = this.runOpenClawAgentGatewayStream(opts)
    if (!opts.sessionKey) {
      yield* primary
      return
    }

    const activityCursor = opts.sessionKey
      ? createOpenClawSessionActivityCursor(opts.agentId, opts.sessionKey)
      : null
    if (!activityCursor) {
      yield* primary
      return
    }

    const activityAbort = new AbortController()
    const activity = watchOpenClawSessionActivity(opts.agentId, opts.sessionKey, activityCursor, activityAbort.signal)
    yield* mergeChatStreams(primary, activity, () => activityAbort.abort())
  }

  private async *runOpenClawAgentGatewayStream(opts: OpenClawAgentTurnOptions): AsyncIterable<ChatChunk> {
    const { content } = await this.runOpenClawAgentGateway(opts)
    if (content) yield { type: 'text', content }
    yield { type: 'done' }
  }

  /**
   * Best-effort token usage for the just-finished turn, read from the
   * trajectory's success `model.completed` event. Threaded sends only (no
   * trajectory file → no usage). Returns undefined when the runtime recorded
   * none — never fabricated.
   */
  private readTurnUsage(trajectoryFile: string | null, trajectoryOffset: number, opts: OpenClawAgentTurnOptions): TrajectoryUsage | undefined {
    if (!trajectoryFile) return undefined
    const outcome = inspectTrajectoryRun({
      trajectoryFile,
      sinceByteOffset: trajectoryOffset,
      oversizedOutputBytes: opts.oversizedOutputBytes,
    })
    return outcome?.kind === 'success' ? outcome.usage : undefined
  }

  private async runOpenClawAgentGateway(opts: OpenClawAgentTurnOptions): Promise<OpenClawTurnResult> {
    const cliSessionId = opts.sessionKey ? openClawCliSessionId(opts.agentId, opts.sessionKey) : null
    const params: Record<string, unknown> = {
      agentId: opts.agentId,
      message: messagesToOpenClawPrompt(opts.messages),
      deliver: false,
      timeout: OPENCLAW_AGENT_TIMEOUT_SECONDS,
      // Stable per-attempt key: a transport retry of the SAME logical turn
      // (same threadId) is idempotent at the gateway. Unthreaded sends keep
      // a random key — each is its own logical turn.
      idempotencyKey: opts.sessionKey ? `bakin:${opts.sessionKey}` : `bakin-${randomUUID()}`,
    }
    applyRuntimeMessageToolPolicy(params, opts)
    if (cliSessionId) params.sessionId = cliSessionId
    // Per-turn routing overrides (Bakin's policy → gateway agent RPC). Omit
    // when unset so the runtime uses the agent's configured model/default.
    if (opts.model) params.model = opts.model
    if (opts.thinking) params.thinking = opts.thinking

    // Capture where the trajectory ends BEFORE the turn starts so any
    // post-mortem only sees events from this attempt (the file accrues one
    // run per turn for the life of the session).
    const trajectoryFile = cliSessionId ? trajectoryFilePathFor(opts.agentId, cliSessionId) : null
    const trajectoryOffset = trajectoryFile ? safeFileSize(trajectoryFile) : 0

    // Fail-fast: race the pending request against the on-disk evidence. When
    // OpenClaw records session.ended (non-success) the gateway will never
    // deliver a final frame — without this, the caller waits out the full
    // 630s transport timer to learn what the trajectory knew in 200ms.
    const requestAbort = new AbortController()
    const deathWatch = trajectoryFile
      ? watchTrajectoryForDeath({
          trajectoryFile,
          sinceByteOffset: trajectoryOffset,
          oversizedOutputBytes: opts.oversizedOutputBytes,
          pollMs: OPENCLAW_SESSION_ACTIVITY_POLL_MS,
        })
      : null

    try {
      const request = this.openClawChatGateway().request('agent', params, {
        expectFinal: true,
        timeoutMs: OPENCLAW_AGENT_TRANSPORT_TIMEOUT_MS,
        signal: requestAbort.signal,
      })
      // If the death watch wins the race, the losing request settles later
      // (abort rejection) with no awaiter — pre-attach a no-op catch so it
      // can never surface as an unhandled rejection.
      request.catch(() => {})
      const payload = deathWatch
        ? await Promise.race([request, deathWatch.promise])
        : await request
      const content = extractOpenClawAgentText(payload)
      if (content) return { content, usage: this.readTurnUsage(trajectoryFile, trajectoryOffset, opts) }
      // A SUCCESS frame whose payload yields no extractable text (payload
      // shape drift) is still recoverable when the trajectory recorded the
      // completion — don't fail a turn whose content exists on disk.
      if (trajectoryFile) {
        const outcome = inspectTrajectoryRun({
          trajectoryFile,
          sinceByteOffset: trajectoryOffset,
          oversizedOutputBytes: opts.oversizedOutputBytes,
        })
        if (outcome?.kind === 'success' && outcome.content) {
          this.logger.warn('OpenClaw agent payload had no extractable text; recovered from trajectory', {
            agentId: opts.agentId,
            sessionId: outcome.sessionId,
          })
          return { content: outcome.content, usage: outcome.usage }
        }
      }
      throw new RuntimeError('OpenClaw chat failed: agent response did not include assistant text', { kind: 'runtime_failed' })
    } catch (err) {
      if (err instanceof TrajectoryRecoveredTurn) {
        // The run succeeded on disk but the gateway frame never arrived
        // within the grace window — surface the recovered content as a
        // normal success and cancel the pending RPC (clears its timer).
        requestAbort.abort()
        this.logger.warn('OpenClaw agent turn recovered fail-fast: success on disk, gateway frame not delivered', {
          agentId: opts.agentId,
          sessionId: err.sessionId,
        })
        return { content: err.content, usage: err.usage }
      }
      if (err instanceof RuntimeTurnError) {
        // Fail-fast verdict — the diagnosis is already complete. Cancel the
        // pending RPC (clears its 630s timer) and surface immediately.
        requestAbort.abort()
        this.logger.warn('OpenClaw agent turn died; fail-fast diagnosis', {
          agentId: opts.agentId,
          sessionId: err.diagnosis.sessionId,
          reason: err.diagnosis.reason,
          completionBytes: err.diagnosis.completionBytes,
        })
        throw err
      }
      // Gateway/provider failures are already typed RuntimeErrors with the
      // original cause attached — rethrow so classification survives the
      // boundary (wrapping in a bare Error previously stripped `cause` and
      // misclassified every transport failure as structural).
      const typed = err instanceof RuntimeError
        ? err
        : new RuntimeError(
            `OpenClaw chat failed: ${err instanceof Error ? err.message : String(err)}`,
            { kind: 'runtime_failed', cause: err },
          )
      const verdict = this.postMortemAgentTurn(typed, trajectoryFile, trajectoryOffset, opts)
      if (verdict?.kind === 'recovered') return { content: verdict.content, usage: verdict.usage }
      if (verdict?.kind === 'death') throw verdict.error
      throw typed
    } finally {
      deathWatch?.stop()
    }
  }

  /**
   * Post-mortem for a failed agent turn. When the gateway times out or the
   * socket drops mid-turn, the truth is in the session trajectory on disk:
   *  - run ended `success` but the final frame was lost → RECOVER the
   *    response text instead of failing the turn at all;
   *  - run died (interrupted/oversized/server timeout) → a RuntimeTurnError
   *    carrying the structured diagnosis replaces the generic error;
   *  - no evidence → null, the original error stands.
   */
  private postMortemAgentTurn(
    err: RuntimeError,
    trajectoryFile: string | null,
    trajectoryOffset: number,
    opts: OpenClawAgentTurnOptions,
  ): { kind: 'recovered'; content: string; usage?: TrajectoryUsage } | { kind: 'death'; error: RuntimeTurnError } | null {
    if (!trajectoryFile) return null
    // timeout/transport: the frame never arrived. runtime_failed: an error
    // FRAME arrived — but a graceful gateway shutdown mid-turn sends one
    // while ALSO writing session.ended(error) to the trajectory (observed
    // live on the rig), and the frame can beat the fail-fast watcher. The
    // on-disk evidence is authoritative either way; per-attempt offset
    // scoping means a pre-run rejection (e.g. param validation) simply has
    // no events after the offset → null → the original error stands.
    // provider_cooldown stays excluded: the turn was never accepted.
    if (err.kind !== 'timeout' && err.kind !== 'transport' && err.kind !== 'runtime_failed') return null

    const outcome = inspectTrajectoryRun({
      trajectoryFile,
      sinceByteOffset: trajectoryOffset,
      oversizedOutputBytes: opts.oversizedOutputBytes,
    })
    if (!outcome) return null

    if (outcome.kind === 'success') {
      // The turn completed; only the response frame was lost. Surfacing the
      // recovered text turns a spurious 10-minute failure into a success.
      this.logger.warn('OpenClaw agent turn recovered from trajectory after gateway failure', {
        agentId: opts.agentId,
        sessionId: outcome.sessionId,
        error: err.message,
      })
      return { kind: 'recovered', content: outcome.content, usage: outcome.usage }
    }

    this.logger.warn('OpenClaw agent turn died; trajectory post-mortem attached', {
      agentId: opts.agentId,
      sessionId: outcome.diagnosis.sessionId,
      reason: outcome.diagnosis.reason,
      completionBytes: outcome.diagnosis.completionBytes,
    })
    return { kind: 'death', error: new RuntimeTurnError(outcome.diagnosis, { cause: err }) }
  }

  private openClawChatGateway(): OpenClawGatewayRpcClient {
    if (this.chatGatewayClient) return this.chatGatewayClient
    this.chatGatewayClient = new OpenClawGatewayRpcClient({
      url: gatewayWebSocketUrl(this.settings),
      token: readGatewayToken,
      logger: this.logger,
      clientId: 'gateway-client',
      displayName: 'Bakin',
      clientMode: 'backend',
      scopes: ['operator.read', 'operator.write'],
      useDeviceAuth: true,
      label: 'OpenClaw chat gateway',
    })
    return this.chatGatewayClient
  }

  private async invokeTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${this.baseUrl()}/tools/invoke`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ tool: toolName, action: 'json', args }),
    })
    if (!res.ok) throw new RuntimeError(`OpenClaw invokeTool failed (${res.status}): ${await res.text()}`, { kind: 'runtime_failed' })
    return res.json()
  }

  private async runImageInference(
    command: 'generate' | 'edit',
    input: RuntimeImageGenerateInput | RuntimeImageEditInput,
  ): Promise<RuntimeImageGenerationResult> {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error(`OpenClaw image ${command} requires a prompt`)

    // The adapter owns where the file lands — the capability contract no longer
    // carries an outputPath (that was a file/CLI concept leaking into a
    // runtime-agnostic interface).
    const outputPath = defaultOpenClawImageOutputPath(input.outputFormat)
    const args = ['infer', 'image', command, '--prompt', prompt, '--output', outputPath, '--json']
    const model = openClawImageModelArg(input)
    if (model) args.push('--model', model)
    if (typeof input.count === 'number') args.push('--count', String(input.count))
    const size = input.size ?? (input.width && input.height ? `${input.width}x${input.height}` : undefined)
    if (size) args.push('--size', size)
    if (input.aspectRatio) args.push('--aspect-ratio', input.aspectRatio)
    if (input.resolution) args.push('--resolution', input.resolution)
    if (input.outputFormat) args.push('--output-format', normalizeOpenClawOutputFormat(input.outputFormat))
    if (input.background) args.push('--background', input.background)
    if (command === 'edit') {
      for (const file of (input as RuntimeImageEditInput).files) args.push('--file', file)
    }
    if (typeof input.timeoutMs === 'number') args.push('--timeout-ms', String(input.timeoutMs))

    // No retry: `infer image generate` is non-idempotent and billed; a
    // transient-looking failure after the upstream provider already generated
    // would double-bill on retry. Surface the failure to the caller instead.
    const stdout = await this.exec(args, {
      timeout: input.timeoutMs ?? OPENCLAW_IMAGE_PROCESS_TIMEOUT_MS,
      maxBuffer: OPENCLAW_IMAGE_OUTPUT_MAX_BUFFER,
    })
    return parseOpenClawImageResult(stdout, { input, outputPath })
  }

  private async exec(args: string[], opts: { maxBuffer?: number; timeout?: number } = {}): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.settings.binaryPath, args, { timeout: 15000, ...opts, env: openClawChildEnv() })
      return stdout
    } catch (err) {
      throw new OpenClawCommandError(args, err)
    }
  }

  private async execCron(args: string[]): Promise<string> {
    return this.exec(args, { timeout: OPENCLAW_CRON_PROCESS_TIMEOUT_MS })
  }
}

function oversizedOutputBytesFrom(metadata: RuntimeMetadata | undefined): number | undefined {
  const value = metadata?.oversizedOutputBytes
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function messagesToOpenClawPrompt(messages: Array<{ role: string; content: string }>): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())
  if (lastUser) return lastUser.content
  return messages.map((message) => message.content).filter(Boolean).join('\n\n')
}

function normalizeToolList(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const tools: string[] = []
  for (const entry of value) {
    const tool = typeof entry === 'string' ? entry.trim() : ''
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    tools.push(tool)
  }
  return tools.length > 0 ? tools : undefined
}

function applyRuntimeMessageToolPolicy(params: Record<string, unknown>, opts: OpenClawAgentTurnOptions): void {
  if (opts.toolsMode === 'none' || opts.toolsMode === 'auto') params.toolsMode = opts.toolsMode
  const toolsAllow = normalizeToolList(opts.toolsAllow)
  const toolsDeny = normalizeToolList(opts.toolsDeny)
  if (toolsAllow) params.toolsAllow = toolsAllow
  if (toolsDeny) params.toolsDeny = toolsDeny
}

function extractOpenClawAgentText(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJsonObject(value.trim()) ?? value.trim() : value
  if (!parsed) return ''
  if (typeof parsed === 'string') return parsed

  const finalVisible = getJsonPath(parsed, ['result', 'meta', 'finalAssistantVisibleText'])
  if (typeof finalVisible === 'string') return finalVisible
  const finalRaw = getJsonPath(parsed, ['result', 'meta', 'finalAssistantRawText'])
  if (typeof finalRaw === 'string') return finalRaw
  const payloads = getJsonPath(parsed, ['result', 'payloads'])
  if (Array.isArray(payloads)) {
    return payloads
      .map((payload) => isPlainObject(payload) && typeof payload.text === 'string' ? payload.text : '')
      .filter(Boolean)
      .join('\n\n')
  }
  const summary = getJsonPath(parsed, ['summary'])
  return typeof summary === 'string' ? summary : ''
}

function getJsonPath(value: unknown, path: string[]): unknown {
  let current = value
  for (const part of path) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

function mergeSettings(raw: Record<string, unknown> | undefined): OpenClawSettings {
  const input = (raw ?? {}) as Partial<OpenClawSettings>
  const requestedBinary = typeof input.binaryPath === 'string'
    ? input.binaryPath
    : DEFAULT_SETTINGS.binaryPath
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    binaryPath: resolveOpenClawBinary(requestedBinary),
  }
}

function isExecutable(path: string | undefined): path is string {
  if (!path) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOpenClawBinary(): string | null {
  const candidates = [
    process.env.OPENCLAW_PATH,
    ...((process.env.PATH ?? '').split(':').filter(Boolean).map(dir => join(dir, 'openclaw'))),
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
  ]

  return candidates.find(isExecutable) ?? null
}

function resolveOpenClawBinary(requested: string): string {
  if (isExecutable(requested)) return requested
  return findOpenClawBinary() ?? requested
}

function openClawChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Agents invoke Bakin tools through mcporter. Image generation routinely
    // exceeds mcporter's 60s default, so keep the transport aligned with the
    // adapter's image process budget while respecting explicit operator config.
    MCPORTER_CALL_TIMEOUT: process.env.MCPORTER_CALL_TIMEOUT || String(BAKIN_MCPORTER_CALL_TIMEOUT_MS),
  }
}

function writeOpenClawConfig(config: Record<string, unknown>): void {
  mkdirSync(getOpenClawHome(), { recursive: true })
  writeFileSync(getOpenClawPath('openclaw.json'), JSON.stringify(config, null, 2), 'utf-8')
  resetOpenClawConfigCache()
}

function agentModelPrimary(model: OpenClawAgent['model']): string | undefined {
  if (typeof model === 'string') return model
  return model?.primary
}

function openClawAgentsList(config: OpenClawConfig): OpenClawAgent[] {
  config.agents ??= {}
  config.agents.list ??= []
  return config.agents.list
}

function upsertOpenClawAgentConfig(input: {
  id: string
  name: string
  workspace: string
  model?: string
  emoji?: string
}): void {
  const config: OpenClawConfig = readOpenClawConfig() ?? {}
  const list = openClawAgentsList(config)
  const existing = list.find((agent) => agent.id === input.id)
  const agentDir = getOpenClawPath('agents', input.id, 'agent')
  const identity = input.name || input.emoji
    ? {
        ...(existing?.identity ?? {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
      }
    : existing?.identity

  if (!existing && list.length === 0 && input.id !== 'main') {
    list.push({ id: 'main' })
  }

  const next = {
    ...(existing ?? { id: input.id }),
    name: input.name,
    workspace: input.workspace,
    agentDir,
    ...(input.model ? { model: input.model } : {}),
    ...(identity ? { identity } : {}),
  }

  if (existing) Object.assign(existing, next)
  else list.push(next)

  mkdirSync(agentDir, { recursive: true })
  mkdirSync(join(agentDir, 'sessions'), { recursive: true })
  mkdirSync(input.workspace, { recursive: true })
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function updateOpenClawAgentIdentity(agentId: string, input: { name?: string; emoji?: string }): void {
  const config = readOpenClawConfig()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  agent.identity = {
    ...(agent.identity ?? {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.emoji ? { emoji: input.emoji } : {}),
  }
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function updateAgentAllowlist(agentId: string, updater: (current: string[]) => string[]): void {
  const config = readOpenClawConfig()
  const agent = agentId === 'main' && config
    ? materializeImplicitMainAgent(config)
    : config?.agents?.list?.find((entry) => entry.id === agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  agent.subagents ??= {}
  agent.subagents.allowAgents = updater(agent.subagents.allowAgents ?? [])
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function removeOpenClawAgentConfig(agentId: string): void {
  const config = readOpenClawConfig()
  const agents = config?.agents?.list
  if (!config?.agents || !agents) return

  let changed = false
  const filtered = agents.filter((agent) => agent.id !== agentId)
  if (filtered.length !== agents.length) {
    config.agents.list = filtered
    changed = true
  }

  for (const agent of config.agents.list ?? []) {
    const allowAgents = agent.subagents?.allowAgents
    if (!allowAgents?.includes(agentId)) continue
    agent.subagents!.allowAgents = allowAgents.filter((id) => id !== agentId)
    changed = true
  }

  if (changed) writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function removeOpenClawAgentArtifacts(agentId: string, workspace: string): void {
  removeOpenClawOwnedPath(workspace)
  removeOpenClawOwnedPath(getOpenClawPath('agents', agentId))
}

function removeOpenClawAgentCronArtifacts(agentId: string): void {
  const store = readCronStore()
  const jobs = store.jobs ?? []
  const removedJobIds = new Set<string>()
  const keptJobs = jobs.filter((job) => {
    const matches = job.agentId === agentId
      || job.sessionTarget === agentId
      || job.sessionTarget === `agent:${agentId}`
    if (matches && job.id) removedJobIds.add(job.id)
    return !matches
  })
  if (keptJobs.length === jobs.length) return

  writeCronStore({ ...store, jobs: keptJobs })
  for (const jobId of removedJobIds) {
    removeOpenClawOwnedPath(getOpenClawPath('cron', 'runs', `${jobId}.jsonl`))
  }
}

function removeOpenClawOwnedPath(path: string | undefined): void {
  if (!path) return
  const home = resolve(getOpenClawHome())
  const target = resolve(path)
  if (target === home || !target.startsWith(`${home}${sep}`)) return
  rmSync(target, { recursive: true, force: true })
}

function splitChannelRef(channelId: string, metadata: RuntimeMetadata | undefined): { channel: string; target?: string } {
  const explicitTarget = metadataValue(metadata, 'target') ?? metadataValue(metadata, 'channelTarget')
  if (explicitTarget) return { channel: channelId, target: explicitTarget }
  const [channel, ...targetParts] = channelId.split(':')
  if (channel && targetParts.length > 0) return { channel, target: targetParts.join(':') }
  return { channel: channelId }
}

function openClawMessageSendArgs(
  ref: { channel: string; target?: string },
  message: { body: string; title?: string; threadId?: string; metadata?: RuntimeMetadata },
  files: Array<{ name: string; path: string; contentType?: string }>,
): string[] {
  const args = ['message', 'send', '--channel', ref.channel]
  if (ref.target) args.push('--target', ref.target)
  const body = [message.title, message.body].filter(Boolean).join('\n\n')
  if (body) args.push('--message', body)
  if (message.threadId) args.push('--thread-id', message.threadId)
  for (const file of files) args.push('--media', file.path)
  args.push('--json')
  return args
}

function deliveryRefFromOpenClawOutput(stdout: string): string | null {
  const value = parseOpenClawDeliveryOutput(stdout)
  const id = firstStringAtPaths(value, [
    ['messageId'],
    ['message_id'],
    ['id'],
    ['message', 'id'],
    ['result', 'messageId'],
    ['result', 'message_id'],
    ['result', 'id'],
    ['result', 'message', 'id'],
    ['delivery', 'messageId'],
    ['delivery', 'message_id'],
    ['delivery', 'id'],
    ['delivery', 'message', 'id'],
  ])
  return id ? `message:${id}` : null
}

function parseOpenClawDeliveryOutput(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim()
  if (!text) return null
  return parseJsonObject(text)
    ?? parseJsonObject(text.split('\n').reverse().find(part => part.trim().startsWith('{') && part.trim().endsWith('}')) ?? '')
}

function firstStringAtPaths(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const found = stringAtPath(value, path)
    if (found) return found
  }
  return null
}

function stringAtPath(value: unknown, path: string[]): string | null {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null
}

function readChannelInfos(): ChannelInfo[] {
  const config = readOpenClawConfig() as { channels?: unknown } | null
  const channels = config?.channels
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return []

  return Object.entries(channels as Record<string, unknown>).map(([id, raw]): ChannelInfo => {
    const entry = isRecord(raw) ? raw : {}
    const interactive = channelEntrySupportsInteractiveApproval(id, entry)
    const capabilities: ChannelInfo['capabilities'] = ['message', 'rich-content']
    if (interactive) capabilities.push('interactive-approval')
    return {
      id,
      platform: typeof entry.platform === 'string' ? entry.platform : id,
      label: typeof entry.label === 'string' ? entry.label : humanizeChannelId(id),
      capabilities,
      metadata: {
        approvalResponses: interactive ? 'interactive' : 'render-only',
        approvalMode: interactive ? 'openclaw-plugin-approval' : 'render-only',
        ...(interactive
          ? {
              approvalTimeoutMs: OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS,
              rejectReason: 'bakin-fallback-link',
            }
          : {}),
      },
    }
  })
}

function hasAnyInteractiveApprovalChannel(): boolean {
  return readChannelInfos().some(channel => channel.capabilities.includes('interactive-approval'))
}

function channelHasInteractiveApproval(channelId: string): boolean {
  const ref = splitChannelRef(channelId, undefined)
  return readChannelInfos().some(channel => (
    channel.id === ref.channel && channel.capabilities.includes('interactive-approval')
  ))
}

function channelEntrySupportsInteractiveApproval(id: string, entry: Record<string, unknown>): boolean {
  if (entry.enabled === false) return false
  const provider = typeof entry.platform === 'string' ? entry.platform : id
  if (!NATIVE_APPROVAL_PROVIDERS.has(provider)) return false

  const approvalConfig = isRecord(entry.execApprovals)
    ? entry.execApprovals
    : isRecord(entry.approvals)
      ? entry.approvals
      : null
  if (!approvalConfig) return false
  const enabled = approvalConfig.enabled
  if (!(enabled === true || enabled === 'auto')) return false

  const eventKinds = approvalConfig.eventKinds
  if (Array.isArray(eventKinds) && !eventKinds.includes('plugin')) return false
  return true
}

function gatewayWebSocketUrl(settings: OpenClawSettings): string {
  const url = new URL(`${settings.gatewayUrl}:${settings.gatewayPort}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/$/, '')
}

function renderNativeApprovalDescription(body: string, approvalUrl: string | undefined): string {
  const compactBody = body.replace(/\s+/g, ' ').trim()
  const footer = [
    approvalUrl ? `Bakin fallback: ${approvalUrl}` : undefined,
    NATIVE_APPROVAL_NOTICE,
  ].filter(Boolean).join('\n\n')
  if (!footer) return truncate(compactBody, 256)
  const bodyLimit = 256 - footer.length - 2
  const bodyPart = bodyLimit > 20 ? truncate(compactBody, bodyLimit) : undefined
  return [bodyPart, footer].filter(Boolean).join('\n\n').slice(0, 256)
}

function approvalNoticeForMessage(channelId: string, context: RuntimeMetadata): string {
  return channelHasInteractiveApproval(channelId) && requiresRejectReason(context)
    ? REJECT_REASON_APPROVAL_NOTICE
    : RENDER_ONLY_APPROVAL_NOTICE
}

function supportsNativeApprovalOptions(options: Array<{ id: string }>): boolean {
  const ids = new Set(options.map(option => option.id))
  return ids.size === 2 && ids.has('approve') && ids.has('reject')
}

function requiresRejectReason(context: RuntimeMetadata | undefined): boolean {
  return context?.requireRejectReason === true
}

function approvalEventFromOpenClawPayload(payload: OpenClawPluginApprovalResolvedPayload): ApprovalResolveEvent | null {
  const request = payload.request
  if (!request) return null
  if (request.pluginId !== OPENCLAW_PLUGIN_ID) return null
  if (request.toolName !== OPENCLAW_WORKFLOW_GATE_TOOL) return null
  const approvalId = typeof request.toolCallId === 'string' ? request.toolCallId : ''
  if (!approvalId) return null

  const selectedOption = bakinOptionFromOpenClawDecision(payload.decision)
  if (!selectedOption) return null

  const actorId = payload.resolvedBy?.trim() || 'openclaw-channel'
  return {
    approvalId,
    channelId: channelIdFromOpenClawRequest(request),
    response: {
      selectedOption,
      respondedAt: typeof payload.ts === 'number' ? new Date(payload.ts).toISOString() : new Date().toISOString(),
      actor: {
        type: 'human',
        id: actorId,
        displayName: actorId,
      },
    },
  }
}

function channelIdFromOpenClawRequest(request: Record<string, unknown>): string {
  const channel = typeof request.turnSourceChannel === 'string' && request.turnSourceChannel.length > 0
    ? request.turnSourceChannel
    : 'runtime-channel'
  const target = typeof request.turnSourceTo === 'string' && request.turnSourceTo.length > 0
    ? request.turnSourceTo
    : undefined
  return target ? `${channel}:${target}` : channel
}

function openClawDecisionFromBakinOption(option: string): OpenClawPluginApprovalDecision | null {
  if (option === 'approve') return 'allow-once'
  if (option === 'reject') return 'deny'
  return null
}

function bakinOptionFromOpenClawDecision(decision: string | undefined): 'approve' | 'reject' | null {
  if (decision === 'allow-once' || decision === 'allow-always') return 'approve'
  if (decision === 'deny') return 'reject'
  return null
}

function parseNativeApprovalRef(ref: string): string | null {
  return ref.startsWith(OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX)
    ? ref.slice(OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX.length)
    : null
}

function isExpectedNativeApprovalResolveMiss(message: string): boolean {
  return /expired|not found|unknown/i.test(message)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, maxLength)
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function humanizeChannelId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || id
}

function metadataValue(metadata: RuntimeMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function metadataFiles(metadata: RuntimeMetadata | undefined): Array<{ name: string; path: string; contentType?: string }> {
  const value = metadata?.files
  if (!Array.isArray(value)) return []
  const files: Array<{ name: string; path: string; contentType?: string }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const file = entry as Record<string, unknown>
    if (typeof file.name !== 'string' || typeof file.path !== 'string') continue
    files.push({
      name: file.name,
      path: file.path,
      ...(typeof file.contentType === 'string' ? { contentType: file.contentType } : {}),
    })
  }
  return files
}

function readCronStore(): OpenClawCronStore {
  try {
    const path = getOpenClawPath('cron', 'jobs.json')
    if (!existsSync(path)) return { version: 1, jobs: [] }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawCronStore
    return { version: parsed.version ?? 1, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
  } catch {
    return { version: 1, jobs: [] }
  }
}

function writeCronStore(store: OpenClawCronStore): void {
  const path = getOpenClawPath('cron', 'jobs.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: store.version ?? 1, jobs: store.jobs ?? [] }, null, 2), 'utf-8')
}

function readCronJobs(): OpenClawCronStoreJob[] {
  return readCronStore().jobs ?? []
}

function cronStoreJobToRuntime(job: OpenClawCronStoreJob): CronJob {
  const scheduleTz = typeof job.schedule === 'object' && typeof job.schedule.tz === 'string' && job.schedule.tz.length > 0
    ? job.schedule.tz
    : undefined
  const metadata = scheduleTz && !metadataValue(job.metadata, 'tz')
    ? { ...(job.metadata ?? {}), tz: scheduleTz }
    : job.metadata
  const command = typeof job.payload?.message === 'string'
    ? job.payload.message
    : typeof job.payload?.text === 'string'
      ? job.payload.text
      : ''
  return {
    id: job.id,
    name: job.name ?? job.id,
    schedule: cronScheduleToString(job.schedule),
    command,
    enabled: job.enabled ?? true,
    toolsAllow: normalizeCronToolsAllow(job.payload?.toolsAllow),
    metadata,
  }
}

function cronCreateArgs(input: CreateCronJobInput): string[] {
  const args = [
    'cron',
    'add',
    '--name',
    input.name,
    '--cron',
    input.schedule,
    '--wake',
    'now',
    '--json',
    '--timeout',
    String(OPENCLAW_CRON_TIMEOUT_MS),
  ]
  const tz = metadataValue(input.metadata, 'tz')
  if (tz) args.push('--tz', tz)
  if (input.enabled === false) args.push('--disabled')
  appendCronPayloadArgs(args, input.command, input.metadata, input.toolsAllow, { allowClearTools: false })
  return args
}

function cronUpdateArgs(id: string, current: CronJob, patch: UpdateCronJobInput): string[] {
  const args = ['cron', 'edit', id, '--timeout', String(OPENCLAW_CRON_TIMEOUT_MS)]
  if (patch.name !== undefined) args.push('--name', patch.name)
  if (patch.schedule !== undefined) args.push('--cron', patch.schedule)
  if (patch.enabled === true) args.push('--enable')
  if (patch.enabled === false) args.push('--disable')

  const metadata = patch.metadata ?? current.metadata
  const tz = metadataValue(metadata, 'tz')
  if (patch.metadata !== undefined && tz) args.push('--tz', tz)

  if (patch.command !== undefined || patch.metadata !== undefined || patch.toolsAllow !== undefined) {
    appendCronPayloadArgs(args, patch.command ?? current.command, metadata, patch.toolsAllow)
  }

  return args
}

function appendCronPayloadArgs(
  args: string[],
  command: string,
  _metadata: RuntimeMetadata | undefined,
  toolsAllow: string[] | null | undefined,
  opts: { allowClearTools?: boolean } = {},
): void {
  args.push('--session', 'isolated', '--message', command)
  if (toolsAllow === undefined) return

  const normalized = normalizeCronToolsAllow(toolsAllow)
  if (normalized) {
    args.push('--tools', normalized.join(','))
  } else if (opts.allowClearTools !== false) {
    args.push('--clear-tools')
  }
}

function cronJobFromInput(id: string, input: CreateCronJobInput): CronJob {
  return {
    id,
    name: input.name,
    schedule: input.schedule,
    command: input.command,
    enabled: input.enabled ?? true,
    toolsAllow: normalizeCronToolsAllow(input.toolsAllow),
    metadata: input.metadata,
  }
}

function cronJobFromUpdatePatch(id: string, current: CronJob, patch: UpdateCronJobInput): CronJob {
  const command = patch.command ?? current.command
  const metadata = patch.metadata ?? current.metadata
  const toolsAllow = patch.toolsAllow === null
    ? undefined
    : patch.toolsAllow !== undefined
      ? normalizeCronToolsAllow(patch.toolsAllow)
      : current.toolsAllow

  return {
    id,
    name: patch.name ?? current.name,
    schedule: patch.schedule ?? current.schedule,
    command,
    enabled: patch.enabled ?? current.enabled,
    toolsAllow,
    metadata,
  }
}

function withCronInputFallbacks(raw: OpenClawCronStoreJob, id: string, input: CreateCronJobInput): OpenClawCronStoreJob {
  return {
    ...raw,
    id,
    name: raw.name ?? input.name,
    enabled: raw.enabled ?? input.enabled ?? true,
    schedule: raw.schedule ?? { kind: 'cron', expr: input.schedule },
    payload: raw.payload ?? cronPayloadForCommand(input.command, undefined),
    metadata: raw.metadata ?? input.metadata,
  }
}

function cronPayloadForCommand(
  command: string,
  current: OpenClawCronStoreJob['payload'],
): OpenClawCronStoreJob['payload'] {
  if (current?.kind === 'systemEvent') {
    return { kind: 'systemEvent', text: command }
  }
  return { ...(current ?? {}), kind: 'agentTurn', message: command }
}

function normalizeCronToolsAllow(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const tools: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tool = entry.trim()
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    tools.push(tool)
  }
  return tools.length > 0 ? tools : undefined
}

function cronScheduleToString(schedule: OpenClawCronStoreJob['schedule']): string {
  if (typeof schedule === 'string') return schedule
  return schedule?.expr ?? schedule?.value ?? '* * * * *'
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function extractCronStoreJobs(raw: string | unknown): OpenClawCronStoreJob[] {
  const parsed = typeof raw === 'string' ? parseJsonValue(raw) : raw
  const candidates = cronJobCandidates(parsed)
  return candidates
    .map(normalizeOpenClawCronStoreJob)
    .filter((job): job is OpenClawCronStoreJob => job !== null)
}

function extractCronStoreJob(raw: unknown): OpenClawCronStoreJob | null {
  return extractCronStoreJobs(raw)[0] ?? null
}

function cronJobCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return []

  for (const key of ['jobs', 'items', 'results', 'data']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
  }

  for (const key of ['job', 'cronJob', 'result', 'payload']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
    if (isPlainObject(candidate)) {
      const nested = cronJobCandidates(candidate)
      if (nested.length > 0) return nested
      if (typeof candidate.id === 'string') return [candidate]
    }
  }

  return typeof value.id === 'string' ? [value] : []
}

function normalizeOpenClawCronStoreJob(value: unknown): OpenClawCronStoreJob | null {
  if (!isPlainObject(value)) return null
  const id = firstString(value.id, value.jobId, value.key)
  if (!id) return null

  const rawSchedule = value.schedule
  const schedule = typeof rawSchedule === 'string' || isPlainObject(rawSchedule)
    ? rawSchedule as OpenClawCronStoreJob['schedule']
    : firstString(value.cron, value.expr)
      ? { kind: 'cron', expr: firstString(value.cron, value.expr), tz: firstString(value.tz, value.timezone) }
      : undefined

  const rawPayload = isPlainObject(value.payload) ? value.payload : undefined
  const systemEvent = firstString(value.systemEvent)
  const message = firstString(value.message, value.command)
  const rawTools = rawPayload?.toolsAllow ?? value.toolsAllow ?? value.tools
  const toolsAllow = normalizeCronToolsAllow(Array.isArray(rawTools) ? rawTools : typeof rawTools === 'string' ? rawTools.split(/[,\s]+/) : undefined)
  const payload = rawPayload
    ? {
        ...rawPayload,
        ...(toolsAllow ? { toolsAllow } : {}),
      } as OpenClawCronStoreJob['payload']
    : systemEvent
      ? { kind: 'systemEvent', text: systemEvent }
      : message
        ? {
            kind: 'agentTurn',
            message,
            ...(toolsAllow ? { toolsAllow } : {}),
          }
        : undefined

  return {
    id,
    ...(typeof value.agentId === 'string' ? { agentId: value.agentId } : {}),
    ...(typeof value.sessionKey === 'string' ? { sessionKey: value.sessionKey } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.deleteAfterRun === 'boolean' ? { deleteAfterRun: value.deleteAfterRun } : {}),
    ...(schedule ? { schedule } : {}),
    ...(typeof value.sessionTarget === 'string' ? { sessionTarget: value.sessionTarget } : {}),
    ...(typeof value.wakeMode === 'string' ? { wakeMode: value.wakeMode } : {}),
    ...(isPlainObject(value.delivery) ? { delivery: value.delivery as OpenClawCronStoreJob['delivery'] } : {}),
    ...(payload ? { payload } : {}),
    ...(value.failureAlert !== undefined ? { failureAlert: value.failureAlert } : {}),
    ...(isPlainObject(value.state) ? { state: value.state } : {}),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.createdAtMs === 'number' ? { createdAtMs: value.createdAtMs } : {}),
    ...(typeof value.updatedAtMs === 'number' ? { updatedAtMs: value.updatedAtMs } : {}),
    ...(isPlainObject(value.metadata) ? { metadata: value.metadata as RuntimeMetadata } : {}),
  }
}

function cronJobIdFromCliResult(value: unknown): string | undefined {
  return firstString(
    getJsonPath(value, ['id']),
    getJsonPath(value, ['jobId']),
    getJsonPath(value, ['job', 'id']),
    getJsonPath(value, ['cronJob', 'id']),
    getJsonPath(value, ['payload', 'id']),
    getJsonPath(value, ['payload', 'job', 'id']),
    getJsonPath(value, ['result', 'id']),
    getJsonPath(value, ['result', 'job', 'id']),
  )
}

function extractCronRuns(raw: string, jobId: string): CronRun[] {
  const parsed = parseJsonValue(raw)
  const candidates = cronRunCandidates(parsed)
  const source = candidates.length > 0 ? candidates : parseJsonLines(raw)
  const runs = source
    .map((entry) => normalizeOpenClawCronRun(entry, jobId))
    .filter((run): run is CronRun => run !== null)
  runs.sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
  return runs
}

function cronRunCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return []
  for (const key of ['runs', 'items', 'results', 'data']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
  }
  const payload = value.payload
  if (Array.isArray(payload)) return payload
  if (isPlainObject(payload)) return cronRunCandidates(payload)
  return typeof value.runId === 'string' || typeof value.id === 'string' ? [value] : []
}

function parseJsonLines(raw: string): unknown[] {
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    const parsed = parseJsonValue(line)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

function normalizeOpenClawCronRun(value: unknown, requestedJobId: string): CronRun | null {
  if (!isPlainObject(value)) return null
  const runJobId = firstString(value.jobId, value.cronJobId) ?? requestedJobId
  if (runJobId !== requestedJobId) return null
  return {
    id: firstString(value.runId, value.id) ?? `run-${Date.now()}`,
    jobId: requestedJobId,
    status: normalizeCronRunStatus(firstString(value.status)),
    startedAt: firstString(value.startedAt, value.timestamp, value.createdAt),
    endedAt: firstString(value.endedAt, value.finishedAt),
    output: firstString(value.output, value.stdout),
    error: firstString(value.error, value.stderr),
  }
}

function readCronRuns(jobId: string, limit = 50): CronRun[] {
  const path = getOpenClawPath('cron', 'runs', `${jobId}.jsonl`)
  if (!existsSync(path)) return []
  const entries: CronRun[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as OpenClawCronRunEntry
      if (!entry.jobId || entry.jobId !== jobId) continue
      entries.push({
        id: entry.runId ?? entry.id ?? `run-${entries.length + 1}`,
        jobId,
        status: normalizeCronRunStatus(entry.status),
        startedAt: entry.startedAt ?? entry.timestamp,
        endedAt: entry.endedAt,
        output: entry.output,
        error: entry.error,
      })
    } catch {
      // skip malformed run rows
    }
  }
  entries.sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
  return entries.slice(0, limit)
}

function normalizeCronRunStatus(status: string | undefined): CronRun['status'] {
  switch (status) {
    case 'queued':
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
      return status
    case 'success':
      return 'succeeded'
    case 'failure':
      return 'failed'
    default:
      return 'succeeded'
  }
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    out[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(source: Record<string, unknown>, key: string): unknown {
  let current: unknown = source
  for (const part of key.split('.')) {
    if (!isPlainObject(current) || !(part in current)) return undefined
    current = current[part]
  }
  return current
}

// Exported for tests — pure stream-merging helper with no adapter state.
export async function* mergeChatStreams(
  primary: AsyncIterable<ChatChunk>,
  secondary: AsyncIterable<ChatChunk>,
  stopSecondary: () => void,
): AsyncIterable<ChatChunk> {
  type QueueItem =
    | { source: 'primary' | 'secondary'; chunk: ChatChunk }
    | { source: 'primary' | 'secondary'; done: true }
    | { source: 'primary' | 'secondary'; error: unknown }

  const queue: QueueItem[] = []
  let notify: (() => void) | null = null
  const push = (item: QueueItem): void => {
    queue.push(item)
    notify?.()
    notify = null
  }

  const pump = async (source: 'primary' | 'secondary', iterable: AsyncIterable<ChatChunk>): Promise<void> => {
    try {
      for await (const chunk of iterable) {
        if (source === 'primary' && chunk.type === 'done') {
          push({ source, done: true })
          return
        }
        push({ source, chunk })
      }
      push({ source, done: true })
    } catch (error) {
      // The secondary (session-activity poller) is advisory — a poller
      // hiccup must never abort a live turn and mask the primary result.
      // Degrade to "secondary done"; primary errors still propagate.
      if (source === 'secondary') {
        push({ source, done: true })
        return
      }
      push({ source, error })
    }
  }

  void pump('primary', primary)
  void pump('secondary', secondary)

  // finally-guarded: if the consumer abandons the stream (early break /
  // generator return), the suspended yield exits through here — without it
  // the 200ms session-activity poller leaks and spins forever (audit C2).
  try {
    let primaryDone = false
    let secondaryDone = false
    while (!primaryDone || !secondaryDone) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => { notify = resolve })
      }
      const item = queue.shift()
      if (!item) continue
      if ('error' in item) {
        throw item.error
      }
      if ('done' in item) {
        if (item.source === 'primary') {
          primaryDone = true
          stopSecondary()
        } else {
          secondaryDone = true
        }
        continue
      }
      yield item.chunk
    }

    yield { type: 'done' }
  } finally {
    stopSecondary()
  }
}

async function* watchOpenClawSessionActivity(
  agentId: string,
  sessionKey: string,
  cursor: OpenClawSessionActivityCursor,
  signal: AbortSignal,
): AsyncIterable<ChatChunk> {
  while (true) {
    for (const chunk of readOpenClawSessionActivity(agentId, sessionKey, cursor)) {
      yield chunk
    }
    if (signal.aborted) break
    await sleep(OPENCLAW_SESSION_ACTIVITY_POLL_MS)
  }

  for (const chunk of readOpenClawSessionActivity(agentId, sessionKey, cursor)) {
    yield chunk
  }
}

function createOpenClawSessionActivityCursor(agentId: string, sessionKey: string): OpenClawSessionActivityCursor {
  const sessionFile = resolveOpenClawSessionFile(agentId, sessionKey)
  return {
    sessionFile,
    offset: sessionFile ? safeFileSize(sessionFile) : 0,
    partial: '',
  }
}

function readOpenClawSessionActivity(
  agentId: string,
  sessionKey: string,
  cursor: OpenClawSessionActivityCursor,
): ChatChunk[] {
  if (!cursor.sessionFile) {
    cursor.sessionFile = resolveOpenClawSessionFile(agentId, sessionKey)
    cursor.offset = 0
    cursor.partial = ''
  }
  if (!cursor.sessionFile) return []

  const next = readFileTail(cursor.sessionFile, cursor.offset)
  if (!next) return []
  cursor.offset = next.offset

  const text = cursor.partial + next.text
  const lines = text.split('\n')
  cursor.partial = lines.pop() ?? ''

  const chunks: ChatChunk[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseJsonObject(trimmed)
    if (parsed) chunks.push(...activityChunksFromOpenClawTranscriptRecord(parsed))
  }
  return chunks
}

// sessions.json grows one entry (with a full skillsSnapshot) per session and
// per-dispatch sessions accumulate steadily — cache the parsed store behind
// an mtime guard so resolution stays O(1) between writes. LRU-capped: each
// entry holds a fully-parsed store, and the Map previously grew without
// bound (one entry per store path, never evicted).
export const SESSION_STORE_CACHE_MAX = 64
const sessionStoreCache = new Map<string, { mtimeMs: number; store: Record<string, OpenClawSessionStoreEntry> | null }>()

function readSessionStoreCached(storePath: string): Record<string, OpenClawSessionStoreEntry> | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(storePath).mtimeMs
  } catch {
    sessionStoreCache.delete(storePath)
    return null
  }
  const hit = sessionStoreCache.get(storePath)
  if (hit && hit.mtimeMs === mtimeMs) {
    // Map preserves insertion order — delete + re-set marks recency.
    sessionStoreCache.delete(storePath)
    sessionStoreCache.set(storePath, hit)
    return hit.store
  }
  const store = readJsonFile<Record<string, OpenClawSessionStoreEntry>>(storePath)
  sessionStoreCache.delete(storePath)
  sessionStoreCache.set(storePath, { mtimeMs, store })
  while (sessionStoreCache.size > SESSION_STORE_CACHE_MAX) {
    const oldest = sessionStoreCache.keys().next().value
    if (oldest === undefined) break
    sessionStoreCache.delete(oldest)
  }
  return store
}

/** @internal Test-only. */
export function __readSessionStoreCachedForTest(storePath: string): Record<string, OpenClawSessionStoreEntry> | null {
  return readSessionStoreCached(storePath)
}

/** @internal Test-only. */
export function __sessionStoreCacheKeysForTest(): string[] {
  return [...sessionStoreCache.keys()]
}

/** @internal Test-only. */
export function __resetSessionStoreCacheForTest(): void {
  sessionStoreCache.clear()
}

function resolveOpenClawSessionFile(agentId: string, sessionKey: string): string | undefined {
  const storePath = join(getOpenClawHome(), 'agents', agentId, 'sessions', 'sessions.json')
  const store = readSessionStoreCached(storePath)
  const entry = findOpenClawSessionStoreEntry(store, agentId, sessionKey)
  if (!entry) return undefined
  if (typeof entry.sessionFile === 'string' && entry.sessionFile.length > 0) return entry.sessionFile
  if (typeof entry.sessionId === 'string' && entry.sessionId.length > 0) {
    return join(getOpenClawHome(), 'agents', agentId, 'sessions', `${entry.sessionId}.jsonl`)
  }
  return undefined
}

function findOpenClawSessionStoreEntry(
  store: Record<string, OpenClawSessionStoreEntry> | null,
  agentId: string,
  sessionKey: string,
): OpenClawSessionStoreEntry | undefined {
  if (!store) return undefined
  const cliSessionId = openClawCliSessionId(agentId, sessionKey)
  return store[sessionKey]
    ?? store[cliSessionId]
    ?? store[`agent:${agentId}:explicit:${cliSessionId}`]
    ?? store[`agent:${agentId}:${cliSessionId}`]
}

function openClawCliSessionId(agentId: string, sessionKey: string): string {
  if (isOpenClawCliSessionId(sessionKey)) return sessionKey
  return deterministicUuid(`bakin:${agentId}:${sessionKey}`)
}

function isOpenClawCliSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  const variant = Number.parseInt(hex[16] ?? '0', 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const id = hex.join('')
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

/**
 * Session-activity tail semantics over the shared readFileFrom:
 * rewind-to-0 on truncation/rotation; null when there are no new bytes.
 */
function readFileTail(path: string, offset: number): { text: string; offset: number } | null {
  const read = readFileFrom(path, offset, { rewindOnTruncate: true })
  if (!read || read.text === '') return null
  return { text: read.text, offset: read.nextOffset }
}

function activityChunksFromOpenClawTranscriptRecord(record: Record<string, unknown>): ChatChunk[] {
  if (record.type !== 'message') return []
  const message = record.message
  if (!isPlainObject(message)) return []
  const role = message.role
  if (role === 'assistant') return activityChunksFromAssistantMessage(message)
  if (role === 'toolResult') return activityChunkFromToolResultMessage(message)
  return []
}

function activityChunksFromAssistantMessage(message: Record<string, unknown>): ChatChunk[] {
  const content = Array.isArray(message.content) ? message.content : []
  const chunks: ChatChunk[] = []
  for (const part of content) {
    if (!isPlainObject(part) || part.type !== 'toolCall') continue
    const name = typeof part.name === 'string' && part.name.length > 0 ? part.name : 'tool'
    const args = part.arguments
    const summary = firstString(part.summary, part.purpose, part.displayLabel)
      ?? summarizeOpenClawToolPurpose(name, args)
    chunks.push({
      type: 'tool',
      content: summarizeOpenClawToolCall(name, args),
      data: {
        phase: 'call',
        callId: typeof part.id === 'string' ? part.id : undefined,
        toolName: name,
        status: 'running',
        ...(summary ? { summary } : {}),
        inputPreview: previewUnknown(args),
      },
    })
  }
  return chunks
}

function activityChunkFromToolResultMessage(message: Record<string, unknown>): ChatChunk[] {
  const toolName = typeof message.toolName === 'string' && message.toolName.length > 0 ? message.toolName : 'tool'
  const details = isPlainObject(message.details) ? message.details : {}
  const status = typeof details.status === 'string' ? details.status : undefined
  const label = status ? `${toolName} ${status}` : `${toolName} finished`
  return [{
    type: 'tool',
      content: label,
      data: {
        phase: 'result',
        toolName,
        callId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
        status: normalizeToolResultStatus(status, typeof details.exitCode === 'number' ? details.exitCode : undefined),
        exitCode: typeof details.exitCode === 'number' ? details.exitCode : undefined,
        durationMs: typeof details.durationMs === 'number' ? details.durationMs : undefined,
        outputPreview: previewUnknown(message.content),
      },
  }]
}

function normalizeToolResultStatus(status: string | undefined, exitCode: number | undefined): string {
  if (status && status.length > 0) return status
  if (typeof exitCode === 'number') return exitCode === 0 ? 'completed' : 'failed'
  return 'completed'
}

function summarizeOpenClawToolCall(name: string, args: unknown): string {
  if (isPlainObject(args)) {
    const command = args.command
    if (name === 'exec' && typeof command === 'string' && command.trim()) {
      return `exec: ${firstLine(command)}`
    }
    const path = args.path
    if (name === 'read' && typeof path === 'string' && path.trim()) {
      return `read: ${truncateMiddle(path.trim(), 140)}`
    }
    const action = args.action
    if (name === 'process' && typeof action === 'string' && action.trim()) {
      return `process: ${action.trim()}`
    }
  }
  return name
}

function summarizeOpenClawToolPurpose(name: string, args: unknown): string | undefined {
  if (name === 'read' && isPlainObject(args)) {
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    if (!path) return undefined
    if (/\/skills\/[^/]+\/SKILL\.md$/.test(path)) return 'Reading workflow instructions'
    return `Reading ${basenameForDisplay(path)}`
  }

  if (name === 'process' && isPlainObject(args)) {
    const action = typeof args.action === 'string' ? args.action.trim() : ''
    if (action === 'poll') return 'Waiting for command output'
  }

  if (name === 'exec' && isPlainObject(args)) {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    return summarizeShellCommandPurpose(command)
  }

  if (name === 'web_fetch') {
    return summarizeWebFetchPurpose(args)
  }

  return summarizeToolNamePurpose(name)
}

function summarizeShellCommandPurpose(command: string): string | undefined {
  if (!command) return undefined
  const first = command.split(/\r?\n/)[0]?.trim() ?? ''
  if (/\bmcporter\s+call\s+--help\b/.test(first)) return 'Checking Bakin tool call syntax'
  const mcporterCall = first.match(/\bmcporter\s+call\s+([^\s]+)/)
  if (mcporterCall) {
    const tool = mcporterCall[1].split('.').pop() ?? mcporterCall[1]
    return summarizeToolNamePurpose(tool) ?? 'Calling a Bakin tool'
  }
  if (/\bmcporter\s+list\b/.test(first)) return 'Inspecting available Bakin tools'
  if (/\bgh\s+issue\b/.test(first)) return 'Checking GitHub issues'
  if (/\bgh\s+pr\b/.test(first)) return 'Checking GitHub pull requests'
  const bxContextSummary = summarizeBxContextCommand(first)
  if (bxContextSummary) return bxContextSummary
  const fetchedUrl = extractUrlForDisplay(command)
  if (fetchedUrl) return `Fetching ${fetchedUrl}`
  if (/^python3?\s+-\s*<<|^python3?\s+-c\b/.test(first)) return 'Preparing structured tool arguments'
  if (/^cat\s+>\s+\/tmp\//.test(first)) return 'Preparing a temporary helper script'
  return undefined
}

function summarizeBxContextCommand(command: string): string | undefined {
  const match = command.match(/^bx\s+context\s+(.+?)(?:\s+--\S+|$)/)
  if (!match) return undefined
  const topic = cleanShellArgumentForDisplay(match[1])
  const githubReleaseRepo = topic.match(/\bgithub\s+releases?\b.*\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i)
  if (githubReleaseRepo) return `Checking GitHub releases for ${githubReleaseRepo[1]}`
  return topic ? `Looking up ${truncateMiddle(topic, 100)}` : 'Looking up context'
}

function summarizeToolNamePurpose(toolName: string): string | undefined {
  if (/^bakin_exec_projects_get$/.test(toolName)) return 'Reading project details'
  if (/^bakin_exec_projects_apply_plan$/.test(toolName)) return 'Applying confirmed project plan'
  if (/^bakin_exec_projects_update$/.test(toolName)) return 'Updating project details'
  if (/^bakin_exec_projects_add_item$/.test(toolName)) return 'Adding a project checklist item'
  if (/^bakin_exec_projects_(list|search)$/.test(toolName)) return 'Inspecting projects'
  if (/^bakin_exec_messaging_/.test(toolName)) return 'Updating messaging content'
  if (toolName === 'web_fetch') return 'Fetching web content'
  return undefined
}

function summarizeWebFetchPurpose(args: unknown): string {
  const url = extractUrlForDisplay(args)
  return url ? `Fetching ${url}` : 'Fetching web content'
}

function extractUrlForDisplay(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = parseJsonObject(value)
    if (parsed) return extractUrlForDisplay(parsed)
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) return truncateMiddle(redactSensitiveText(trimmed), 140)
    const match = trimmed.match(/https?:\/\/[^\s"'`\\]+/i)
    return match ? truncateMiddle(redactSensitiveText(match[0]), 140) : undefined
  }
  if (!isPlainObject(value)) return undefined
  for (const key of ['url', 'uri', 'href']) {
    const raw = value[key]
    if (typeof raw === 'string' && raw.trim()) {
      return truncateMiddle(redactSensitiveText(raw.trim()), 140)
    }
  }
  return undefined
}

function cleanShellArgumentForDisplay(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function basenameForDisplay(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').pop() || normalized
}

function firstLine(value: string): string {
  return truncateMiddle(redactSensitiveText(value.trim().split(/\r?\n/)[0] ?? ''), 160)
}

function previewUnknown(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  return truncateMiddle(redactSensitiveText(raw ?? ''), OPENCLAW_ACTIVITY_PREVIEW_CHARS)
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const head = Math.max(1, Math.floor((maxChars - 3) * 0.65))
  const tail = Math.max(1, maxChars - 3 - head)
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s"'`]+/gi, '$1[redacted]')
    .replace(/(x-access-token:)[^\s"'`@]+/gi, '$1[redacted]')
    .replace(/([?&][^=\s"'`]*(?:token|password|secret|api[_-]?key)[^=\s"'`]*=)[^&\s"'`]+/gi, '$1[redacted]')
    .replace(/\b([A-Za-z0-9_]*(?:token|password|secret|api[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,"'`}]+)/gi, '$1[redacted]')
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function defaultOpenClawImageOutputPath(format?: string): string {
  const normalized = normalizeOpenClawOutputFormat(format)
  const ext = normalized === 'jpeg' ? 'jpg' : normalized
  return join(mkdtempSync(join(tmpdir(), 'bakin-openclaw-image-')), `image.${ext}`)
}

function normalizeOpenClawOutputFormat(format?: string): string {
  if (format === 'jpg') return 'jpeg'
  if (format === 'jpeg' || format === 'webp' || format === 'png') return format
  return 'png'
}

function openClawImageModelArg(input: Pick<RuntimeImageGenerateInput, 'provider' | 'model'>): string | undefined {
  if (!input.model) return undefined
  if (input.model.includes('/') || !input.provider) return input.model
  return `${input.provider}/${input.model}`
}

function providerFromImageModel(model: string | undefined): string | undefined {
  if (!model?.includes('/')) return undefined
  return model.split('/')[0] || undefined
}

function modelNameFromImageModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const [, ...modelParts] = model.split('/')
  return modelParts.length > 0 ? modelParts.join('/') : model
}

function parseOpenClawImageProviders(raw: string): RuntimeImageProvider[] {
  const parsed = parseJsonValue(raw)
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.providers)
      ? parsed.providers
      : []
  return rows
    .filter(isRecord)
    .map((row): RuntimeImageProvider | null => {
      const id = firstString(row.id)
      if (!id) return null
      const provider: RuntimeImageProvider = { id }
      const label = firstString(row.label)
      if (label) provider.label = label
      const defaultModel = firstString(row.defaultModel)
      if (defaultModel) provider.defaultModel = defaultModel
      if (Array.isArray(row.models)) provider.models = row.models.filter((model): model is string => typeof model === 'string')
      if (typeof row.available === 'boolean') provider.available = row.available
      if (typeof row.configured === 'boolean') provider.configured = row.configured
      if (typeof row.selected === 'boolean') provider.selected = row.selected
      if (isRecord(row.capabilities)) provider.capabilities = row.capabilities as RuntimeImageProvider['capabilities']
      return provider
    })
    .filter((provider): provider is RuntimeImageProvider => provider !== null)
}

function imageQualityFromMetadata(metadata: RuntimeMetadata | undefined): 'draft' | 'standard' | 'premium' {
  const quality = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).quality : undefined
  return quality === 'draft' || quality === 'premium' ? quality : 'standard'
}

/** Tag a natively-served result for operator diagnostics. The shim path sets
 * its own servedBy/credentialSource inline (it knows env vs store). */
function tagRuntimeServed(result: RuntimeImageGenerationResult): RuntimeImageGenerationResult {
  return {
    ...result,
    metadata: { ...(result.metadata ?? {}), servedBy: 'runtime', credentialSource: 'runtime' },
  }
}

function parseOpenClawImageResult(
  raw: string,
  opts: { input: RuntimeImageGenerateInput; outputPath: string },
): RuntimeImageGenerationResult {
  const parsed = parseJsonValue(raw)
  const files = collectOpenClawImageFiles(parsed)
  if (files.length === 0 && existsSync(opts.outputPath)) {
    files.push({ filePath: opts.outputPath, mimeType: imageMimeTypeForPath(opts.outputPath) })
  }
  if (files.length === 0) {
    throw new Error('OpenClaw image inference did not return a saved image file')
  }

  const modelArg = openClawImageModelArg(opts.input)
  const provider = opts.input.provider ?? providerFromImageModel(modelArg)
  const model = modelNameFromImageModel(modelArg)
  const providerText = openClawImageProviderText(parsed)
  return {
    images: files.map(file => ({
      ...file,
      provider: file.provider ?? provider,
      model: file.model ?? model,
    })),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(providerText ? { providerText } : {}),
    metadata: { source: 'openclaw.infer.image' },
  }
}

function collectOpenClawImageFiles(value: unknown): Array<{ filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata }> {
  const out: Array<{ filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata }> = []
  const seen = new Set<string>()

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (!isRecord(current)) return

    const candidate = openClawImageFileCandidate(current)
    if (candidate && !seen.has(candidate.filePath)) {
      seen.add(candidate.filePath)
      out.push(candidate)
    }

    for (const key of ['images', 'files', 'outputs', 'output', 'saved', 'result']) {
      if (key in current) visit(current[key])
    }
  }

  visit(value)
  return out
}

function openClawImageFileCandidate(record: Record<string, unknown>): { filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata } | null {
  const filePath = firstString(record.filePath, record.path, record.outputPath, record.filename)
  if (!filePath || !existsSync(filePath)) return null
  const out: { filePath: string; mimeType?: string; width?: number; height?: number; provider?: string; model?: string; metadata?: RuntimeMetadata } = {
    filePath,
    mimeType: firstString(record.mimeType, record.mime_type, record.contentType) ?? imageMimeTypeForPath(filePath),
  }
  if (typeof record.width === 'number') out.width = record.width
  if (typeof record.height === 'number') out.height = record.height
  const provider = firstString(record.provider)
  if (provider) out.provider = provider
  const model = firstString(record.model)
  if (model) out.model = modelNameFromImageModel(model)
  if (isRecord(record.metadata)) out.metadata = record.metadata as RuntimeMetadata
  return out
}

function imageMimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function openClawImageProviderText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return firstString(value.providerText, value.text, value.message, value.revisedPrompt, value.revised_prompt)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(raw)
  return isPlainObject(parsed) ? parsed : null
}

function parseJsonValue(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function agentToRuntime(agent: NonNullable<ReturnType<typeof findAgentById>>): RuntimeAgent {
  return {
    id: agent.id,
    name: agent.identity?.name ?? agent.name ?? agent.id,
    role: resolveRole(agent.id),
    model: agentModelPrimary(agent.model),
    status: 'active',
    metadata: {
      emoji: agent.identity?.emoji ?? '',
      workspacePath: getWorkspacePath(agent.id),
      subagentAllowAgents: agent.subagents?.allowAgents ?? null,
    },
  }
}

function getWorkspacePath(agentId: string): string {
  const config = readOpenClawConfig()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  if (agent?.workspace) return agent.workspace
  if (agentId === tryGetMainAgentId()) {
    return config?.agents?.defaults?.workspace ?? join(getOpenClawHome(), 'workspace')
  }
  return join(getOpenClawHome(), 'workspaces', agentId)
}

function readGatewayToken(): string | null {
  const config = readOpenClawConfig() as { gateway?: { auth?: { token?: unknown } } } | null
  const token = config?.gateway?.auth?.token
  return typeof token === 'string' && token.length > 0 ? token : null
}

function isSafeWorkspaceFile(path: string): boolean {
  return !path.includes('..') && !path.startsWith('/') && !path.includes('\\')
}

function isSafeSkillFilePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '')
}

function readJsonFile<T = unknown>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function readSkillTree(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs, rel)
      } else if (entry.isFile()) {
        if (entry.name === '.installedBy' || entry.name === '.userEdited') continue
        files[rel] = readFileSync(abs, 'utf-8')
      }
    }
  }
  try {
    walk(root)
  } catch {
    return {}
  }
  return files
}

function readWorkspaceRootFile(agentId: string, filename: string): string | null {
  if (!isSafeWorkspaceFile(filename)) return null
  try {
    return readFileSync(join(getWorkspacePath(agentId), filename), 'utf-8')
  } catch {
    return null
  }
}

function matchIdentityField(identity: string, key: string): string | null {
  const inlineRe = new RegExp(
    `^\\s*[-*]?\\s*\\*{0,2}${key}\\*{0,2}\\s*:\\s*\\*{0,2}\\s*(.+?)\\s*\\*{0,2}\\s*$`,
    'mi',
  )
  const inline = identity.match(inlineRe)
  if (inline) {
    const value = inline[1].trim().replace(/^\*+|\*+$/g, '').trim()
    if (value.length > 0) return value
  }
  const heading = identity.match(new RegExp(`^#{1,6}\\s+${key}\\s*$\\n+([^\\n]+)`, 'mi'))
  if (heading) {
    const value = heading[1].trim().replace(/^\*+|\*+$/g, '').trim()
    if (value.length > 0) return value
  }
  return null
}

function resolveRole(agentId: string): string {
  const identity = readWorkspaceRootFile(agentId, 'IDENTITY.md')
  if (identity) {
    const role = matchIdentityField(identity, 'Role')
    if (role) return role
    const vibe = matchIdentityField(identity, 'Vibe')
    if (vibe) return vibe
  }

  const soul = readWorkspaceRootFile(agentId, 'SOUL.md')
  if (soul) {
    const firstLine = soul.split('\n').find((line) => line.startsWith('You are ') || line.startsWith('# '))
    if (firstLine) {
      const dashPart = firstLine.split('—')[1] || firstLine.split('-')[1]
      if (dashPart) {
        const role = dashPart.replace(/\.\s*$/, '').trim()
        if (role.length > 0 && role.length < 60) return role
      }
    }
  }

  return agentId === tryGetMainAgentId() ? 'Orchestrator' : ''
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `agent-${Date.now()}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
