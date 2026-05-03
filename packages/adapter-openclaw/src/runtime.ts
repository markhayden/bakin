import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
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
  RuntimeAgent,
  RuntimeAvailableModel,
  RuntimeMetadata,
  RuntimeMemorySearchResult,
  RuntimeSkill,
  UpdateCronJobInput,
  WorkspaceFile,
} from '@bakin/core/adapters/runtime'
import type { AdapterHealthCheckDefinition, AdapterInitOpts, AdapterLogger } from '@bakin/core/adapters/shared'
import { isUserEdited } from '@bakin/core/agent-packages/markers'
import {
  findAgentById,
  getAgentList,
  readOpenClawConfig,
  resetOpenClawConfigCache,
} from './config'
import { getOpenClawHome, getOpenClawPath } from './home'
import { tryGetMainAgentId } from './main-agent'
import type { OpenClawRuntimeAdapterOptions } from './index'
import {
  OpenClawApprovalGatewayClient,
  type OpenClawPluginApprovalDecision,
  type OpenClawPluginApprovalResolvedPayload,
} from './approval-gateway'
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
  binaryPath: process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw',
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

const TRANSIENT_FETCH_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

const SEND_MESSAGE_RETRY_BACKOFF_MS = [1000, 2000]
const OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS = 600000
const OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX = 'openclaw-plugin-approval:'
const OPENCLAW_PLUGIN_ID = 'bakin'
const OPENCLAW_WORKFLOW_GATE_TOOL = 'workflow.gate'
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

export class OpenClawRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = 'openclaw'
  readonly version = '0.1.0'
  readonly requiredCoreVersion = '^1.0.0'

  private settings: OpenClawSettings
  private logger: AdapterLogger = noopLogger
  private approvalResponsesWarningLogged = false
  private approvalResolveWarningLogged = false
  private approvalGatewayClient: OpenClawApprovalGatewayClient | null = null
  private emittedApprovalResponseKeys: string[] = []
  private emittedApprovalResponseKeySet = new Set<string>()

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
      await this.exec(args)
      const emoji = metadataValue(input.metadata, 'emoji')
      const identityArgs = ['agents', 'set-identity', '--agent', id]
      if (input.name) identityArgs.push('--name', input.name)
      if (emoji) identityArgs.push('--emoji', emoji)
      if (identityArgs.length > 4) await this.exec(identityArgs)
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
      try {
        await this.exec(['agents', 'delete', agentId, '--force', '--json'])
      } catch (err) {
        if (!isAgentNotFoundError(err)) throw err
        this.logger.warn('OpenClaw agent missing from roster during removal; pruning conventional state dirs', { agentId })
      }
      pruneConventionalAgentDirs(agentId)
      resetOpenClawConfigCache()
      removeAgentFromAllAllowlists(agentId)
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
    heartbeat: async (agentId: string): Promise<boolean> => {
      const file = join(getWorkspacePath(agentId), 'HEARTBEAT.md')
      try {
        return statSync(file).isFile()
      } catch {
        return false
      }
    },
  }

  messaging = {
    send: async (args: { agentId: string; content: string; threadId?: string; metadata?: RuntimeMetadata }) => {
      const content = await this.chatCompletion({
        agentId: args.agentId,
        messages: [{ role: 'user', content: args.content }],
        sessionKey: args.threadId,
      })
      return { id: `msg-${Date.now()}`, content }
    },
    stream: (args: { agentId: string; content: string; threadId?: string; metadata?: RuntimeMetadata }): AsyncIterable<ChatChunk> => this.streamChat({
      agentId: args.agentId,
      messages: [{ role: 'user', content: args.content }],
      sessionKey: args.threadId,
    }),
  }

  tools = {
    invoke: async (_agentId: string, name: string, args: unknown) => {
      const value = await this.invokeTool(name, args as Record<string, unknown>)
      return { ok: true, output: value }
    },
    list: async () => [],
  }

  channels = {
    list: async (): Promise<ChannelInfo[]> => readChannelInfos(),
    sendNotification: async (args: { channels: string[]; notification: { severity: string; title: string; body: string; metadata?: RuntimeMetadata } }) => {
      return this.channels.sendMessage({
        channels: args.channels,
        message: {
          title: args.notification.title,
          body: `${args.notification.title}\n\n${args.notification.body}`,
          metadata: args.notification.metadata,
        },
      })
    },
    sendMessage: async (args: { channels: string[]; message: { body: string; title?: string; threadId?: string; metadata?: RuntimeMetadata } }) => {
      const renderedAt = new Date().toISOString()
      const deliveries = []
      for (const channel of args.channels) {
        const ref = splitChannelRef(channel, args.message.metadata)
        const payload: Record<string, unknown> = { channel: ref.channel, message: args.message.body }
        const files = metadataFiles(args.message.metadata)
        if (ref.target) payload.target = ref.target
        if (args.message.title) payload.title = args.message.title
        if (args.message.threadId) payload.threadId = args.message.threadId
        if (files.length > 0) {
          payload.files = files
          payload.media = files.map(file => file.path)
        }
        try {
          await this.invokeTool('message_send', payload)
        } catch (err) {
          if (!ref.target) throw err
          const cliArgs = ['message', 'send', '--channel', ref.channel, '--target', ref.target, '--message', args.message.body]
          await this.exec(cliArgs)
        }
        deliveries.push({ channelId: channel, ref: `message:${Date.now()}`, renderedAt })
      }
      return { deliveries }
    },
    deliverContent: async (args: { channels: string[]; content: { title: string; body?: string; url?: string; files?: Array<{ name: string; path: string; contentType?: string }>; metadata?: RuntimeMetadata } }) => {
      return this.channels.sendMessage({
        channels: args.channels,
        message: {
          title: args.content.title,
          body: [args.content.title, args.content.body, args.content.url].filter(Boolean).join('\n\n'),
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
    onMessage: () => () => {},
    onInteraction: () => () => {},
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
          args.request.title,
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
      const stdout = await this.exec(['models', 'list', '--all', '--json'])
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

  tasks = {
    dispatch: async (args: { bakinTaskId: string }) => ({ flowId: `flow-${args.bakinTaskId}` }),
    getExecutionStatus: async (flowId: string) => ({ flowId, state: 'unknown' as const }),
    listExecutions: async () => [],
    cancelExecution: async () => {},
    subscribeExecutionUpdates: () => () => {},
  }

  cron = {
    list: async (): Promise<CronJob[]> => readCronJobs().map(cronStoreJobToRuntime),
    get: async (id: string): Promise<CronJob | null> => {
      const job = readCronJobs().find((entry) => entry.id === id)
      return job ? cronStoreJobToRuntime(job) : null
    },
    create: async (input: CreateCronJobInput): Promise<CronJob> => {
      const store = readCronStore()
      const jobs = store.jobs ?? []
      const id = input.id ?? uniqueCronId(input.name, jobs)
      if (jobs.some((job) => job.id === id)) throw new Error(`Cron job already exists: ${id}`)
      const nowMs = Date.now()
      const now = new Date(nowMs).toISOString()
      const bakinSchedule = isBakinScheduleMetadata(input.metadata)
      const payload = bakinSchedule
        ? { kind: 'systemEvent', text: input.command }
        : withCronToolsAllow({ kind: 'agentTurn', message: input.command }, input.toolsAllow)
      const job: OpenClawCronStoreJob = {
        id,
        name: input.name,
        enabled: input.enabled ?? true,
        schedule: { kind: 'cron', expr: input.schedule },
        sessionTarget: bakinSchedule ? 'main' : 'isolated',
        wakeMode: 'now',
        delivery: cronDeliveryFromMetadata(input.metadata) ?? { mode: 'none' },
        payload,
        createdAt: now,
        updatedAt: now,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        state: {},
        metadata: input.metadata,
      }
      writeCronStore({ ...store, jobs: [...jobs, job] })
      return cronStoreJobToRuntime(job)
    },
    update: async (id: string, patch: UpdateCronJobInput): Promise<CronJob> => {
      const store = readCronStore()
      const jobs = store.jobs ?? []
      const index = jobs.findIndex((job) => job.id === id)
      if (index === -1) throw new Error(`Cron job not found: ${id}`)
      const current = jobs[index]
      const metadata = patch.metadata ?? current.metadata
      const bakinSchedule = isBakinScheduleMetadata(metadata)
      const command = patch.command ?? cronStoreJobToRuntime(current).command
      const nowMs = Date.now()
      const payload = bakinSchedule || patch.command !== undefined || patch.toolsAllow !== undefined
        ? withCronToolsAllow(cronPayloadForCommand(command, current.payload, bakinSchedule), patch.toolsAllow)
        : current.payload
      const next: OpenClawCronStoreJob = {
        ...current,
        name: patch.name ?? current.name,
        enabled: patch.enabled ?? current.enabled ?? true,
        schedule: patch.schedule ? { kind: 'cron', expr: patch.schedule } : current.schedule,
        sessionTarget: bakinSchedule ? 'main' : current.sessionTarget,
        wakeMode: bakinSchedule ? 'now' : current.wakeMode,
        delivery: bakinSchedule
          ? { mode: 'none' }
          : patch.metadata ? cronDeliveryFromMetadata(patch.metadata) ?? current.delivery ?? { mode: 'none' } : current.delivery,
        payload,
        metadata,
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      }
      jobs[index] = next
      writeCronStore({ ...store, jobs })
      return cronStoreJobToRuntime(next)
    },
    remove: async (id: string): Promise<void> => {
      const store = readCronStore()
      writeCronStore({ ...store, jobs: (store.jobs ?? []).filter((job) => job.id !== id) })
    },
    runNow: async (jobId: string): Promise<CronRun> => {
      await this.exec(['cron', 'run', jobId, '--force'])
      return readCronRuns(jobId, 1)[0] ?? {
        id: `run-${Date.now()}`,
        jobId,
        status: 'queued',
        startedAt: new Date().toISOString(),
      }
    },
    listRuns: async (jobId: string): Promise<CronRun[]> => readCronRuns(jobId),
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
    get: async <T = Record<string, unknown>>() => (readOpenClawConfig() ?? {}) as T,
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
      const config = readOpenClawConfig() ?? {}
      return (key === '*' ? config : readPath(config as Record<string, unknown>, key)) as T
    },
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

  private async chatCompletion(opts: { agentId: string; messages: Array<{ role: string; content: string }>; sessionKey?: string }): Promise<string> {
    const response = await this.fetchChat(opts, false)
    const data = await response.json()
    return data?.choices?.[0]?.message?.content || ''
  }

  private async *streamChat(opts: { agentId: string; messages: Array<{ role: string; content: string }>; sessionKey?: string }): AsyncIterable<ChatChunk> {
    const response = await this.fetchChat(opts, true)
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const chunk = parseStreamFrame(frame)
        if (chunk?.type === 'done') {
          yield chunk
          return
        }
        if (chunk) yield chunk
      }
    }
    if (buffer.trim()) {
      const chunk = parseStreamFrame(buffer)
      if (chunk?.type === 'text') yield chunk
    }
    yield { type: 'done' }
  }

  private async fetchChat(opts: { agentId: string; messages: Array<{ role: string; content: string }>; sessionKey?: string }, stream: boolean): Promise<Response> {
    let response: Response | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(`${this.baseUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers: this.headers(opts.agentId, opts.sessionKey),
          body: JSON.stringify({
            model: 'openclaw:main',
            max_tokens: 2048,
            stream,
            messages: opts.messages,
          }),
        })
        break
      } catch (err) {
        if (stream || !isTransientFetchError(err) || attempt === 3) throw err
        this.logger.warn('OpenClaw chat transient fetch failure; retrying', {
          agentId: opts.agentId,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        })
        await sleep(SEND_MESSAGE_RETRY_BACKOFF_MS[attempt - 1] ?? 0)
      }
    }
    if (!response) throw new Error('OpenClaw chat failed before receiving a response')
    if (!response.ok) throw new Error(`OpenClaw chat failed (${response.status}): ${await response.text()}`)
    return response
  }

  private async invokeTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${this.baseUrl()}/tools/invoke`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ tool: toolName, action: 'json', args }),
    })
    if (!res.ok) throw new Error(`OpenClaw invokeTool failed (${res.status}): ${await res.text()}`)
    return res.json()
  }

  private async exec(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.settings.binaryPath, args, { timeout: 60000 })
      return stdout
    } catch (err) {
      throw enrichOpenClawExecError(err, this.settings.binaryPath, args)
    }
  }
}

function mergeSettings(raw: Record<string, unknown> | undefined): OpenClawSettings {
  const input = (raw ?? {}) as Partial<OpenClawSettings>
  return { ...DEFAULT_SETTINGS, ...input }
}

function writeOpenClawConfig(config: Record<string, unknown>): void {
  writeFileSync(getOpenClawPath('openclaw.json'), JSON.stringify(config, null, 2), 'utf-8')
  resetOpenClawConfigCache()
}

function updateAgentAllowlist(agentId: string, updater: (current: string[]) => string[]): void {
  const config = readOpenClawConfig()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  agent.subagents ??= {}
  agent.subagents.allowAgents = updater(agent.subagents.allowAgents ?? [])
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function removeAgentFromAllAllowlists(agentId: string): void {
  const config = readOpenClawConfig()
  const agents = config?.agents?.list
  if (!agents) return
  let changed = false
  for (const agent of agents) {
    const allowAgents = agent.subagents?.allowAgents
    if (!allowAgents?.includes(agentId)) continue
    agent.subagents!.allowAgents = allowAgents.filter((id) => id !== agentId)
    changed = true
  }
  if (changed) writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

function splitChannelRef(channelId: string, metadata: RuntimeMetadata | undefined): { channel: string; target?: string } {
  const explicitTarget = metadataValue(metadata, 'target') ?? metadataValue(metadata, 'channelTarget')
  if (explicitTarget) return { channel: channelId, target: explicitTarget }
  const [channel, ...targetParts] = channelId.split(':')
  if (channel && targetParts.length > 0) return { channel, target: targetParts.join(':') }
  return { channel: channelId }
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
  return {
    id: job.id,
    name: job.name ?? job.id,
    schedule: cronScheduleToString(job.schedule),
    command: typeof job.payload?.message === 'string'
      ? job.payload.message
      : typeof job.payload?.text === 'string'
        ? job.payload.text
        : '',
    enabled: job.enabled ?? true,
    toolsAllow: normalizeCronToolsAllow(job.payload?.toolsAllow),
    metadata: job.metadata,
  }
}

function cronDeliveryFromMetadata(metadata: RuntimeMetadata | undefined): OpenClawCronStoreJob['delivery'] | undefined {
  const webhookUrl = metadataValue(metadata, 'webhookUrl')
  return webhookUrl ? { mode: 'webhook', to: webhookUrl, url: webhookUrl } : undefined
}

function isBakinScheduleMetadata(metadata: RuntimeMetadata | undefined): boolean {
  return metadata?.bakinSchedule === true || metadata?.['bakin.schedule'] === true
}

function cronPayloadForCommand(
  command: string,
  current: OpenClawCronStoreJob['payload'],
  bakinSchedule: boolean,
): OpenClawCronStoreJob['payload'] {
  if (bakinSchedule || current?.kind === 'systemEvent') {
    return { kind: 'systemEvent', text: command }
  }
  return { ...(current ?? {}), kind: 'agentTurn', message: command }
}

function withCronToolsAllow(
  payload: OpenClawCronStoreJob['payload'],
  toolsAllow: string[] | null | undefined,
): OpenClawCronStoreJob['payload'] {
  if (payload?.kind !== 'agentTurn' || toolsAllow === undefined) return payload
  const next = { ...payload }
  const normalized = normalizeCronToolsAllow(toolsAllow)
  if (normalized) next.toolsAllow = normalized
  else delete next.toolsAllow
  return next
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

function uniqueCronId(name: string, jobs: OpenClawCronStoreJob[]): string {
  const base = `cron-${slug(name)}`
  const ids = new Set(jobs.map((job) => job.id))
  if (!ids.has(base)) return base
  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
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

function parseStreamFrame(frame: string): ChatChunk | null {
  const dataLines = frame
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
  if (dataLines.length === 0) {
    const text = frame.trim()
    return text ? { type: 'text', content: text } : null
  }
  const data = dataLines.join('\n')
  if (data === '[DONE]') return { type: 'done' }
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
      error?: { message?: string }
    }
    const error = parsed.error?.message
    if (error) return { type: 'error', content: error }
    const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content
    return content ? { type: 'text', content } : null
  } catch {
    return data ? { type: 'text', content: data } : null
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function agentToRuntime(agent: NonNullable<ReturnType<typeof findAgentById>>): RuntimeAgent {
  return {
    id: agent.id,
    name: agent.identity?.name ?? agent.name ?? agent.id,
    role: resolveRole(agent.id),
    model: agent.model?.primary,
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

function isSafeAgentIdForPrune(agentId: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(agentId) && agentId !== 'main'
}

function isAgentNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /agent\s+["']?[^"'\s]+["']?\s+not\s+found/i.test(message)
}

function pruneConventionalAgentDirs(agentId: string): void {
  if (!isSafeAgentIdForPrune(agentId)) return
  for (const dir of [
    getOpenClawPath('agents', agentId),
    getOpenClawPath('workspaces', agentId),
  ]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
}

function enrichOpenClawExecError(err: unknown, binaryPath: string, args: string[]): Error {
  const source = err as {
    message?: string
    stdout?: string | Buffer
    stderr?: string | Buffer
    code?: unknown
    signal?: unknown
    killed?: unknown
  }
  const details = [
    source.message || `Command failed: ${binaryPath} ${args.join(' ')}`,
    source.stderr ? `stderr:\n${String(source.stderr).trim()}` : '',
    source.stdout ? `stdout:\n${String(source.stdout).trim()}` : '',
    source.code !== undefined ? `exitCode: ${String(source.code)}` : '',
    source.signal !== undefined ? `signal: ${String(source.signal)}` : '',
    source.killed !== undefined ? `killed: ${String(source.killed)}` : '',
  ].filter(Boolean)
  return new Error(details.join('\n'))
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

function isTransientFetchError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch failed')) return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_FETCH_CODES.has(cause.code)) return true
  return err instanceof Error && err.name === 'AbortError'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
