import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
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
  MessageUsage,
  RuntimeAgent,
  RuntimeAvailableModel,
  RuntimeCapabilities,
  CapabilitySet,
  RuntimeToolAccess,
  RuntimeCredentialStatus,
  RuntimeRoutingPolicy,
  RuntimeRoutingSupport,
  ToolAccessProvisioningStatus,
  UpdateRuntimeAgentInput,
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
  WorkspaceFileStat,
} from '@bakin/core/adapters/runtime'
import type {
  AdapterAuditEvent,
  AdapterInitOpts,
  AdapterLogger,
  AdapterToolActivityEvent,
} from '@bakin/core/adapters/shared'
import {
  applyBakinMcpEntries,
  removeBakinMcpEntries,
  verifyBakinMcpEntries,
  type BakinMcpConfig,
} from './tool-access-provisioning'
import { listConfiguredChannels, listLlmCredentials, listLlmCredentialsViaCli, type LlmCredential } from './credential-status'
import { applyRoutingPolicy, readRoutingPolicy, setAgentModels } from './model-routing'
import { beginAdapterTurnActivity, RuntimeError, RuntimeTurnError } from '@bakin/core/adapters/runtime'
import { tryGetMainAgentId } from './main-agent'
import { buildOpenClawAttachments } from './attachments'
import { safeFileSize } from './file-utils'
import { OPENCLAW_TRAJECTORY_POLL_MS, inspectTrajectoryRun, trajectoryFilePathFor, watchTrajectoryForDeath, TrajectoryRecoveredTurn, type TrajectoryUsage } from './trajectory-forensics'
import { generateDirectImage, isDirectImageProvider, resolveProviderApiKeySource } from '@bakin/core/media'
import { isUserEdited } from '@bakin/core/agent-packages/markers'
import {
  findAgentById,
  getAgentList,
  readOpenClawConfig,
  readOpenClawConfigForMutation,
  resetOpenClawConfigCache,
} from './config'
import { getOpenClawPath } from './home'
import type { OpenClawRuntimeAdapterOptions } from './index'
import { OpenClawApprovalGatewayClient } from './approval-gateway'
import { OpenClawGatewayRpcClient, type OpenClawGatewayAcceptedAck } from './gateway-rpc'
import {
  CANONICAL_DURABLE_FILES,
  getOpenClawMemoryEntry,
  getOpenClawMemoryWatchPaths,
  listOpenClawMemoryEntries,
  listOpenClawMemoryTiers,
  readOpenClawMemoryEntryRange,
  resolveOpenClawMemoryPath,
  statOpenClawMemoryEntry,
} from './memory'
import {
  cloneJson, parseJsonValue,
  parseJsonObject, readJsonFile, truncate, slug,
  metadataValue, metadataFiles,
} from './runtime-utils'
import { OpenClawCommandError, isPluginAllowlistOpenFailure } from './errors'
import type { OpenClawCronStoreJob } from './cron-store'
import {
  defaultOpenClawImageOutputPath, normalizeOpenClawOutputFormat, openClawImageModelArg,
  providerFromImageModel, parseOpenClawImageProviders,
  imageQualityFromMetadata, tagRuntimeServed, parseOpenClawImageResult,
} from './image-inference'
import {
  OPENCLAW_PLUGIN_ID, OPENCLAW_WORKFLOW_GATE_TOOL, OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX,
  renderNativeApprovalDescription, supportsNativeApprovalOptions,
  approvalEventFromOpenClawPayload, openClawDecisionFromBakinOption,
  parseNativeApprovalRef, isExpectedNativeApprovalResolveMiss,
} from './approval-helpers'
import { openClawCliSessionId, openClawExplicitSessionKey } from './session-store'
import { getOpenClawSession, listOpenClawSessions } from './sessions'
import {
  streamOpenClawTurnChunks,
  tapOpenClawTurnActivity,
  type OpenClawActivityTap,
  type OpenClawTurnFinish,
} from './stream-events'
import {
  writeOpenClawConfig, upsertOpenClawAgentConfig,
  updateOpenClawAgentIdentity, updateAgentAllowlist, removeOpenClawAgentConfig,
  removeOpenClawAgentArtifacts, removeOpenClawAgentCronArtifacts,
  agentToRuntime, getWorkspacePath, readGatewayToken, isSafeWorkspaceFile, isSafeSkillFilePath,
  readSkillTree,
} from './agent-config'
import {
  OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS,
  splitChannelRef, openClawMessageSendArgs, deliveryRefFromOpenClawOutput,
  readChannelInfos, hasAnyInteractiveApprovalChannel,
  channelHasInteractiveApproval, approvalNoticeForMessage,
  openClawThreadCreateArgs, openClawMessageEditArgs,
  threadIdFromOpenClawOutput, messageIdFromDeliveryRef,
} from './channel-helpers'
import {
  messagesToOpenClawPrompt,
  extractOpenClawAgentText, extractOpenClawAgentUsage,
} from './agent-turn'
import {
  OPENCLAW_CRON_TIMEOUT_MS,
  readCronStore, writeCronStore, readCronJobs, cronStoreJobToRuntime, cronCreateArgs,
  cronUpdateArgs, cronJobFromInput, cronJobFromUpdatePatch, withCronInputFallbacks,
  normalizeCronToolsAllow, extractCronStoreJobs, extractCronStoreJob,
  cronJobIdFromCliResult, extractCronRuns, readCronRuns,
} from './cron-store'

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
/** Best-effort chat.abort frame — short: the local rejection never waits on it. */
const OPENCLAW_ABORT_RPC_TIMEOUT_MS = 5_000

/**
 * Per-turn idempotency key — shared by the send path and streamChat (which
 * pre-registers its event subscription on it: the gateway echoes the key as
 * the runId on every pushed frame). Threaded: thread + content hash so
 * transport retries dedupe but a different turn on the same thread never
 * replays a cached reply. Unthreaded: random — each send is its own turn.
 */
function openClawTurnIdempotencyKey(prompt: string, sessionKey: string | undefined): string {
  return sessionKey
    ? `bakin:${sessionKey}:${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`
    : `bakin-${randomUUID()}`
}
const OPENCLAW_CRON_PROCESS_TIMEOUT_MS = OPENCLAW_CRON_TIMEOUT_MS + 5000
const OPENCLAW_IMAGE_PROCESS_TIMEOUT_MS = 600000
const OPENCLAW_IMAGE_OUTPUT_MAX_BUFFER = 16 * 1024 * 1024
const OPENCLAW_IMAGE_PROVIDERS_TTL_MS = 5000
const OPENCLAW_MODELS_LIST_MAX_BUFFER = 16 * 1024 * 1024

interface OpenClawAgentTurnOptions {
  agentId: string
  messages: Array<{ role: string; content: string }>
  sessionKey?: string
  attachments?: MessageArgs['attachments']
  ephemeral?: boolean
  toolsMode?: MessageArgs['toolsMode']
  /** Per-turn model override (`provider/model`); omit to use the agent default. */
  model?: string
  /** Per-turn thinking level; omit to use the runtime default. */
  thinking?: string
  /** Oversized-output threshold for session-death diagnoses (core policy). */
  oversizedOutputBytes?: number
  /** Best-effort caller cancellation (MessageArgs.signal). */
  signal?: AbortSignal
  /**
   * Precomputed per-turn idempotency key (streamChat pre-registers its event
   * subscription on this value — the gateway echoes it as the runId). Omit
   * to let the send path compute it.
   */
  idempotencyKey?: string
  /** Fires on the gateway's `accepted` ack (streaming: thinking + authoritative runId). */
  onAccepted?: (ack: OpenClawGatewayAcceptedAck) => void
  /** Send-path live-activity tap (MessageArgs.onActivity): tool/status chunks only. */
  onActivity?: (chunk: ChatChunk) => void
}

/** Result of one OpenClaw agent turn: the assistant text plus token usage
 *  (preferred from the gateway payload, which carries cache tokens and works
 *  for unthreaded sends; falls back to the trajectory `model.completed`
 *  event). Absent when the runtime reported none. */
interface OpenClawTurnResult {
  content: string
  usage?: MessageUsage
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

export class OpenClawRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = 'openclaw'
  readonly version = '0.0.1-rc.1'
  readonly requiredCoreVersion = '>=0.0.1-rc.1'

  private settings: OpenClawSettings
  private logger: AdapterLogger = noopLogger
  private auditEvent?: (event: AdapterAuditEvent) => void
  private onToolActivity?: AdapterInitOpts['onToolActivity']
  private onTurnActivity?: AdapterInitOpts['onTurnActivity']
  private bakinMcpBaseUrl?: string
  private approvalResponsesWarningLogged = false
  private approvalResolveWarningLogged = false
  private approvalGatewayClient: OpenClawApprovalGatewayClient | null = null
  private chatGatewayClient: OpenClawGatewayRpcClient | null = null
  private emittedApprovalResponseKeys: string[] = []
  private emittedApprovalResponseKeySet = new Set<string>()
  private preResolvedApprovalIdList: string[] = []
  private preResolvedApprovalIds = new Set<string>()
  private lastModelListFailureMessage: string | null = null

  constructor(options: OpenClawRuntimeAdapterOptions = {}) {
    this.settings = mergeSettings(options.settings)
  }

  async initialize(opts: AdapterInitOpts): Promise<void> {
    this.logger = opts.logger ?? noopLogger
    this.auditEvent = opts.audit
    this.onToolActivity = opts.onToolActivity
    this.onTurnActivity = opts.onTurnActivity
    this.bakinMcpBaseUrl = opts.bakinMcpBaseUrl
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

  agents = {
    list: async (): Promise<RuntimeAgent[]> => getAgentList().map(agentToRuntime),
    get: async (agentId: string): Promise<RuntimeAgent | null> => {
      const agent = findAgentById(agentId)
      return agent ? agentToRuntime(agent) : null
    },
    create: async (input: CreateRuntimeAgentInput): Promise<RuntimeAgent> => {
      const id = input.id ?? slug(input.name)
      const workspace = getWorkspacePath(id)
      if (findAgentById(id)) throw new RuntimeError(`Agent already exists: ${id}`, { kind: 'runtime_failed' })
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
      // New agent → new MCP server entry. Re-provision immediately so the
      // agent can reach Bakin's tools without waiting for the next boot.
      // Best-effort: the agent EXISTS at this point — failing create over a
      // config write would strand a retry on "Agent already exists". The next
      // boot/install re-provisions.
      try {
        await this.provisionToolAccess()
      } catch (err) {
        this.logger.warn('OpenClaw tool-access provisioning failed after agent create', {
          agentId: id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return {
        id,
        name: input.name,
        role: input.role,
        model: input.model,
        status: 'active',
        metadata: { ...(input.metadata ?? {}), workspacePath: workspace },
      }
    },
    update: async (agentId: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgent> => {
      if (!findAgentById(agentId)) throw new RuntimeError(`Agent not found: ${agentId}`, { kind: 'not_found' })
      const args = ['agents', 'set-identity', '--agent', agentId]
      if (input.name) args.push('--name', input.name)
      const emoji = metadataValue(input.metadata, 'emoji')
      if (emoji) args.push('--emoji', emoji)
      if (args.length > 4) await this.exec(args)
      // Model assignments PERSIST into agents.list[] (P2.3) — previously the
      // input model was echoed back without being written anywhere.
      if (input.model !== undefined || input.subagentModel !== undefined) {
        setAgentModels(agentId, { model: input.model, subagentModel: input.subagentModel })
      }
      resetOpenClawConfigCache()
      const refreshed = findAgentById(agentId)
      if (refreshed) {
        return {
          ...agentToRuntime(refreshed),
          ...(input.role ? { role: input.role } : {}),
          metadata: { ...(agentToRuntime(refreshed).metadata ?? {}), ...(input.metadata ?? {}) },
        }
      }
      return {
        id: agentId,
        name: input.name ?? agentId,
        role: input.role,
        model: input.model ?? undefined,
        status: 'active',
        metadata: input.metadata,
      }
    },
    remove: async (agentId: string): Promise<void> => {
      // Removing a MISSING agent is typed not_found (R28) — matching Pi and
      // the contract doc; previously the CLI failure surfaced as an opaque
      // runtime_failed.
      if (!findAgentById(agentId)) throw new RuntimeError(`Agent not found: ${agentId}`, { kind: 'not_found' })
      const workspace = getWorkspacePath(agentId)
      await this.exec(['agents', 'delete', agentId, '--force', '--json'])
      resetOpenClawConfigCache()
      removeOpenClawAgentConfig(agentId)
      removeOpenClawAgentArtifacts(agentId, workspace)
      removeOpenClawAgentCronArtifacts(agentId)
      // Prune the departed agent's MCP server entry so no stale routing
      // lingers. Best-effort — the agent is already gone; a failed prune must
      // not report the remove as failed (next boot/install re-provisions).
      try {
        await this.provisionToolAccess()
      } catch (err) {
        this.logger.warn('OpenClaw tool-access prune failed after agent remove', {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    listWorkspaceFiles: async (agentId: string): Promise<string[]> => {
      // Recursive (conformance-pinned): agent memory lives in subdirectories
      // (memory/*.md) — a top-level listing hides it from every consumer.
      // Dot-entries are skipped (parity with the Pi adapter's walk).
      const root = getWorkspacePath(agentId)
      const out: string[] = []
      const walk = (dir: string, rel: string): void => {
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const relPath = rel ? `${rel}/${entry.name}` : entry.name
          if (entry.isDirectory()) walk(join(dir, entry.name), relPath)
          else if (entry.isFile()) out.push(relPath)
        }
      }
      walk(root, '')
      return out.sort()
    },
    workspaceFileStats: async (agentId: string): Promise<WorkspaceFileStat[] | null> => {
      const root = getWorkspacePath(agentId)
      if (!existsSync(root)) return null
      const stats: WorkspaceFileStat[] = []
      const statInto = (relPath: string, kind: WorkspaceFileStat['kind']): void => {
        try {
          const s = statSync(join(root, relPath))
          if (s.isFile()) stats.push({ name: relPath, bytes: s.size, mtimeMs: s.mtimeMs, kind })
        } catch {
          // File raced away between enumeration and stat — stats stay best-effort.
        }
      }
      for (const name of CANONICAL_DURABLE_FILES) statInto(name, 'canonical')
      try {
        const skillsDir = join(root, 'skills')
        if (existsSync(skillsDir)) {
          for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
            if (entry.isDirectory()) statInto(join('skills', entry.name, 'SKILL.md'), 'skill')
          }
        }
        const memoryDir = join(root, 'memory')
        if (existsSync(memoryDir)) {
          for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.md')) statInto(join('memory', entry.name), 'memory')
          }
        }
      } catch {
        return stats // partial stats beat a thrown session-start diagnostic
      }
      return stats
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
      const lifecycle = beginAdapterTurnActivity({
        onActivity: this.onTurnActivity,
        onCallbackError: (error) => {
          this.logger.warn('onTurnActivity callback threw; contained', {
            agentId: args.agentId,
            err: error instanceof Error ? error.message : String(error),
          })
        },
        agentId: args.agentId,
        activityClass: args.activityClass ?? 'user',
        threadId: args.threadId,
        operation: 'send',
      })
      try {
        warnUnenforceableToolPolicy(args, this.logger)
        const toolActivityTap = this.createToolActivityTap(
          args.agentId,
          args.threadId,
          args.activityClass ?? 'user',
          lifecycle.turnId,
        )
        const onActivity = args.onActivity || toolActivityTap
          ? (chunk: ChatChunk): void => {
              toolActivityTap?.(chunk)
              args.onActivity?.(chunk)
            }
          : undefined
        const { content, usage } = await this.chatCompletion({
          agentId: args.agentId,
          messages: [{ role: 'user', content: args.content }],
          sessionKey: args.threadId,
          attachments: args.attachments,
          ephemeral: args.ephemeral,
          toolsMode: args.toolsMode,
          model: args.model,
          thinking: args.thinking,
          oversizedOutputBytes: args.oversizedOutputBytes,
          signal: args.signal,
          onActivity,
        })
        // Threaded sends expose the real (deterministic) provider session id
        // so callers can correlate the turn with forensics, usage, and audit.
        const sessionId = args.threadId ? openClawCliSessionId(args.agentId, args.threadId) : undefined
        const adapterTurnId = this.onTurnActivity ? lifecycle.turnId : undefined
        const result = {
          id: `msg-${Date.now()}`,
          content,
          ...(usage ? { usage } : {}),
          ...(sessionId || adapterTurnId
            ? { metadata: { ...(sessionId ? { sessionId } : {}), ...(adapterTurnId ? { adapterTurnId } : {}) } }
            : {}),
        }
        lifecycle.finish({ status: 'completed', resultId: result.id, usage: result.usage })
        return result
      } catch (error) {
        lifecycle.finish({
          status: args.signal?.aborted || (error instanceof RuntimeError && error.kind === 'aborted')
            ? 'aborted'
            : 'failed',
        })
        throw error
      }
    },
    stream: (args: MessageArgs): AsyncIterable<ChatChunk> => {
      warnUnenforceableToolPolicy(args, this.logger)
      const runtimeOutcome: { status?: 'completed' | 'failed' | 'aborted' } = {}
      const stream = this.streamChat({
        agentId: args.agentId,
        messages: [{ role: 'user', content: args.content }],
        sessionKey: args.threadId,
        attachments: args.attachments,
        ephemeral: args.ephemeral,
        toolsMode: args.toolsMode,
        model: args.model,
        thinking: args.thinking,
        oversizedOutputBytes: args.oversizedOutputBytes,
        signal: args.signal,
      }, (outcome) => {
        runtimeOutcome.status = outcome.kind === 'ok'
          ? 'completed'
          : outcome.kind === 'aborted' ? 'aborted' : 'failed'
      })
      return this.observeMessagingStream(args, stream, () => runtimeOutcome.status)
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
    createThread: async (args: { channel: string; messageRef?: string; name: string }): Promise<{ threadId: string; channelRef: string } | null> => {
      const ref = splitChannelRef(args.channel, undefined)
      const messageId = messageIdFromDeliveryRef(args.messageRef) ?? undefined
      const stdout = await this.exec(openClawThreadCreateArgs(ref, { messageId, name: args.name }))
      const threadId = threadIdFromOpenClawOutput(stdout)
      if (!threadId) {
        this.logger.warn('OpenClaw thread create output had no parseable thread id; callers fall back to flat messaging', {
          channel: args.channel,
          stdoutHead: stdout.slice(0, 300),
        })
        return null
      }
      // Provider target syntax stays here — callers treat channelRef as opaque.
      return { threadId, channelRef: `${ref.channel}:channel:${threadId}` }
    },
    editMessage: async (args: { channel: string; messageRef: string; body: string }): Promise<void> => {
      const messageId = messageIdFromDeliveryRef(args.messageRef)
      if (!messageId) throw new Error(`Not an editable message ref: ${args.messageRef}`)
      const ref = splitChannelRef(args.channel, undefined)
      await this.exec(openClawMessageEditArgs(ref, { messageId, body: args.body }))
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
        if (this.preResolvedApprovalIds.has(event.approvalId)) {
          this.logger.warn('Ignoring resolve event for a pre-resolved OpenClaw approval; the Bakin fallback link decides this gate', {
            approvalId: event.approvalId,
          })
          return
        }
        if (payload.decision === 'allow-always') {
          this.logger.warn('Workflow gate approved via OpenClaw allow-always decision — check for persisted plugin allow rules that would auto-approve future gates', {
            approvalId: event.approvalId,
            resolvedBy: payload.resolvedBy ?? null,
          })
        }
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
        // Route the button card into the gate's thread when the caller
        // created one (threadId in the request context).
        ...(typeof metadataValue(args.request.context, 'threadId') === 'string'
          ? { turnSourceThreadId: metadataValue(args.request.context, 'threadId') as string }
          : {}),
        timeoutMs: OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS,
        twoPhase: true,
        // Gates are one-shot human decisions; never offer persistent trust.
        allowedDecisions: ['allow-once', 'deny'],
      })
      if (!result.id || result.decision === null) {
        this.logger.warn('OpenClaw native approval request had no approval route; falling back to render-only message', {
          approvalId: args.approvalId,
          channel,
        })
        return null
      }
      if (typeof result.decision === 'string') {
        // OpenClaw resolved the request at creation time (e.g. a persisted
        // allow rule) — no human saw a prompt. A workflow gate must not be
        // decided that way: suppress the phantom resolve event and fall back
        // to the rendered message + Bakin link so a human decides.
        this.rememberPreResolvedApproval(args.approvalId)
        this.logger.warn('OpenClaw pre-resolved the plugin approval without a human prompt (persisted allow rule?); falling back to render-only message', {
          approvalId: args.approvalId,
          channel,
          decision: result.decision,
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
    // Render into the gate's thread when the caller created one.
    const threadId = metadataValue(context, 'threadId')
    const deliveryChannel = typeof threadId === 'string' && threadId
      ? `${splitChannelRef(channel, undefined).channel}:channel:${threadId}`
      : channel
    return this.channels.sendMessage({
      channels: [deliveryChannel],
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

  private rememberPreResolvedApproval(approvalId: string): void {
    if (this.preResolvedApprovalIds.has(approvalId)) return
    this.preResolvedApprovalIds.add(approvalId)
    this.preResolvedApprovalIdList.push(approvalId)
    while (this.preResolvedApprovalIdList.length > 1000) {
      const old = this.preResolvedApprovalIdList.shift()
      if (old) this.preResolvedApprovalIds.delete(old)
    }
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
    list: async (agentId?: string) => listOpenClawSessions(agentId),
    get: async (sessionId: string) => getOpenClawSession(sessionId),
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
        stats.push({
          agentId: entry.name,
          storeEntries,
          fileCount,
          diskBytes,
          // Adapter-owned operator guidance (R29): the provider-specific
          // cleanup command lives HERE, never in upstream health copy.
          remediation:
            'Run `openclaw sessions cleanup --enforce` and consider setting `session.maintenance.maxDiskBytes` so the gateway self-maintains.',
        })
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

    // Routing policy (P2.3): OpenClaw honors all five knobs natively —
    // defaults/fallbacks/aliases in agents.defaults, per-agent subagent
    // models on agents.list[]. Reads/writes stay adapter-private.
    routingSupport: (): RuntimeRoutingSupport => ({
      defaultModel: true,
      fallbackModels: true,
      defaultSubagentModel: true,
      aliases: true,
      perAgentSubagentModel: true,
    }),
    routingPolicy: async (): Promise<RuntimeRoutingPolicy> => readRoutingPolicy(),
    setRoutingPolicy: async (patch: Partial<RuntimeRoutingPolicy>, reason: string): Promise<void> => {
      applyRoutingPolicy(patch)
      this.audit('set-routing-policy', { reason, fields: Object.keys(patch) })
    },
  }

  private capabilitiesCache = new Map<string, { at: number; value: RuntimeCapabilities }>()

  /**
   * Input modalities of the SELECTED agent's effective model (default: the
   * main agent), answered from the runtime's OWN catalog (`openclaw models
   * list --json` `input` field — "text" | "text+image" | …): the same
   * source of truth the gateway's attachment gate enforces, so this probe
   * can never disagree with it. Effective model = the agent's configured
   * model, else the entry the runtime itself tags `default`. A requested
   * agent that does not exist reports all-false (never falls back to the
   * default model — that would mis-describe a different agent's gate).
   * Conservative false on any ambiguity; no model-name heuristics (D17
   * discipline applies to runtimes too).
   */
  /** OpenClaw agents reach Bakin exec tools via their native MCP client (verified: Phase-0 spike). */
  // perTurnExecToolFiltering false: exec tools ride session-static per-agent
  // MCP servers — toolsAllow/toolsDeny are unenforceable per turn here.
  describeToolAccess = (): RuntimeToolAccess => ({ style: 'mcp', mcpServerTemplate: 'bakin-<agent>', perTurnExecToolFiltering: false })

  /**
   * Presence-only credential report (P2.2): provider names from the agent's
   * auth-profiles.json (legacy) with a CLI fallback for sqlite-era stores —
   * newer OpenClaw migrated auth profiles into openclaw-agent.sqlite, so an
   * empty JSON probe on a working install means "ask the CLI", not "no
   * credentials". Never secrets.
   */
  credentialStatus = async (opts?: { agentId?: string }): Promise<RuntimeCredentialStatus> => {
    // MERGE the JSON store with the CLI probe rather than only-CLI-when-empty:
    // the two sources can each hold providers the other misses (a plugin
    // provider like codex may surface only through `models auth list`, while a
    // partially-populated auth-profiles.json would otherwise suppress the CLI
    // read and hide it — the #615 false "no provider" warning). Union, dedup
    // by provider (JSON wins the kind on collision — it's the richer record).
    const jsonCreds = listLlmCredentials(opts?.agentId)
    let cliCreds: LlmCredential[] = []
    try {
      cliCreds = await listLlmCredentialsViaCli((args) => this.exec(args), opts?.agentId)
    } catch (err) {
      // Only a hard failure with NOTHING from JSON is worth surfacing.
      if (jsonCreds.length === 0) {
        this.logger.warn('OpenClaw auth-profile CLI probe failed; reporting no LLM providers', { error: String(err) })
      }
    }
    const byProvider = new Map<string, LlmCredential>()
    for (const c of [...cliCreds, ...jsonCreds]) byProvider.set(c.provider, c)
    const llmCredentials = [...byProvider.values()]
    return {
      llmProviders: llmCredentials.map((entry) => entry.provider),
      llmCredentials,
      channels: listConfiguredChannels(),
    }
  }

  private async runtimeAgentIds(): Promise<string[]> {
    return (await this.agents.list()).map((agent) => agent.id).filter(Boolean)
  }

  /**
   * Write `mcp.servers[bakin-<agent>]` for every agent (pruning stale Bakin
   * entries), so OpenClaw's native MCP client can reach Bakin's tools. Each
   * entry is scoped to its own agent via `codex.agents` — without it OpenClaw
   * attaches every server to every Codex app-server thread (N agents = N
   * duplicate tool catalogs per turn). Reads + writes the runtime config
   * directly and audits the change set. Idempotent — skips the write when
   * nothing changed. Needs `bakinMcpBaseUrl` from init; warns and no-ops if
   * absent (can't build URLs). The `execTools` provider is unused: OpenClaw
   * reaches the live registry over MCP, not by value.
   */
  provisionToolAccess = async (): Promise<void> => {
    const baseUrl = this.bakinMcpBaseUrl
    if (!baseUrl) {
      this.logger.warn('OpenClaw provisionToolAccess skipped — no Bakin MCP base URL provided at init')
      return
    }
    const agents = await this.runtimeAgentIds()
    const config = readOpenClawConfigForMutation() as BakinMcpConfig
    const changes = applyBakinMcpEntries(config, agents, baseUrl)
    if (changes.length === 0) return
    writeOpenClawConfig(config as Record<string, unknown>)
    resetOpenClawConfigCache()
    this.logger.info('OpenClaw MCP config provisioned', { changes })
    this.audit('provision-tool-access', { changes })
  }

  /** Remove Bakin's `bakin-*` MCP server entries (runtime switch-away). */
  deprovisionToolAccess = async (): Promise<void> => {
    const config = readOpenClawConfigForMutation() as BakinMcpConfig
    const changes = removeBakinMcpEntries(config)
    if (changes.length === 0) return
    writeOpenClawConfig(config as Record<string, unknown>)
    resetOpenClawConfigCache()
    this.logger.info('OpenClaw MCP config deprovisioned', { changes })
    this.audit('deprovision-tool-access', { changes })
  }

  /** Read-only drift report on the per-agent MCP entries (no write). */
  verifyToolAccess = async (): Promise<ToolAccessProvisioningStatus> => {
    const baseUrl = this.bakinMcpBaseUrl
    if (!baseUrl) {
      return { style: 'mcp', ok: false, issues: ['no Bakin MCP base URL configured'] }
    }
    const agents = await this.runtimeAgentIds()
    const config = (readOpenClawConfig() ?? {}) as BakinMcpConfig
    const status = verifyBakinMcpEntries(config, agents, baseUrl)
    const missing = status.agentEntries.filter((entry) => !entry.correct)
    const issues = [
      ...(missing.length > 0
        ? [`${missing.length} Bakin MCP entr${missing.length === 1 ? 'y is' : 'ies are'} missing or outdated`]
        : []),
      ...(status.staleEntries.length > 0
        ? [`${status.staleEntries.length} stale Bakin MCP entr${status.staleEntries.length === 1 ? 'y' : 'ies'}`]
        : []),
    ]
    return {
      style: 'mcp',
      ok: issues.length === 0,
      issues,
      details: {
        mcpServers: status.agentEntries.map((entry) => entry.name),
        staleEntries: status.staleEntries,
      },
    }
  }

  private audit(action: string, data: Record<string, unknown>): void {
    this.auditEvent?.({ adapter: 'openclaw', action, data })
  }

  capabilities = async (opts?: { agentId?: string }): Promise<CapabilitySet> => ({
    toolCalling: { mode: 'native', access: this.describeToolAccess() },
    delivery: { mode: 'native' },
    // Structurally native (P4.1): OpenClaw always exposes its own image
    // inference path (`openclaw infer image`); WHICH providers are
    // configured is per-provider data on images.providers(), not a mode
    // downgrade. (Pi, by contrast, computes its mode from codex auth.)
    imageGen: { mode: 'native' },
    memory: { mode: 'native' },
    sessions: { mode: 'native' },
    workspaceFiles: { mode: 'native' },
    input: await this.inputModality(opts?.agentId),
  })

  private inputModality = async (agentId?: string): Promise<RuntimeCapabilities> => {
    const CACHE_MS = 60_000
    const requested = agentId?.trim() || ''
    const cached = this.capabilitiesCache.get(requested)
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return cached.value
    }
    const none: RuntimeCapabilities = { imageInput: false, audioInput: false }
    let value = none
    try {
      let agent: Awaited<ReturnType<typeof this.agents.get>> = null
      if (requested) {
        agent = await this.agents.get(requested)
        if (!agent) return none // missing agent: no default-model fallback
      } else {
        const mainId = tryGetMainAgentId()
        agent = mainId ? await this.agents.get(mainId) : null
      }
      const models = await this.models.listAvailable({ includeUnavailable: true })
      // The gateway accepts both `provider/model` and bare model ids
      // (agent configs typically store the bare form while the catalog
      // keys entries as provider/model) — match either, like it does.
      // Ambiguity is FALSE: when two providers share a bare id (mirror
      // catalogs), we can't know which entry the gateway's own resolver
      // picks, and a wrong guess declares a capability the attachment gate
      // then silently rejects (bakin#583 class). Bare matches count only
      // when exactly one entry has that bare id.
      const bare = (id: string) => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id)
      const wanted = agent?.model
      const bareMatches = wanted ? models.filter((m) => bare(m.id) === bare(wanted)) : []
      const entry = wanted
        ? models.find((m) => m.id === wanted) ?? (bareMatches.length === 1 ? bareMatches[0] : undefined)
        : models.find((m) => m.tags?.includes('default'))
      if (entry?.input) {
        const inputs = entry.input.toLowerCase().split(/[+,\s]+/).filter(Boolean)
        // audioInput stays false regardless of the model: capability = model
        // ∧ transport, and THIS adapter's attachment transport is image-only
        // (buildOpenClawAttachments rejects non-image mimes). Flip when the
        // gateway grows an audio attachment path.
        value = { imageInput: inputs.includes('image'), audioInput: false }
      }
    } catch (err) {
      this.logger.warn('runtime capabilities probe failed — reporting none', {
        err: err instanceof Error ? err.message : String(err),
      })
      return none
    }
    this.capabilitiesCache.set(requested, { at: Date.now(), value })
    return value
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
      // reference images is served by the edit-style invocation (#418). When the
      // native side can't serve the route, the shared shim takes the references
      // as input images (WS3) — a keyed direct provider no longer dead-ends.
      if (input.referenceImages?.length) {
        const editInput: RuntimeImageEditInput = { ...input, files: input.referenceImages }
        if (await this.canServeImageNatively(input)) {
          return tagRuntimeServed(await this.runImageInference('edit', editInput))
        }
        const refProvider = input.provider
        if (refProvider && isDirectImageProvider(refProvider)) {
          const shimmed = await this.generateImageViaShim(input, input.referenceImages)
          if (shimmed) return shimmed
        }
        // Last resort: the runtime may serve a model it didn't enumerate.
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
      // Native-first; a keyed direct provider the native side can't serve
      // edits through the shared shim (input images, WS3).
      if (!(await this.canServeImageNatively(input))) {
        const provider = input.provider
        if (provider && isDirectImageProvider(provider)) {
          const shimmed = await this.generateImageViaShim(input, input.files)
          if (shimmed) return shimmed
        }
      }
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

  private async generateImageViaShim(
    input: RuntimeImageGenerateInput,
    inputImages: string[] = [],
  ): Promise<RuntimeImageGenerationResult | null> {
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
      ...(inputImages.length > 0 ? { inputImages } : {}),
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
    if (!current) throw new RuntimeError(`Cron job not found: ${id}`, { kind: 'not_found' })

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

  /**
   * Normalize one turn's tool chunks onto the adapter-level observability
   * seam. Timing is derived locally when OpenClaw does not include it, and
   * callback failures are contained so telemetry can never fail a turn.
   */
  private createToolActivityTap(
    agentId: string,
    threadId: string | undefined,
    activityClass: AdapterToolActivityEvent['activityClass'],
    turnId: string,
  ): ((chunk: ChatChunk) => void) | undefined {
    const onToolActivity = this.onToolActivity
    if (!onToolActivity) return undefined

    const turnStartedAt = Date.now()
    const startedAt = new Map<string, { at: number; toolName: string }>()
    return (chunk: ChatChunk): void => {
      if (chunk.type !== 'tool') return

      const activity = chunk.data
      const correlationKey = activity.callId ?? `tool:${activity.toolName}`
      let toolName = activity.toolName
      let durationMs = activity.durationMs

      if (activity.phase === 'call') {
        startedAt.set(correlationKey, { at: Date.now(), toolName })
      } else {
        const started = startedAt.get(correlationKey)
        if (started) {
          toolName = started.toolName
          startedAt.delete(correlationKey)
        }
        // OpenClaw does not currently put duration on its normalized result
        // chunk. Prefer the correlated call timestamp; if a gateway dropped
        // the start frame, the turn subscription timestamp is still a useful
        // upper-bound rather than omitting timing altogether.
        durationMs ??= Math.max(0, Date.now() - (started?.at ?? turnStartedAt))
      }

      const baseEvent = {
        agentId,
        activityClass,
        turnId,
        toolName,
        ...(threadId ? { threadId } : {}),
        ...(activity.callId ? { callId: activity.callId } : {}),
      }
      const event: AdapterToolActivityEvent = activity.phase === 'call'
        ? { ...baseEvent, phase: 'call', status: 'running' }
        : {
            ...baseEvent,
            phase: 'result',
            status: activity.status === 'completed' || activity.status === 'aborted'
              ? activity.status
              : 'failed',
            ...(durationMs === undefined ? {} : { durationMs }),
          }
      try {
        onToolActivity(event)
      } catch (err) {
        this.logger.warn('onToolActivity callback threw; contained', {
          agentId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  private async *observeMessagingStream(
    args: MessageArgs,
    stream: AsyncIterable<ChatChunk>,
    getRuntimeStatus: () => 'completed' | 'failed' | 'aborted' | undefined,
  ): AsyncIterable<ChatChunk> {
    const lifecycle = beginAdapterTurnActivity({
      onActivity: this.onTurnActivity,
      onCallbackError: (error) => {
        this.logger.warn('onTurnActivity callback threw; contained', {
          agentId: args.agentId,
          err: error instanceof Error ? error.message : String(error),
        })
      },
      agentId: args.agentId,
      activityClass: args.activityClass ?? 'user',
      threadId: args.threadId,
      operation: 'stream',
    })
    const onChunk = this.createToolActivityTap(
      args.agentId,
      args.threadId,
      args.activityClass ?? 'user',
      lifecycle.turnId,
    )
    let status: 'completed' | 'failed' | 'aborted' | undefined
    let doneUsage: MessageUsage | undefined
    let sourceEnded = false
    try {
      for await (const chunk of stream) {
        onChunk?.(chunk)
        if (chunk.type === 'error') status = getRuntimeStatus() ?? 'failed'
        if (chunk.type === 'done') {
          status = getRuntimeStatus() ?? (args.signal?.aborted ? 'aborted' : 'completed')
          doneUsage = chunk.usage
        }
        yield chunk
      }
      sourceEnded = true
    } catch (error) {
      status = args.signal?.aborted || (error instanceof RuntimeError && error.kind === 'aborted')
        ? 'aborted'
        : 'failed'
      throw error
    } finally {
      // No terminal chunk + natural source end is a malformed failure. If
      // the consumer returned early, the observed interaction was aborted.
      lifecycle.finish({ status: status ?? (sourceEnded ? 'failed' : 'aborted'), usage: doneUsage })
    }
  }

  private async chatCompletion(opts: OpenClawAgentTurnOptions): Promise<OpenClawTurnResult> {
    return this.runOpenClawAgentGateway(opts)
  }

  /**
   * Live turn streaming from gateway push events (SPEC prelaunch R3): text
   * from `chat` frames, tool/status activity from `agent` frames, keyed on
   * the run's idempotencyKey (echoed by the gateway as the runId and adopted
   * from the `accepted` ack). The RPC settle — with its full fail-fast /
   * recovery-ladder handling in runOpenClawAgentGateway — stays authoritative
   * for the terminal outcome; a pushed `chat aborted` frame ends the stream
   * early (deliberate abort = clean `done`, matching the send path's
   * kind:'aborted' settle). Replaced the await-the-whole-turn one-blob yield
   * merged with the 200ms trajectory activity poll.
   */
  private async *streamChat(
    opts: OpenClawAgentTurnOptions,
    onFinish?: (outcome: OpenClawTurnFinish) => void,
  ): AsyncIterable<ChatChunk> {
    const prompt = messagesToOpenClawPrompt(opts.messages)
    const idempotencyKey = opts.idempotencyKey ?? openClawTurnIdempotencyKey(prompt, opts.sessionKey)
    yield* streamOpenClawTurnChunks({
      events: this.openClawChatGateway(),
      idempotencyKey,
      run: ({ onAccepted }) => this.runOpenClawAgentGateway({ ...opts, idempotencyKey, onAccepted }),
      classifyFailure: (err) => {
        if (err instanceof RuntimeError && err.kind === 'aborted') return { kind: 'aborted' }
        if (err instanceof RuntimeError) return { kind: 'error', errorKind: err.kind, message: err.message }
        return { kind: 'error', errorKind: 'runtime_failed', message: err instanceof Error ? err.message : String(err) }
      },
      onFinish,
    })
  }

  /**
   * Best-effort token usage for the just-finished turn, read from the
   * trajectory's success `model.completed` event. Threaded sends only (no
   * trajectory file → no usage). Returns undefined when the runtime recorded
   * none — never fabricated.
   *
   * Relies on OpenClaw's write ordering: `model.completed` (carrying usage)
   * is written to the trajectory before `session.ended`, and the gateway
   * success frame is delivered after the run ends — so by the time we read
   * here the usage line is already on disk. (The fail-fast death watch relies
   * on the same ordering to read `session.ended`.) If a future runtime broke
   * that ordering, the only effect is a silently unmetered turn — never a
   * crash or a wrong cost.
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

  /**
   * Stop a caller-aborted turn server-side. Addressed by the accepted ack's
   * {sessionKey, runId} when it has arrived — the exact pair the gateway's
   * abort registry keys, live-verified to stop backend runs — else the
   * best-known explicit session key, else nothing addressable (unthreaded,
   * pre-ack). Response-checked and audited, never fire-and-forget; fully
   * async so the caller's local rejection never waits on it.
   */
  private abortTurnServerSide(
    agentId: string,
    ack: OpenClawGatewayAcceptedAck | null,
    cliSessionId: string | null,
  ): void {
    // The gateway keys explicit-sessionId sessions as
    // agent:<agentId>:explicit:<sessionId> (verified via sessions.list) —
    // openClawExplicitSessionKey is the single owner of that format.
    const sessionKey = ack?.sessionKey ?? (cliSessionId ? openClawExplicitSessionKey(agentId, cliSessionId) : null)
    if (!sessionKey) return
    const params: Record<string, unknown> = { sessionKey }
    if (ack?.runId) params.runId = ack.runId
    this.openClawChatGateway()
      .request('chat.abort', params, { timeoutMs: OPENCLAW_ABORT_RPC_TIMEOUT_MS, expectFinal: false })
      .then((payload) => {
        const res = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
        const aborted = res.aborted === true
        const runIds = Array.isArray(res.runIds) ? res.runIds.filter((v): v is string => typeof v === 'string') : []
        this.audit('agent-turn-abort', {
          agentId,
          sessionKey,
          ...(ack?.runId ? { runId: ack.runId } : {}),
          aborted,
          runIds,
          // Registration evidence: an ack WITHOUT sessionKey means the run
          // was never registered gateway-side (sessionId-only send shape) —
          // an aborted:false here is the upstream defect, not a Bakin bug.
          ackHadSessionKey: Boolean(ack?.sessionKey),
        })
        if (aborted) {
          this.logger.info('OpenClaw run aborted server-side', { agentId, sessionKey, runIds })
        } else {
          this.logger.warn('chat.abort acknowledged but no run stopped server-side', { agentId, sessionKey })
        }
      })
      .catch((err) => {
        this.audit('agent-turn-abort', {
          agentId,
          sessionKey,
          ...(ack?.runId ? { runId: ack.runId } : {}),
          aborted: false,
          error: err instanceof Error ? err.message : String(err),
        })
        this.logger.warn('chat.abort failed; relying on local rejection', {
          agentId,
          err: err instanceof Error ? err.message : String(err),
        })
      })
  }

  private async runOpenClawAgentGateway(opts: OpenClawAgentTurnOptions): Promise<OpenClawTurnResult> {
    if (opts.signal?.aborted) {
      throw new RuntimeError('OpenClaw agent turn aborted before send', { kind: 'aborted', cause: opts.signal.reason })
    }
    const cliSessionId = opts.sessionKey ? openClawCliSessionId(opts.agentId, opts.sessionKey) : null
    const prompt = messagesToOpenClawPrompt(opts.messages)
    // Per-turn key: the gateway DEDUPES on this for ~5 minutes and replays
    // the cached payload, so two DIFFERENT logical turns on one thread must
    // carry different keys (the enrichment corrective re-ask was the first
    // multi-message-per-thread caller — a thread-only key silently replayed
    // the first turn's reply to the re-ask). Hashing the rendered prompt
    // keeps transport retries idempotent: same turn → same content → same
    // key. Unthreaded sends keep a random key — each is its own turn. The
    // gateway echoes this key back as the runId, so the activity tap below
    // can pre-key its frame filter before the ack arrives.
    const idempotencyKey = opts.idempotencyKey ?? openClawTurnIdempotencyKey(prompt, opts.sessionKey)
    const params: Record<string, unknown> = {
      agentId: opts.agentId,
      message: prompt,
      deliver: false,
      timeout: OPENCLAW_AGENT_TIMEOUT_SECONDS,
      idempotencyKey,
    }
    applyRuntimeMessageToolPolicy(params, opts)
    // BOTH sessionId and its canonical sessionKey: sessionId alone leaves
    // the run unregistered in the gateway's chat-abort registry (server-side
    // abort silently fails — the 2026-07-09 delete-didn't-abort incident;
    // fixtures abort-explicit-session.jsonl / abort-sessionkey-addressed.jsonl).
    if (cliSessionId) {
      params.sessionId = cliSessionId
      params.sessionKey = openClawExplicitSessionKey(opts.agentId, cliSessionId)
    }
    // Per-turn routing overrides (Bakin's policy → gateway agent RPC). Omit
    // when unset so the runtime uses the agent's configured model/default.
    if (opts.model) params.model = opts.model
    if (opts.thinking) params.thinking = opts.thinking
    // Image attachments → the gateway's native `attachments` param (base64
    // inline; the builder enforces image/* + the 2 MB guaranteed-inline
    // ceiling and throws loudly rather than let pixels silently degrade).
    if (opts.attachments?.length) params.attachments = buildOpenClawAttachments(opts.attachments)
    // Utility turns: runtime-native ephemeral controls. Available to
    // backend-mode clients (which this connection is) — hides the run from
    // the control UI and skips prompt persistence; the deterministic
    // session (idempotency) is unaffected.
    if (opts.ephemeral) {
      params.sessionEffects = 'internal'
      params.suppressPromptPersistence = true
    }

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
    // Caller cancellation (MessageArgs.signal): reject the local awaiter via
    // requestAbort and stop the run server-side. chat.abort addressed by the
    // accepted ack's exact {sessionKey, runId} aborts backend `agent` RPC
    // runs ONLY when the run was registered at accept time — which requires
    // the send to carry `sessionKey` (set above alongside sessionId; a
    // sessionId-only run is unregistered and NO abort surface can reach it —
    // fixtures abort-turn.jsonl, abort-explicit-session.jsonl,
    // abort-sessionkey-addressed.jsonl; live-verified 2026-07-09).
    // Before the ack arrives nothing is runId-addressable — fall back to the
    // best-known explicit session key (threaded) or skip (unthreaded); a
    // late ack can never surface after the local abort because the pending
    // entry is gone. The local rejection below never waits on any of this.
    let acceptedAck: OpenClawGatewayAcceptedAck | null = null
    let activityTap: OpenClawActivityTap | null = null
    const onAccepted = (ack: OpenClawGatewayAcceptedAck): void => {
      acceptedAck = ack
      activityTap?.onAccepted(ack)
      opts.onAccepted?.(ack)
    }
    const onCallerAbort = () => {
      // Never let a listener throw escape AbortController.abort(): the local
      // rejection below is the load-bearing part and must always run.
      try {
        this.abortTurnServerSide(opts.agentId, acceptedAck, cliSessionId)
      } catch (err) {
        this.logger.warn('chat.abort frame failed to send; relying on local rejection', {
          agentId: opts.agentId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
      requestAbort.abort()
    }
    opts.signal?.addEventListener('abort', onCallerAbort, { once: true })
    const deathWatch = trajectoryFile
      ? watchTrajectoryForDeath({
          trajectoryFile,
          sinceByteOffset: trajectoryOffset,
          oversizedOutputBytes: opts.oversizedOutputBytes,
          pollMs: OPENCLAW_TRAJECTORY_POLL_MS,
        })
      : null
    // MessageArgs.onActivity (T8): tool/status liveness for send() turns,
    // fed from the same push-event subscription streaming uses. Absent tap
    // → no subscription, zero behavior change. Created LAST, immediately
    // before the try whose finally unsubscribes it — nothing may throw
    // between the subscription and that finally.
    activityTap = opts.onActivity
      ? tapOpenClawTurnActivity({
          events: this.openClawChatGateway(),
          idempotencyKey,
          onActivity: opts.onActivity,
          onCallbackError: (err) => {
            this.logger.warn('onActivity callback threw; contained', {
              agentId: opts.agentId,
              err: err instanceof Error ? err.message : String(err),
            })
          },
        })
      : null

    try {
      const request = this.openClawChatGateway().request('agent', params, {
        expectFinal: true,
        timeoutMs: OPENCLAW_AGENT_TRANSPORT_TIMEOUT_MS,
        signal: requestAbort.signal,
        onAccepted,
      })
      // If the death watch wins the race, the losing request settles later
      // (abort rejection) with no awaiter — pre-attach a no-op catch so it
      // can never surface as an unhandled rejection.
      request.catch(() => {})
      const payload = deathWatch
        ? await Promise.race([request, deathWatch.promise])
        : await request
      // Caller-abort dominance on the SUCCESS path too: if the final frame
      // wins the race against the abort rejection, the turn must still
      // surface as 'aborted' — otherwise dispatch runs full ok bookkeeping
      // (cost row, state cleanup) for a task the caller just cancelled.
      if (opts.signal?.aborted) {
        throw new RuntimeError('OpenClaw agent turn aborted by caller', { kind: 'aborted', cause: opts.signal.reason })
      }
      const content = extractOpenClawAgentText(payload)
      if (content) {
        // Prefer usage from the gateway payload (carries cache tokens, works
        // for unthreaded sends, no extra disk read). Fall back to the
        // trajectory only when the payload omitted it.
        const usage = extractOpenClawAgentUsage(payload) ?? this.readTurnUsage(trajectoryFile, trajectoryOffset, opts)
        return { content, ...(usage ? { usage } : {}) }
      }
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
      // Intentional caller cancel dominates every other outcome — a deleted
      // task has no use for recovered content or a death diagnosis.
      if (opts.signal?.aborted) {
        throw new RuntimeError('OpenClaw agent turn aborted by caller', { kind: 'aborted', cause: err })
      }
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
      opts.signal?.removeEventListener('abort', onCallerAbort)
      activityTap?.unsubscribe()
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
      // Long-lived adapter client: per-turn tap/stream subscriptions must
      // not close the socket on every settle (close() in shutdown() remains
      // the explicit teardown).
      keepAlive: true,
    })
    return this.chatGatewayClient
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
      const { stdout } = await execFileAsync(this.settings.binaryPath, args, { timeout: 15000, ...opts })
      return stdout
    } catch (err) {
      throw new OpenClawCommandError(args, err)
    }
  }

  private async execCron(args: string[]): Promise<string> {
    return this.exec(args, { timeout: OPENCLAW_CRON_PROCESS_TIMEOUT_MS })
  }
}

/**
 * Per-turn tool policy → gateway params: toolsMode ONLY. The contract's
 * toolsAllow/toolsDeny name Bakin exec tools — OpenClaw's exec tools ride
 * session-static per-agent MCP servers, so per-turn filtering is not
 * enforceable here, and forwarding the fields as gateway-native tool policy
 * misapplied them to native tools (audit M3: `toolsAllow: ['read']`
 * restricted natives on OpenClaw while Pi filtered exec tools). The fields
 * are ignored with a loud warning (warnUnenforceableToolPolicy).
 */
function applyRuntimeMessageToolPolicy(params: Record<string, unknown>, opts: OpenClawAgentTurnOptions): void {
  if (opts.toolsMode === 'none' || opts.toolsMode === 'auto') params.toolsMode = opts.toolsMode
}

/**
 * Loud honesty: callers supplying exec-tool filters must know OpenClaw cannot
 * enforce them per-turn. Deduped once per agent — a caller that adopts the
 * fields would otherwise log every single turn. (Callers can feature-detect
 * via describeToolAccess().perTurnExecToolFiltering === false and refuse
 * instead of degrading.)
 */
const warnedUnenforceableToolPolicyAgents = new Set<string>()
function warnUnenforceableToolPolicy(args: MessageArgs, logger: AdapterLogger): void {
  if (!args.toolsAllow?.length && !args.toolsDeny?.length) return
  if (warnedUnenforceableToolPolicyAgents.has(args.agentId)) return
  warnedUnenforceableToolPolicyAgents.add(args.agentId)
  logger.warn('toolsAllow/toolsDeny ignored: OpenClaw exec tools ride session-static MCP servers — per-turn exec-tool filtering is unenforceable on this runtime (fields are never applied to native tools)', {
    agentId: args.agentId,
    toolsAllow: args.toolsAllow?.length ?? 0,
    toolsDeny: args.toolsDeny?.length ?? 0,
  })
}

/**
 * Token usage from the gateway agent response payload (`result.meta.agentMeta
 * .usage`). Returned for every send — threaded or not — and carries cache
 * tokens the trajectory `model.completed` event omits. Tokens only: the model
 * is resolved Bakin-side (agent config / routing), not from the payload, to
 * avoid provider-id-string mismatches against the pricing catalog. Returns
 * undefined when no token counts are present (never fabricated).
 */

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

function gatewayWebSocketUrl(settings: OpenClawSettings): string {
  const url = new URL(`${settings.gatewayUrl}:${settings.gatewayPort}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/$/, '')
}
