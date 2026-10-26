/** Render format for one streamed text segment. */
export type ConversationTextFormat = 'markdown' | 'plain' | 'code'

/** Structurally compatible tool activity accepted by the conversation folder. */
export interface ConversationToolActivity {
  phase: 'call' | 'result'
  callId?: string
  toolName: string
  status?: 'running' | 'completed' | 'failed' | string
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  exitCode?: number
  metadata?: Record<string, unknown>
}

/**
 * One normalized runtime chunk accepted by `foldConversation`.
 *
 * This structural contract is compatible with the SDK's `RuntimeChatChunk`
 * without coupling the private visual package to runtime or SDK packages.
 */
export type ConversationChunk =
  | { type: 'text'; content: string; format?: ConversationTextFormat; data?: Record<string, unknown> }
  | { type: 'tool'; content?: string; data: ConversationToolActivity }
  | { type: 'status'; content?: string; data?: Record<string, unknown> }
  | { type: 'done'; content?: string; data?: Record<string, unknown> }
  | { type: 'error'; content?: string; data?: Record<string, unknown> }

/**
 * Attachment as displayed in a conversation (URL-addressed, not path).
 * Structural copy of the SDK types entry's `DisplayAttachment`
 * (packages/sdk/src/types/conversation.ts) — this package imports nothing;
 * the SDK's private message-contract module fails typecheck if the two drift.
 */
export interface DisplayAttachment {
  name: string
  mimeType: string
  url: string
}

/**
 * One persisted conversation row accepted by the shared folding engine.
 * Structural copy of the SDK types entry's `ConversationMessage` (the canonical
 * home, packages/sdk/src/types/conversation.ts); pinned by the SDK's private
 * message-contract module.
 */
export type ConversationMessage =
  | { kind: 'user'; ts: string; content: string; attachments?: DisplayAttachment[] }
  | { kind: 'assistant'; ts: string; turnId?: string; agentId?: string; content: string }
  | {
      kind: 'tool'
      ts: string
      turnId?: string
      agentId?: string
      callId?: string
      toolName: string
      status?: 'running' | 'completed' | 'failed' | string
      summary?: string
      inputPreview?: string
      outputPreview?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }
  | { kind: 'error'; ts: string; turnId?: string; message: string; errorKind?: string }
  | { kind: 'aborted'; ts: string; turnId?: string }
  | { kind: 'done'; ts: string; turnId?: string }

/** One tool invocation inside an activity group. */
export interface ConversationToolCall {
  /** Stable render key (callId when present). */
  key: string
  callId?: string
  toolName: string
  status: 'running' | 'completed' | 'failed'
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

/**
 * One structured question an agent asked (`bakin_exec_ask_user`), carried on
 * its tool row as `metadata.bakinQuestion`. Structural copy of the SDK types
 * entry's `BakinQuestion`, pinned by the SDK's private message-contract module.
 */
export interface BakinQuestion {
  v: 1
  id: string
  question: string
  options: { label: string; description?: string }[]
  recommended?: number
  allowOther: boolean
}

/** Where a question card stands — derived from the transcript, never stored. */
export type QuestionState = 'open' | 'answered' | 'skipped'

/** One ordered item inside an agent turn. */
export type TurnItem =
  | { type: 'text'; format: ConversationTextFormat; content: string }
  | { type: 'activity'; calls: ConversationToolCall[] }
  | { type: 'error'; message: string; errorKind?: string }
  | {
      type: 'question'
      question: BakinQuestion
      state: QuestionState
      /** The chosen answer's text, when answered. */
      answer?: string
      /** True only for the newest open card in the conversation. */
      answerable: boolean
    }

/** What the user picked on a question card. */
export type QuestionAnswer =
  | { kind: 'option'; index: number }
  | { kind: 'other'; text: string }
  | { kind: 'unsure' }

const UNSURE_ANSWER = 'Not sure — help me choose'

function answerPrefix(question: BakinQuestion): string {
  return `**${question.question}** → `
}

/**
 * The user message a card answer sends. Plain, readable text — the agent
 * needs no special parsing, and the same prefix lets the fold recognise the
 * answer when it derives the card's state.
 */
export function formatQuestionAnswer(question: BakinQuestion, answer: QuestionAnswer, note?: string): string {
  const choice = answer.kind === 'option'
    ? question.options[answer.index]?.label ?? ''
    : answer.kind === 'other' ? answer.text.trim() : UNSURE_ANSWER
  const trimmedNote = note?.trim()
  return `${answerPrefix(question)}${choice}${trimmedNote ? `\n\n${trimmedNote}` : ''}`
}

function isBakinQuestion(value: unknown): value is BakinQuestion {
  if (!value || typeof value !== 'object') return false
  const q = value as Partial<BakinQuestion>
  return q.v === 1
    && typeof q.id === 'string'
    && typeof q.question === 'string'
    && typeof q.allowOther === 'boolean'
    && Array.isArray(q.options)
    && q.options.length >= 2
    && q.options.every(option => !!option && typeof option.label === 'string')
}

/** Lifecycle state for an agent turn. */
export type TurnStatus = 'streaming' | 'complete' | 'error' | 'aborted'

/** Render-ready user or agent turn produced by `foldConversation`. */
export type ConversationTurn =
  | { kind: 'user'; key: string; ts: string; content: string; attachments?: DisplayAttachment[] }
  | {
      kind: 'agent'
      key: string
      ts?: string
      /** Author agent, when known. */
      agentId?: string
      /** Durable join key for per-turn usage and related metadata. */
      turnId?: string
      items: TurnItem[]
      status: TurnStatus
      /** Latest runtime status label, meaningful while streaming. */
      statusLabel?: string
    }

/** Optional in-flight state folded after persisted conversation rows. */
export interface FoldOptions {
  /** Raw chunks of the in-flight turn; presence, even empty, appends a live turn. */
  liveChunks?: readonly ConversationChunk[]
  /** Author of the live turn, when known. */
  liveAgentId?: string
}

interface AgentTurnBuilder {
  items: TurnItem[]
  status: TurnStatus
  statusLabel?: string
  ts?: string
  agentId?: string
  byCallId: Map<string, ConversationToolCall>
  keyCounter: number
}

function newBuilder(): AgentTurnBuilder {
  return { items: [], status: 'complete', byCallId: new Map(), keyCounter: 0 }
}

function lastActivity(builder: AgentTurnBuilder): Extract<TurnItem, { type: 'activity' }> | null {
  const last = builder.items[builder.items.length - 1]
  return last && last.type === 'activity' ? last : null
}

function settledStatus(status: string | undefined): 'completed' | 'failed' {
  return status === 'failed' ? 'failed' : 'completed'
}

/** Swap a question tool result (and its running call, if any) for a question item. */
function addQuestion(builder: AgentTurnBuilder, data: ConversationToolActivity, question: BakinQuestion): void {
  const running = data.callId ? builder.byCallId.get(data.callId) : undefined
  if (running) {
    builder.byCallId.delete(data.callId!)
    for (let i = builder.items.length - 1; i >= 0; i--) {
      const item = builder.items[i]
      if (item.type !== 'activity' || !item.calls.includes(running)) continue
      item.calls = item.calls.filter(call => call !== running)
      if (item.calls.length === 0) builder.items.splice(i, 1)
      break
    }
  }
  builder.items.push({ type: 'question', question, state: 'open', answerable: false })
}

function addToolActivity(builder: AgentTurnBuilder, data: ConversationToolActivity): void {
  if (!data.toolName) return
  const question = data.phase === 'result' ? data.metadata?.bakinQuestion : undefined
  if (isBakinQuestion(question)) {
    addQuestion(builder, data, question)
    return
  }
  const status: ConversationToolCall['status'] =
    data.phase === 'result' ? settledStatus(data.status) : 'running'

  let existing: ConversationToolCall | undefined
  if (data.callId) {
    existing = builder.byCallId.get(data.callId)
  } else if (data.phase === 'result') {
    for (let i = builder.items.length - 1; i >= 0 && !existing; i--) {
      const item = builder.items[i]
      if (item.type !== 'activity') continue
      for (let j = item.calls.length - 1; j >= 0; j--) {
        const call = item.calls[j]
        if (call.toolName === data.toolName && call.status === 'running') {
          existing = call
          break
        }
      }
    }
  }

  if (existing) {
    existing.status = status
    if (data.summary) existing.summary = data.summary
    if (data.inputPreview) existing.inputPreview = data.inputPreview
    if (data.outputPreview) existing.outputPreview = data.outputPreview
    if (data.durationMs !== undefined) existing.durationMs = data.durationMs
    if (data.metadata) existing.metadata = { ...existing.metadata, ...data.metadata }
    return
  }

  const call: ConversationToolCall = {
    key: data.callId ?? `call-${builder.keyCounter++}`,
    ...(data.callId ? { callId: data.callId } : {}),
    toolName: data.toolName,
    status,
    ...(data.summary ? { summary: data.summary } : {}),
    ...(data.inputPreview ? { inputPreview: data.inputPreview } : {}),
    ...(data.outputPreview ? { outputPreview: data.outputPreview } : {}),
    ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
    ...(data.metadata ? { metadata: data.metadata } : {}),
  }
  if (data.callId) builder.byCallId.set(data.callId, call)

  const group = lastActivity(builder)
  if (group) group.calls.push(call)
  else builder.items.push({ type: 'activity', calls: [call] })
}

function addText(builder: AgentTurnBuilder, content: string, format: ConversationTextFormat): void {
  if (!content) return
  const last = builder.items[builder.items.length - 1]
  if (last && last.type === 'text' && last.format === format) {
    last.content += content
  } else {
    builder.items.push({ type: 'text', format, content })
  }
}

function foldLiveChunks(chunks: readonly ConversationChunk[]): AgentTurnBuilder {
  const builder = newBuilder()
  builder.status = 'streaming'
  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'text':
        addText(builder, chunk.content, chunk.format ?? 'markdown')
        break
      case 'tool':
        addToolActivity(builder, chunk.data)
        break
      case 'status':
        if (chunk.content) builder.statusLabel = chunk.content
        break
      case 'error':
        builder.items.push({
          type: 'error',
          message: chunk.content || 'turn failed',
          ...(typeof chunk.data?.kind === 'string' ? { errorKind: chunk.data.kind } : {}),
        })
        builder.status = 'error'
        break
      case 'done':
        if (builder.status === 'streaming') builder.status = 'complete'
        break
    }
  }
  return builder
}

function finishAgentTurn(
  builder: AgentTurnBuilder,
  key: string,
  turnId?: string,
): ConversationTurn {
  return {
    kind: 'agent',
    key,
    ...(builder.ts ? { ts: builder.ts } : {}),
    ...(builder.agentId ? { agentId: builder.agentId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    items: builder.items,
    status: builder.status,
    ...(builder.statusLabel ? { statusLabel: builder.statusLabel } : {}),
  }
}

/**
 * Fold persisted rows and optional live chunks into stable renderable turns.
 * Text and tool activity preserve arrival order, and call results settle their
 * matching call even when intervening text starts a new activity group.
 */
export function foldConversation(
  messages: readonly ConversationMessage[],
  opts?: FoldOptions,
): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let current: AgentTurnBuilder | null = null
  let currentTurnId: string | undefined
  let agentTurnIndex = 0

  const flush = () => {
    if (!current) return
    turns.push(finishAgentTurn(current, `agent-${agentTurnIndex++}`, currentTurnId))
    current = null
    currentTurnId = undefined
  }

  for (const row of messages) {
    if (row.kind === 'user') {
      flush()
      turns.push({
        kind: 'user',
        key: `user-${turns.length}`,
        ts: row.ts,
        content: row.content,
        ...(row.attachments?.length ? { attachments: row.attachments } : {}),
      })
      continue
    }

    // Terminal markers are persistence evidence, not visible turn content.
    if (row.kind === 'done') continue

    const rowTurnId = row.turnId
    if (current && rowTurnId !== undefined && currentTurnId !== undefined && rowTurnId !== currentTurnId) {
      flush()
    }
    if (!current) {
      current = newBuilder()
      current.ts = row.ts
      currentTurnId = rowTurnId
    }
    if (currentTurnId === undefined && rowTurnId !== undefined) currentTurnId = rowTurnId
    if (!current.agentId && 'agentId' in row && row.agentId) current.agentId = row.agentId

    switch (row.kind) {
      case 'assistant':
        addText(current, row.content, 'markdown')
        break
      case 'tool':
        addToolActivity(current, {
          phase: 'result',
          toolName: row.toolName,
          ...(row.callId ? { callId: row.callId } : {}),
          status: row.status,
          ...(row.summary ? { summary: row.summary } : {}),
          ...(row.inputPreview ? { inputPreview: row.inputPreview } : {}),
          ...(row.outputPreview ? { outputPreview: row.outputPreview } : {}),
          ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
          ...(row.metadata ? { metadata: row.metadata } : {}),
        })
        break
      case 'error':
        current.items.push({
          type: 'error',
          message: row.message,
          ...(row.errorKind ? { errorKind: row.errorKind } : {}),
        })
        current.status = 'error'
        break
      case 'aborted':
        current.status = 'aborted'
        break
    }
  }
  flush()

  if (opts?.liveChunks) {
    const live = foldLiveChunks(opts.liveChunks)
    if (opts.liveAgentId) live.agentId = opts.liveAgentId
    turns.push(finishAgentTurn(live, `live-${agentTurnIndex}`))
  }

  deriveQuestionStates(turns)
  return turns
}

/**
 * The user turn after a card decides it: the formatted answer prefix means
 * answered, anything else means the user moved on (skipped). Only the newest
 * still-open card can be answered.
 */
function deriveQuestionStates(turns: ConversationTurn[]): void {
  let newestOpen: Extract<TurnItem, { type: 'question' }> | null = null
  turns.forEach((turn, index) => {
    if (turn.kind !== 'agent') return
    const reply = turns.slice(index + 1).find(next => next.kind === 'user')
    for (const item of turn.items) {
      if (item.type !== 'question') continue
      item.answerable = false
      if (!reply || reply.kind !== 'user') {
        item.state = 'open'
        newestOpen = item
        continue
      }
      const prefix = answerPrefix(item.question)
      if (reply.content.startsWith(prefix)) {
        item.state = 'answered'
        item.answer = reply.content.slice(prefix.length).split('\n\n')[0]
      } else {
        item.state = 'skipped'
      }
    }
  })
  if (newestOpen) (newestOpen as Extract<TurnItem, { type: 'question' }>).answerable = true
}
