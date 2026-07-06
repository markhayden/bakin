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

import { buildStreamDeathError, toRuntimeError } from './errors'
import { getAgentWorkspaceDir, getPiAgentDir } from './home'
import { findPiModel, getModelRegistry, qualifiedModelId } from './models'
import { readRegistry, scaffoldAgentDirs, type PiAgentRecord } from './registry'
import { recordThreadSession, sessionManagerForThread, withThreadLock } from './sessions'
import { buildAppendSystemPrompt } from './system-prompt'
import { bridgeExecTools, filterExecToolDescriptors } from './tool-bridge'

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

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

function imageContentsFor(args: MessageArgs, record: PiAgentRecord) {
  if (!args.attachments || args.attachments.length === 0) return undefined
  const model = findPiModel(args.model ?? record.model)
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

async function openTurnSession(args: MessageArgs, deps: PiMessagingDeps): Promise<TurnHandle> {
  const record = requireAgent(args.agentId)
  scaffoldAgentDirs(record.id)
  const workspace = getAgentWorkspaceDir(record.id)
  const agentDir = getPiAgentDir()
  const { auth, registry: modelRegistry } = getModelRegistry()

  const settingsManager = SettingsManager.create(workspace, agentDir, { projectTrusted: true })
  const retry = deps.getSettings?.()?.retry
  if (retry && typeof retry === 'object') {
    // Bakin's dispatch owns the outer retry ladder; installs can tune or
    // disable Pi's inner auto-retry via settings.runtime.settings.retry.
    settingsManager.applyOverrides({ retry: retry as never })
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    // v1: Pi TUI extensions/themes/templates stay out of the server process;
    // skills + AGENTS.md context files are the personality surface.
    noExtensions: true,
    noThemes: true,
    noPromptTemplates: true,
    appendSystemPrompt: buildAppendSystemPrompt(record.id),
  })
  await resourceLoader.reload()

  const execProvider = deps.getExecTools()
  const descriptors = execProvider ? filterExecToolDescriptors(execProvider.list(), args, record.allowlist) : []
  const customTools = execProvider ? bridgeExecTools(execProvider, record.id, descriptors) : []

  const model = findPiModel(args.model ?? record.model)
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
        try {
          await session.prompt(args.content, { images: imageContentsFor(args, record) })
        } catch (err) {
          throw toRuntimeError(err, {
            aborted: args.signal?.aborted,
            sessionId: session.sessionId,
            model: args.model ?? record.model,
          })
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
        let announcedThinking = false
        const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
          if (event.type === 'message_update') {
            const delta = event.assistantMessageEvent
            if (delta.type === 'text_delta') {
              push({ type: 'text', content: delta.delta })
            } else if (delta.type === 'thinking_start' && !announcedThinking) {
              announcedThinking = true
              push({ type: 'status', content: 'thinking' })
            }
          } else if (event.type === 'tool_execution_start') {
            push({
              type: 'tool',
              data: {
                phase: 'call',
                callId: event.toolCallId,
                toolName: event.toolName,
                status: 'running',
                inputPreview: safePreview(event.args),
              },
            })
          } else if (event.type === 'tool_execution_end') {
            push({
              type: 'tool',
              data: {
                phase: 'result',
                callId: event.toolCallId,
                toolName: event.toolName,
                status: event.isError ? 'failed' : 'completed',
                summary: safePreview(event.result),
              },
            })
          }
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
            model: args.model ?? record.model,
          })
        } finally {
          unsubscribe()
        }
      })

      turn.then(finish, (err) => {
        push({ type: 'error', content: err instanceof Error ? err.message : String(err) })
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
    })
  }
  throw toRuntimeError(new Error(observer.terminalError), {
    sessionId: session.sessionId,
    model: args.model ?? record.model,
  })
}

function safePreview(value: unknown, cap = 200): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > cap ? `${text.slice(0, cap)}…` : text
  } catch {
    return undefined
  }
}
