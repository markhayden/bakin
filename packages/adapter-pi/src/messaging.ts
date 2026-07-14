/**
 * messaging.send/stream — one Pi agent turn per call.
 *
 * Per turn: resolve the agent record → open/resume the thread's session
 * (sessions.ts) → assemble resources (AGENTS.md via cwd discovery, other
 * canonical files appended to the system prompt, Bakin exec tools bridged
 * in-process) → prompt() → map events/usage/failures to contract shapes.
 * Sessions are disposed after the turn settles; the JSONL file carries
 * conversation state. All failures leave through errors.ts.
 */
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'

import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent'

import type {
  AdapterLogger,
  AgentRuntimeAdapter,
  ChatChunk,
  MessageArgs,
  MessageResult,
  MessageUsage,
  RuntimeExecToolProvider,
} from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'
import { redactSensitiveText } from '@bakin/core/redact'

import { buildStreamDeathError, toRuntimeError } from './errors'
import { getAgentWorkspaceDir, getPiAgentDir } from './home'
import { findPiModel, getModelRegistry, qualifiedModelId } from './models'
import { readRoutingDefaultModel } from './config'
import { readRegistry, scaffoldAgentDirs, type PiAgentRecord } from './registry'
import { recordThreadSession, sessionManagerForThread, withThreadLock } from './sessions'
import { buildAppendSystemPrompt } from './system-prompt'
import { bridgeExecTools, filterExecToolDescriptors } from './tool-bridge'

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

/**
 * Pi extension loading policy (settings.runtime.settings.piExtensions).
 * Extensions are arbitrary code executing inside the Bakin server process
 * and many are TUI-coupled — 'all' honors whatever `pi install` set up
 * (the default: users who installed packages for terminal pi expect them
 * here too, #626); 'allowlist' loads only name/path matches; 'none'
 * restores the v1 lockout. extension_error events are contained per-turn.
 */
export interface PiExtensionsPolicy {
  mode?: 'none' | 'allowlist' | 'all'
  allow?: string[]
}

/**
 * DEFAULT IS 'allowlist' (empty) — terminal-installed extensions are
 * discovered but INERT until approved on the runtime hub (pi-ecosystem WS4;
 * flipped from 'all', which loaded everything silently). Extensions run
 * unsandboxed in this server process — loading is a trust decision.
 */
export function extensionsPolicy(settings: Record<string, unknown> | undefined): Required<PiExtensionsPolicy> {
  const raw = (settings?.piExtensions ?? {}) as PiExtensionsPolicy
  return { mode: raw.mode ?? 'allowlist', allow: raw.allow ?? [] }
}

/**
 * ONE allowlist predicate for loading AND discovery status: exact full path,
 * exact basename (with or without extension), or — for npm/git package
 * extensions whose load path lands under node_modules — an exact
 * path-segment match of the package name. NEVER substring matching: an
 * entry "foo" must not admit "foobar".
 */
export function extensionAllowed(path: string, allow: string[]): boolean {
  const base = path.split('/').pop() ?? path
  const stem = base.replace(/\.(ts|js|mjs|cjs)$/, '')
  const segments = path.split('/')
  return allow.some((pattern) =>
    pattern === path
    || pattern === base
    || pattern === stem
    || (pattern.includes('/')
      ? path.includes(`/node_modules/${pattern}/`) || path.endsWith(`/node_modules/${pattern}`)
      : segments.includes(pattern)),
  )
}

export interface PiMessagingDeps {
  getExecTools: () => RuntimeExecToolProvider | undefined
  getLogger?: () => AdapterLogger | undefined
  /** Adapter-level runtime settings (settings.runtime.settings), e.g. { retry: RetrySettings }. */
  getSettings?: () => Record<string, unknown> | undefined
}

interface TurnHandle {
  session: AgentSession
  record: PiAgentRecord
  dispose: () => void
}

function requireAgent(agentId: string): PiAgentRecord {
  const record = readRegistry().agents.find((a) => a.id === agentId)
  if (!record) {
    throw new RuntimeError(`adapter-pi: unknown agent: ${agentId}`, { kind: 'runtime_failed' })
  }
  return record
}

/**
 * Effective model for a turn: explicit per-turn override → the agent's
 * assignment → the routing default (P2.3) → undefined (SDK default).
 *
 * Never throws: this runs inside error-path metadata construction (the
 * `toRuntimeError` calls), where a settings-parse throw would REPLACE the
 * real turn error and defeat kind-based failure classification.
 */
function resolveModelRef(turnModel: string | undefined, agentModel: string | undefined): string | undefined {
  if (turnModel) return turnModel
  if (agentModel) return agentModel
  try {
    return readRoutingDefaultModel() || undefined
  } catch {
    return undefined
  }
}

function imageContentsFor(args: MessageArgs, record: PiAgentRecord) {
  if (!args.attachments || args.attachments.length === 0) return undefined
  const model = findPiModel(resolveModelRef(args.model, record.model))
  if (!model || !model.input.includes('image')) {
    throw new RuntimeError(
      `adapter-pi: agent ${record.id} model does not accept image input — refusing to drop ${args.attachments.length} attachment(s)`,
      { kind: 'runtime_failed' },
    )
  }
  return args.attachments.map((att) => ({
    type: 'image' as const,
    data: readFileSync(att.path).toString('base64'),
    mimeType: att.mimeType,
  }))
}


/**
 * The per-turn SettingsManager, exactly as Bakin turns build it. Exported so
 * the compaction-default pin test exercises the REAL construction: Bakin
 * relies on the SDK's compaction default staying enabled (long tasks compact,
 * not die) — if the pinned SDK flips it, the pin fails and this helper must
 * pass an explicit compaction override.
 */
export function createTurnSettingsManager(workspace: string, agentDir: string): SettingsManager {
  return SettingsManager.create(workspace, agentDir, { projectTrusted: true })
}

async function openTurnSession(args: MessageArgs, deps: PiMessagingDeps): Promise<TurnHandle> {
  const record = requireAgent(args.agentId)
  scaffoldAgentDirs(record.id)
  const workspace = getAgentWorkspaceDir(record.id)
  const agentDir = getPiAgentDir()
  const { auth, registry: modelRegistry } = getModelRegistry()

  const settingsManager = createTurnSettingsManager(workspace, agentDir)
  const adapterSettings = deps.getSettings?.()
  const extPolicy = extensionsPolicy(adapterSettings)
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    // Extensions load per policy (#626); themes/prompt-templates are
    // TUI-only and stay out of the server process.
    noExtensions: extPolicy.mode === 'none',
    ...(extPolicy.mode === 'allowlist'
      ? {
          extensionsOverride: (base: LoadExtensionsResult): LoadExtensionsResult => ({
            ...base,
            extensions: base.extensions.filter((ext) => extensionAllowed(ext.path, extPolicy.allow)),
          }),
        }
      : {}),
    noThemes: true,
    noPromptTemplates: true,
    appendSystemPrompt: buildAppendSystemPrompt(record.id),
  })
  await resourceLoader.reload()

  const retry = adapterSettings?.retry
  if (retry && typeof retry === 'object') {
    // Bakin's dispatch owns the outer retry ladder; installs can tune or
    // disable Pi's inner auto-retry via settings.runtime.settings.retry.
    // MUST run after resourceLoader.reload(): reload() calls
    // settingsManager.reload(), which recomputes settings from disk and
    // discards any overrides applied before it.
    settingsManager.applyOverrides({ retry: retry as never })
  }

  const execProvider = deps.getExecTools()
  // record.allowlist is the SUBAGENT dispatch allowlist (agent ids) — never
  // a tool filter. Tool exposure is policy-driven only (args.tools*).
  const descriptors = execProvider ? filterExecToolDescriptors(execProvider.list(), args) : []
  const customTools = execProvider ? bridgeExecTools(execProvider, record.id, descriptors) : []

  const model = findPiModel(resolveModelRef(args.model, record.model))
  const thinking = args.thinking && THINKING_LEVELS.has(args.thinking) ? args.thinking : undefined

  const { session } = await createAgentSession({
    cwd: workspace,
    agentDir,
    authStorage: auth,
    modelRegistry,
    sessionManager: sessionManagerForThread(record.id, args.threadId),
    settingsManager,
    resourceLoader,
    customTools,
    ...(model ? { model } : {}),
    ...(thinking ? { thinkingLevel: thinking as never } : {}),
    ...(args.toolsMode === 'none' ? { noTools: 'all' as const } : {}),
  })

  return {
    session,
    record,
    dispose: () => {
      try {
        session.dispose()
      } catch (err) {
        deps.getLogger?.()?.warn('adapter-pi: session dispose failed', { error: String(err) })
      }
    },
  }
}

function usageDelta(before: ReturnType<AgentSession['getSessionStats']>, after: ReturnType<AgentSession['getSessionStats']>, session: AgentSession): MessageUsage | undefined {
  const input = after.tokens.input - before.tokens.input
  const output = after.tokens.output - before.tokens.output
  const cacheRead = after.tokens.cacheRead - before.tokens.cacheRead
  const cacheWrite = after.tokens.cacheWrite - before.tokens.cacheWrite
  const total = after.tokens.total - before.tokens.total
  if (total <= 0 && output <= 0) return undefined
  return {
    input: Math.max(0, input),
    output: Math.max(0, output),
    total: Math.max(0, total),
    cacheRead: Math.max(0, cacheRead),
    cacheWrite: Math.max(0, cacheWrite),
    model: session.model ? qualifiedModelId(String(session.model.provider), session.model.id) : undefined,
  }
}

function persistThreadMapping(agentId: string, threadId: string | undefined, session: AgentSession): void {
  if (!threadId) return
  const file = session.sessionFile
  if (file) recordThreadSession(agentId, threadId, session.sessionId, file)
}

/**
 * Watches the turn's event stream for evidence used in results + forensics.
 *
 * IMPORTANT SDK behavior (probed, 0.80.3): `session.prompt()` RESOLVES even
 * when the provider fails terminally — the failure signal is the final
 * `agent_end` whose last assistant message has `stopReason: 'error'` (after
 * auto-retries exhaust, `willRetry: false`) plus its `errorMessage`.
 */
class TurnObserver {
  text = ''
  lastToolCall: string | undefined
  sawDone = false
  /** Terminal provider failure message (agent_end, stopReason 'error', no retry pending). */
  terminalError: string | undefined
  /** The run ended with stopReason 'aborted'. */
  endedAborted = false

  readonly onEvent = (event: AgentSessionEvent): void => {
    if (event.type === 'tool_execution_start') {
      this.lastToolCall = event.toolName
    } else if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta.type === 'text_delta') this.text += delta.delta
      else if (delta.type === 'done') this.sawDone = true
    } else if (event.type === 'agent_end') {
      const last = event.messages.at(-1) as { stopReason?: string; errorMessage?: string } | undefined
      if (!last) return
      if (last.stopReason === 'error') {
        this.terminalError = event.willRetry ? this.terminalError : (last.errorMessage ?? 'Pi turn ended in error')
      } else if (last.stopReason === 'aborted') {
        this.endedAborted = true
      } else if (last.stopReason) {
        // A later successful attempt clears failure evidence from retries.
        this.terminalError = undefined
      }
    }
  }
}

/**
 * Map one Pi session event to normalized chunks — the single event→chunk
 * mapping shared by `stream()` (all chunk kinds) and the `send()` activity
 * tap (which keeps only tool/status). `state` carries the once-per-turn
 * thinking announcement.
 */
function sessionEventChunks(event: AgentSessionEvent, state: { announcedThinking: boolean }): ChatChunk[] {
  if (event.type === 'message_update') {
    const delta = event.assistantMessageEvent
    if (delta.type === 'text_delta') return [{ type: 'text', content: delta.delta }]
    if (delta.type === 'thinking_start' && !state.announcedThinking) {
      state.announcedThinking = true
      return [{ type: 'status', content: 'thinking' }]
    }
    return []
  }
  if (event.type === 'tool_execution_start') {
    return [{
      type: 'tool',
      data: {
        phase: 'call',
        callId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        inputPreview: safePreview(event.args),
      },
    }]
  }
  if (event.type === 'tool_execution_end') {
    return [{
      type: 'tool',
      data: {
        phase: 'result',
        callId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? 'failed' : 'completed',
        // Clean one-line summary (peel the tool-result envelope, parse inner
        // JSON) instead of an escaped raw dump (#608) — redacted like every
        // preview field: summaries echo tool output, which can carry the
        // secrets the tool was called with.
        summary: redactSummary(summarizeStructured(unwrapToolResult(event.result))),
      },
    }]
  }
  return []
}

/**
 * Subscribe the send-path activity tap (MessageArgs.onActivity, T8): the
 * shared event→chunk mapping filtered to tool/status. Callback exceptions
 * are contained — a throwing tap never fails the turn.
 */
function subscribeActivityTap(
  session: AgentSession,
  onActivity: (chunk: ChatChunk) => void,
  deps: PiMessagingDeps,
): () => void {
  const state = { announcedThinking: false }
  return session.subscribe((event: AgentSessionEvent) => {
    for (const chunk of sessionEventChunks(event, state)) {
      if (chunk.type !== 'tool' && chunk.type !== 'status') continue
      try {
        onActivity(chunk)
      } catch (err) {
        deps.getLogger?.()?.warn('adapter-pi: onActivity callback threw; contained', { error: String(err) })
      }
    }
  })
}

export function createMessagingSurface(deps: PiMessagingDeps): AgentRuntimeAdapter['messaging'] {
  async function runTurn<T>(
    args: MessageArgs,
    fn: (handle: TurnHandle, observer: TurnObserver) => Promise<T>,
  ): Promise<T> {
    return withThreadLock(args.agentId, args.threadId, async () => {
      if (args.signal?.aborted) {
        throw new RuntimeError('Pi turn aborted before start', { kind: 'aborted' })
      }
      const handle = await openTurnSession(args, deps)
      const observer = new TurnObserver()
      const unsubscribe = handle.session.subscribe(observer.onEvent)
      const onAbort = () => {
        void handle.session.abort()
      }
      args.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await fn(handle, observer)
      } finally {
        args.signal?.removeEventListener('abort', onAbort)
        unsubscribe()
        handle.dispose()
      }
    })
  }

  return {
    async send(args: MessageArgs): Promise<MessageResult> {
      return runTurn(args, async ({ session, record }, observer) => {
        const before = session.getSessionStats()
        const unsubscribeTap = args.onActivity ? subscribeActivityTap(session, args.onActivity, deps) : null
        try {
          await session.prompt(args.content, { images: imageContentsFor(args, record) })
        } catch (err) {
          throw toRuntimeError(err, {
            aborted: args.signal?.aborted,
            sessionId: session.sessionId,
            model: resolveModelRef(args.model, record.model),
          })
        } finally {
          unsubscribeTap?.()
        }
        if (args.signal?.aborted || observer.endedAborted) {
          throw new RuntimeError('Pi turn aborted', { kind: 'aborted' })
        }
        persistThreadMapping(record.id, args.threadId, session)
        throwOnTerminalFailure(observer, session, args, record)
        const after = session.getSessionStats()
        return {
          id: randomUUID(),
          content: session.getLastAssistantText() ?? observer.text,
          usage: usageDelta(before, after, session),
          metadata: { sessionId: session.sessionId },
        }
      })
    },

    stream(args: MessageArgs): AsyncIterable<ChatChunk> {
      const queue: ChatChunk[] = []
      let notify: (() => void) | null = null
      let finished = false
      const push = (chunk: ChatChunk) => {
        queue.push(chunk)
        notify?.()
      }
      const finish = () => {
        finished = true
        notify?.()
      }

      const turn = runTurn(args, async ({ session, record }, observer) => {
        const chunkState = { announcedThinking: false }
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          for (const chunk of sessionEventChunks(event, chunkState)) push(chunk)
        })
        try {
          await session.prompt(args.content, { images: imageContentsFor(args, record) })
          if (args.signal?.aborted || observer.endedAborted) {
            throw new RuntimeError('Pi turn aborted', { kind: 'aborted' })
          }
          persistThreadMapping(record.id, args.threadId, session)
          throwOnTerminalFailure(observer, session, args, record)
          push({ type: 'done' })
        } catch (err) {
          throw toRuntimeError(err, {
            aborted: args.signal?.aborted,
            sessionId: session.sessionId,
            model: resolveModelRef(args.model, record.model),
          })
        } finally {
          unsubscribe()
        }
      })

      turn.then(finish, (rawErr) => {
        // Normalize BEFORE classifying so pre-prompt raw throws (e.g. from
        // createAgentSession) carry a typed kind like everything else.
        const err = toRuntimeError(rawErr, { aborted: args.signal?.aborted })
        if (err.kind === 'aborted') {
          // Contract: a deliberate abort ends the stream with a clean done —
          // matching the send path's kind:'aborted' settle. Never an error chunk.
          push({ type: 'done' })
        } else {
          // Contract: the terminal error chunk carries the typed kind so
          // consumers classify without parsing message text.
          push({ type: 'error', content: err.message, data: { kind: err.kind } })
        }
        finish()
      })

      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            while (queue.length > 0) yield queue.shift()!
            if (finished) return
            await new Promise<void>((resolve) => {
              notify = resolve
            })
            notify = null
          }
        },
      }
    },
  }
}

/**
 * Terminal provider failure after prompt() resolved (see TurnObserver doc).
 * Partial streamed text upgrades the failure to a session-death diagnosis
 * so the recovery ladder can salvage; a clean failure classifies by its
 * provider message (429 → cooldown, etc.).
 */
function throwOnTerminalFailure(
  observer: TurnObserver,
  session: AgentSession,
  args: MessageArgs,
  record: PiAgentRecord,
): void {
  if (!observer.terminalError) return
  if (observer.text && !observer.sawDone) {
    throw buildStreamDeathError({
      sessionId: session.sessionId,
      partialText: observer.text,
      lastToolCall: observer.lastToolCall,
      detail: `Pi turn died after partial output: ${observer.terminalError}`,
      cause: new Error(observer.terminalError),
      oversizedOutputBytes: args.oversizedOutputBytes,
    })
  }
  throw toRuntimeError(new Error(observer.terminalError), {
    sessionId: session.sessionId,
    model: resolveModelRef(args.model, record.model),
  })
}

function redactSummary(value: string): string | undefined {
  if (!value) return undefined
  return redactSensitiveText(value)
}

function safePreview(value: unknown, cap = 200): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    // Previews leave the adapter (turn-activity SSE → every browser) —
    // redact before truncation, matching OpenClaw's previewUnknown parity.
    const text = redactSensitiveText(typeof value === 'string' ? value : JSON.stringify(value))
    return text.length > cap ? `${text.slice(0, cap)}…` : text
  } catch {
    return undefined
  }
}
