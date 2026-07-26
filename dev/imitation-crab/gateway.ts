/**
 * Mock OpenClaw gateway.
 * Handles the HTTP endpoints Bakin uses plus the Gateway RPC contract used
 * by chat:
 *   GET  /health
 *   POST /tools/invoke
 *   RPC  agent, chat.abort
 *
 * Push-event emulation (prelaunch-hardening T6): when the transport provides
 * a GatewayRpcContext, the `agent` RPC behaves like the real 2026.6.11 wire
 * (tests/fixtures/openclaw-gateway-frames/): an `accepted` ack res on the
 * request id first, then pushed `chat` deltas (deltaText + FULL cumulative
 * text), `agent` lifecycle/assistant/tool/item/command_output frames, and
 * health/tick broadcast noise, before the final res. Message markers script
 * scenarios: `[[tool]]` adds a tool-call frame sequence, `[[dropped-delta]]`
 * skips a middle delta frame (cumulative jump → the adapter must self-heal).
 * `chat.abort {runId|sessionKey}` cancels a pending run: `{aborted:true,
 * runIds}`, a terminal `chat state:'aborted'` frame, and the post-abort
 * final (`status:'timeout'`, `stopReason:'aborted'`) — the recorded shapes.
 *
 * KNOWN DIVERGENCES from the real recordings (none consulted by the adapter
 * today — it matches on `state`/`stream` and ignores seq; keep this list in
 * sync before trusting the mock for a new frame field):
 *  - the terminal aborted `chat` frame says `stopReason:'aborted'`; the real
 *    wire recorded `stopReason:'rpc'`;
 *  - the real wire re-emits a post-abort lifecycle pair reusing the runId
 *    with payload seq RESTARTING at 1 — the mock omits that second emitter;
 *  - the real post-abort final carries `result.payloads:[{text:"LLM request
 *    timed out."}]`; the mock returns empty payloads;
 *  - the real `chat.abort` response payload includes an inner `ok:true`
 *    alongside `aborted`; the mock's payload has only `{aborted, runIds}`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { getChatDelayMs, getChatMode, getGatewayPort, getMockHome, getToolMode } from './env'

const { WebSocketServer } = require('ws') as { WebSocketServer: new (opts: { noServer: boolean }) => WsServer }

interface WsClient { send(data: string): void; on(event: string, fn: (data: Buffer) => void): void; terminate(): void }
interface WsServer { handleUpgrade(req: IncomingMessage, socket: unknown, head: Buffer, cb: (ws: WsClient) => void): void; on(event: string, fn: (ws: WsClient) => void): void; emit(event: string, ...args: unknown[]): void; clients: Set<WsClient>; close(): void }

export interface ImitationCrabGateway {
  port: number
  url: string
  close(): Promise<void>
}

export interface StartGatewayOptions {
  registerSignals?: boolean
}

// Agent name lookup for canned responses
const AGENT_NAMES: Record<string, string> = {
  main: 'Margo',
  pixel: 'Pixel',
  rolo: 'Rolo',
  jessica: 'Jessica',
  patch: 'Patch',
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Transport seam: lets an RPC handler push extra frames (ack res, events). */
export interface GatewayRpcContext {
  requestId: string
  push(frame: Record<string, unknown>): void
}

/** One in-flight agent run, cancellable via chat.abort (by runId or sessionKey). */
interface ActiveRun {
  runId: string
  sessionKey: string
  agentId: string
  /** Cumulative assistant text pushed so far — the aborted frame carries it. */
  emitted: string
  aborted: boolean
  /** Wakes any abortable sleep the run is parked in. */
  cancels: Set<() => void>
  /** Frame channel of the connection that started the run (null: direct call). */
  push: ((frame: Record<string, unknown>) => void) | null
  payloadSeq: number
}

// Runs keyed by runId — the gateway's own abort registry shape. chat.abort
// resolves runId first, then sessionKey; mirrors the real {ok, aborted,
// runIds} response so the adapter's response-checked abort can be exercised
// end-to-end in dev/tests.
const activeRuns = new Map<string, ActiveRun>()

// Connection-global frame seq, like the real wire's top-level frame.seq.
let frameSeq = 0
let runCounter = 0

// Test observability: what the mock saw (runs started, aborts received).
// `finalSentAt` stamps when the happy-path final RPC payload was produced —
// liveness tests compare it against when the consumer first SAW streamed text.
interface ObservedAgentRun {
  runId: string
  sessionKey: string
  agentId: string
  finalSentAt?: number
}
const observedAgentRuns: ObservedAgentRun[] = []
const observedChatAborts: Array<{ runId?: string; sessionKey?: string }> = []

export function getObservedAgentRuns(): ReadonlyArray<ObservedAgentRun> {
  return observedAgentRuns
}

export function getObservedChatAborts(): ReadonlyArray<{ runId?: string; sessionKey?: string }> {
  return observedChatAborts
}

export function resetGatewayObservations(): void {
  observedAgentRuns.length = 0
  observedChatAborts.length = 0
}

/** Resolves false when the delay elapses, true when chat.abort cancels it. */
function abortableRunSleep(run: ActiveRun, ms: number): Promise<boolean> {
  if (run.aborted) return Promise.resolve(true)
  return new Promise((resolve) => {
    const cancel = () => {
      clearTimeout(timer)
      run.cancels.delete(cancel)
      resolve(true)
    }
    const timer = setTimeout(() => {
      run.cancels.delete(cancel)
      resolve(false)
    }, ms)
    run.cancels.add(cancel)
  })
}

/** Push one event frame on the run's connection, real-wire enveloped. */
function pushRunEvent(run: ActiveRun, event: 'chat' | 'agent', payload: Record<string, unknown>): void {
  run.push?.({
    type: 'event',
    event,
    payload: { runId: run.runId, sessionKey: run.sessionKey, seq: ++run.payloadSeq, ...payload },
    seq: ++frameSeq,
  })
}

function pushChatDelta(run: ActiveRun, deltaText: string, cumulative: string): void {
  run.emitted = cumulative
  pushRunEvent(run, 'chat', {
    state: 'delta',
    deltaText,
    message: { role: 'assistant', content: [{ type: 'text', text: cumulative }] },
  })
}

function pushAgentFrame(run: ActiveRun, stream: string, data: Record<string, unknown>): void {
  pushRunEvent(run, 'agent', { agentId: run.agentId, stream, ts: Date.now(), data })
}

/** The recorded tool-call sequence: tool start/result + item/command_output mirrors. */
async function pushToolSequence(run: ActiveRun): Promise<void> {
  pushAgentFrame(run, 'tool', { phase: 'start', name: 'exec', toolCallId: 'tc-1', args: { command: 'ls' } })
  pushAgentFrame(run, 'item', { itemId: 'item-1', phase: 'start', kind: 'tool', title: 'exec', status: 'running', name: 'exec', toolCallId: 'tc-1' })
  await abortableRunSleep(run, 8)
  pushAgentFrame(run, 'command_output', { itemId: 'item-1', phase: 'delta', output: 'README.md\n', toolCallId: 'tc-1' })
  pushAgentFrame(run, 'tool', { phase: 'result', name: 'exec', toolCallId: 'tc-1', result: 'README.md\n', isError: false })
  pushAgentFrame(run, 'command_output', { itemId: 'item-1', phase: 'end', output: 'README.md\n', exitCode: 0, durationMs: 12, toolCallId: 'tc-1' })
  pushAgentFrame(run, 'item', { itemId: 'item-1', phase: 'end', kind: 'tool', title: 'exec', status: 'done', name: 'exec', toolCallId: 'tc-1' })
}

/** Split a reply into ~3 word-boundary deltas (real deltas are coalesced text runs). */
function splitIntoDeltas(reply: string): string[] {
  const words = reply.split(' ')
  if (words.length < 3) return [reply]
  const third = Math.ceil(words.length / 3)
  const parts = [
    words.slice(0, third).join(' '),
    ' ' + words.slice(third, third * 2).join(' '),
    ' ' + words.slice(third * 2).join(' '),
  ]
  return parts.filter((part) => part.length > 0)
}

/** The recorded post-abort final: status timeout, classified by stopReason. */
function postAbortFinal(run: ActiveRun): GatewayRpcResponse {
  return {
    ok: true,
    payload: {
      runId: run.runId,
      status: 'timeout',
      summary: 'aborted',
      stopReason: 'aborted',
      result: { payloads: [], meta: {} },
    },
  }
}

/**
 * Mirror the real gateway's sessions.json bookkeeping: one entry per
 * sessionKey holding the CURRENT sessionId plus timing metadata (the shape
 * `sessions.list/get` reads — see packages/adapter-openclaw/src/sessions.ts).
 * Written at run acceptance like the real wire; sessionStartedAt is
 * preserved across turns on the same key, updatedAt refreshes.
 */
function recordSessionStoreEntry(agentId: string, sessionKey: string, sessionId: string | null): void {
  const dir = join(getMockHome(), 'agents', agentId, 'sessions')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'sessions.json')
  let store: Record<string, Record<string, unknown>> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (parsed && typeof parsed === 'object') store = parsed as Record<string, Record<string, unknown>>
  } catch {
    // Missing/corrupt store starts fresh — bookkeeping, not source of truth.
  }
  const existing = store[sessionKey]
  const now = Date.now()
  const resolvedSessionId = sessionId ?? (typeof existing?.sessionId === 'string' ? existing.sessionId : randomUUID())
  // Context accounting (#737): mirror the real gateway's per-session
  // context fields so sessions.contextStats is exercisable end-to-end —
  // the "prompt" grows a fixed amount per turn against the mock window,
  // and totalTokensFresh gates the reading exactly like the real wire.
  const priorTotal = typeof existing?.totalTokens === 'number' ? existing.totalTokens : 1_000
  store[sessionKey] = {
    ...existing,
    sessionId: resolvedSessionId,
    // The real gateway always writes sessionFile — mirror it so the adapter's
    // primary path (store-provided file) is what e2e exercises, not only the
    // synthesized-path fallback.
    sessionFile: join(dir, `${resolvedSessionId}.jsonl`),
    sessionStartedAt: typeof existing?.sessionStartedAt === 'number' ? existing.sessionStartedAt : now,
    updatedAt: now,
    model: 'mock-model',
    chatType: 'direct',
    contextTokens: 272_000,
    totalTokens: priorTotal + 500,
    totalTokensFresh: true,
  }
  writeFileSync(path, JSON.stringify(store, null, 2))
}

/**
 * Simulate OpenClaw recording an oversized-interrupted run: the trajectory
 * gets a session.started → tool.call → oversized model.completed →
 * session.ended(interrupted) sequence, exactly the incident shape. Written
 * shortly after the turn is accepted so the adapter's fail-fast watcher has
 * something to find while the request is still pending.
 */
function writeSessionDeathTrajectory(agentId: string, sessionId: string): void {
  const dir = join(getMockHome(), 'agents', agentId, 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sessionId}.trajectory.jsonl`)
  const oversized = 'X'.repeat(262_144) // OpenClaw's trajectory text limit
  const base = {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: sessionId,
    source: 'runtime',
    sessionId,
    runId: `mock-run-${sessionId.slice(0, 8)}`,
    provider: 'imitation-crab',
    modelId: 'mock-model',
  }
  const events = [
    { ...base, type: 'session.started', seq: 1, data: { toolCount: 5 } },
    { ...base, type: 'tool.call', seq: 2, data: { name: 'bakin_exec_tasks_log_progress', toolCallId: 'tc-1' } },
    {
      ...base,
      type: 'model.completed',
      seq: 3,
      data: {
        timedOut: false,
        aborted: false,
        promptError: null,
        usage: { input: 42000, output: 90000, total: 132000 },
        assistantTexts: [oversized],
      },
    },
    { ...base, type: 'session.ended', seq: 4, data: { status: 'interrupted', timedOut: false, promptError: null } },
  ].map((event, index) => JSON.stringify({ ...event, ts: new Date(Date.now() + index).toISOString() }))
  appendFileSync(file, events.join('\n') + '\n')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

type GatewayRequest = {
  method?: string
  url?: string
  headers?: IncomingMessage['headers']
  body?: string
}

type GatewayResponse = {
  status: number
  body: unknown
}

type GatewayRpcResponse = {
  ok: boolean
  payload?: unknown
  error?: { message: string; code?: string }
}

export async function handleGatewayRpcRequest(method: string, params: Record<string, unknown>, ctx?: GatewayRpcContext): Promise<GatewayRpcResponse> {
  if (method === 'chat.abort') {
    const runId = typeof params.runId === 'string' ? params.runId : undefined
    const sessionKey = typeof params.sessionKey === 'string' ? params.sessionKey : undefined
    observedChatAborts.push({ ...(runId ? { runId } : {}), ...(sessionKey ? { sessionKey } : {}) })
    // Resolution mirrors the real registry: exact runId first, then the
    // canonical sessionKey (T5 sends both from the accepted ack).
    let run = runId ? activeRuns.get(runId) : undefined
    if (!run && sessionKey) {
      run = [...activeRuns.values()].find((candidate) => candidate.sessionKey === sessionKey)
    }
    console.log(`  → rpc=chat.abort runId=${runId ?? '-'} sessionKey=${sessionKey ?? '-'} matched=${run?.runId ?? 'none'}`)
    if (!run) return { ok: true, payload: { aborted: false, runIds: [] } }
    activeRuns.delete(run.runId)
    run.aborted = true
    for (const cancel of [...run.cancels]) cancel()
    // Terminal aborted frame carries the partial cumulative text, like the
    // recorded wire (abort-turn.jsonl).
    pushRunEvent(run, 'chat', {
      state: 'aborted',
      stopReason: 'aborted',
      message: { role: 'assistant', content: [{ type: 'text', text: run.emitted }] },
    })
    return { ok: true, payload: { aborted: true, runIds: [run.runId] } }
  }

  if (method === 'connect') {
    return {
      ok: true,
      payload: { type: 'hello-ok', protocol: 4, auth: { scopes: Array.isArray(params.scopes) ? params.scopes : [] } },
    }
  }

  if (method === 'agent') {
    const agentId = typeof params.agentId === 'string' && params.agentId.length > 0 ? params.agentId : 'unknown'
    const agentName = AGENT_NAMES[agentId] || agentId
    const userMessage = typeof params.message === 'string' ? params.message : ''
    const mode = getChatMode()

    // Failure modes keep their pre-streaming shapes: the real gateway's
    // failures Bakin cares about are res frames, not event streams.
    if (mode === 'error') {
      return { ok: false, error: { message: 'Mock error mode', code: 'mock_error' } }
    }
    if (mode === 'idle-timeout') {
      // The shape OpenClaw's codex app-server produces when a run ends
      // before reporting completion — the adapter maps this to a
      // RuntimeTurnError(runtime_timeout).
      return {
        ok: false,
        error: { message: 'codex app-server turn idle timed out waiting for turn/completed', code: 'turn_completion_idle_timeout' },
      }
    }
    if (mode === 'session-death') {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
      if (!sessionId) {
        // Unthreaded sends have no trajectory for forensics — fall back to
        // the structured idle-timeout shape so the failure is still typed.
        return {
          ok: false,
          error: { message: 'codex app-server turn idle timed out waiting for turn/completed', code: 'turn_completion_idle_timeout' },
        }
      }
      console.log(`  → rpc=agent agent=${agentId} mode=session-death session=${sessionId}`)
      // Record the death on disk ~150ms into the turn, and never send a
      // final frame: the accepted-ack below keeps the request pending so
      // the adapter's fail-fast trajectory watcher must catch it.
      setTimeout(() => {
        try {
          writeSessionDeathTrajectory(agentId, sessionId)
        } catch (err) {
          console.error('  → session-death trajectory write failed:', err)
        }
      }, 150)
      return { ok: true, payload: { status: 'accepted' } }
    }

    // Scenario markers script the streaming shape; they never reach the reply.
    const wantsTool = userMessage.includes('[[tool]]')
    const wantsDroppedDelta = userMessage.includes('[[dropped-delta]]')
    // [[slow]] — the chat-queue showcase (#729): a long reply streamed
    // word-by-word for ~15s, giving a human-scale busy window to type and
    // queue follow-ups, hit Stop mid-stream (partial text kept), and watch
    // the combined drain. Per-message, unlike OPENCLAW_MOCK_CHAT_MODE=slow
    // which parks BEFORE streaming and slows every turn globally.
    const wantsSlow = userMessage.includes('[[slow]]')
    const cleanMessage = userMessage.replace(/ ?\[\[(tool|dropped-delta|slow)\]\]/g, '')

    // Acknowledge inbound attachments (the real gateway's native `attachments`
    // param) so chat-attachment e2e drives can assert the pixels arrived.
    const attachmentCount = Array.isArray(params.attachments) ? params.attachments.length : 0
    const attachmentNote = attachmentCount ? ` [saw ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}]` : ''

    const reply = (wantsSlow
      ? `[mock:${agentName}] Taking my time with this one. ` +
        'Let me think it through step by step: first I would survey the request, then weigh the options, ' +
        'then settle on the simplest approach that holds up. While I keep typing you can queue follow-up ' +
        'messages, remove one you regret, or hit Stop — anything queued sends the moment this reply settles. ' +
        'Almost there now; wrapping up the slow streamed reply.'
      : mode === 'echo'
        ? `[mock:${agentName}] ${cleanMessage}`
        : mode === 'slow'
          ? `[mock:${agentName}] Acknowledged after a slow turn.`
          : `[mock:${agentName}] Acknowledged. Task understood — working on it.`) + attachmentNote

    // Real-wire run identity: runId echoes the client idempotencyKey; the
    // canonical sessionKey is agent:<id>:explicit:<sessionId> for threaded
    // turns (verified via sessions.list), agent:<id>:main otherwise.
    //
    // UPSTREAM DEFECT MIRROR (OpenClaw 2026.6.11, fixture
    // abort-explicit-session.jsonl): a run addressed by `sessionId` alone —
    // no `sessionKey` param — is never registered in the gateway's
    // chat-abort registry: its ack OMITS sessionKey and chat.abort /
    // sessions.abort cannot stop it. Senders must pass BOTH (the adapter
    // does since the 2026-07-09 fix). The pin CANNOT detect an upstream fix
    // by itself (it tests this mirror) — the real-wire owner is rig-validate
    // phase R7; when R7.2 reports the defect gone, delete this mirror + the
    // pins. NOTE: sessionKey-only sends (no sessionId) registering as
    // abortable is UNVERIFIED against the real wire — the live probes only
    // covered sessionId-only (defect) and sessionId+sessionKey (fix shape);
    // the real gateway also mints a different sessionId for key-only sends.
    const runId = typeof params.idempotencyKey === 'string' && params.idempotencyKey.length > 0
      ? params.idempotencyKey
      : `mock-run-${++runCounter}`
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
    const requestedSessionKey = typeof params.sessionKey === 'string' ? params.sessionKey : null
    const sessionKey = requestedSessionKey
      ?? (sessionId ? `agent:${agentId}:explicit:${sessionId}` : `agent:${agentId}:main`)
    const abortRegistered = Boolean(requestedSessionKey) || !sessionId
    const run: ActiveRun = {
      runId,
      sessionKey,
      agentId,
      emitted: '',
      aborted: false,
      cancels: new Set(),
      push: ctx ? ctx.push : null,
      payloadSeq: 0,
    }
    if (abortRegistered) activeRuns.set(runId, run)
    recordSessionStoreEntry(agentId, sessionKey, sessionId)
    const observed: ObservedAgentRun = { runId, sessionKey, agentId }
    observedAgentRuns.push(observed)
    console.log(`  → rpc=agent agent=${agentId} run=${runId} registered=${abortRegistered} message=${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}`)

    try {
      // Accepted ack res on the request id BEFORE the final — the adapter's
      // onAccepted seam (and its abort addressing) hangs off this. The ack
      // carries sessionKey ONLY for abort-registered runs (real-wire
      // behavior; unregistered sessionId-only runs get a bare ack).
      ctx?.push({
        type: 'res',
        id: ctx.requestId,
        ok: true,
        payload: {
          status: 'accepted',
          runId,
          ...(abortRegistered ? { sessionKey } : {}),
          acceptedAt: Date.now(),
        },
      })
      pushAgentFrame(run, 'lifecycle', { phase: 'start', status: 'running', startedAt: Date.now() })

      if (mode === 'slow') {
        const aborted = await abortableRunSleep(run, getChatDelayMs())
        if (aborted) {
          console.log(`  → rpc=agent agent=${agentId} run=${runId} mode=slow ABORTED`)
          return postAbortFinal(run)
        }
      }

      if (ctx) {
        // Broadcast noise rides alongside run frames on the real wire.
        ctx.push({ type: 'event', event: 'health', payload: { status: 'ok' }, seq: ++frameSeq })

        if (wantsTool) await pushToolSequence(run)
        if (run.aborted) return postAbortFinal(run)

        // [[slow]] streams word-by-word with human-visible pacing (~200ms
        // per word ≈ 15s for the long reply); normal turns stream in thirds
        // with 8ms gaps. Both sleeps are abortable — Stop mid-stream keeps
        // the cumulative partial text in the aborted final.
        const deltas = wantsSlow
          ? reply.split(' ').map((w, i) => (i === 0 ? w : ` ${w}`))
          : splitIntoDeltas(reply)
        let cumulative = ''
        for (const [index, delta] of deltas.entries()) {
          cumulative += delta
          const dropThisFrame = wantsDroppedDelta && deltas.length >= 3 && index === 1
          if (dropThisFrame) {
            // dropIfSlow emulation: the frame vanishes but later cumulative
            // text includes its content — the adapter must self-heal.
            run.emitted = cumulative
          } else {
            pushChatDelta(run, delta, cumulative)
            // The real assistant stream mirrors every chat delta 1:1 — the
            // adapter must treat it as noise (text rides `chat` only).
            pushAgentFrame(run, 'assistant', { text: cumulative, delta })
          }
          if (await abortableRunSleep(run, wantsSlow ? 200 : 8)) return postAbortFinal(run)
        }

        ctx.push({ type: 'event', event: 'tick', payload: {}, seq: ++frameSeq })
        pushRunEvent(run, 'chat', {
          state: 'final',
          message: { role: 'assistant', content: [{ type: 'text', text: reply }] },
        })
        pushAgentFrame(run, 'lifecycle', { phase: 'finishing', status: 'running' })
        pushAgentFrame(run, 'lifecycle', { phase: 'end', status: 'ok', stopReason: 'completed', endedAt: Date.now() })
      }

      observed.finalSentAt = Date.now()
      return {
        ok: true,
        payload: {
          runId,
          status: 'ok',
          summary: 'completed',
          result: {
            payloads: [{ text: reply, mediaUrl: null }],
            meta: {
              finalAssistantVisibleText: reply,
              finalAssistantRawText: reply,
            },
          },
        },
      }
    } finally {
      activeRuns.delete(runId)
    }
  }

  return { ok: false, error: { message: `Unknown mock Gateway method: ${method}`, code: 'not_found' } }
}

export async function handleGatewayRequest(req: GatewayRequest): Promise<GatewayResponse> {
  const method = req.method || 'GET'
  const url = req.url || '/'

  console.log(`${timestamp()} ${method} ${url}`)

  // GET /health or /healthz (compat with Docker OpenClaw)
  if ((url === '/health' || url === '/healthz') && method === 'GET') {
    return { status: 200, body: { status: 'ok', mock: true } }
  }

  // POST /tools/invoke
  if (url === '/tools/invoke' && method === 'POST') {
    const body = req.body || ''
    let parsed: { tool?: string; args?: unknown } = {}
    try { parsed = JSON.parse(body) } catch { /* */ }

    console.log(`  → tool=${parsed.tool || 'unknown'} args=${JSON.stringify(parsed.args || {}).slice(0, 100)}`)

    if (getToolMode() === 'error') {
      return {
        status: 500,
        body: {
          error: 'Mock tool error mode',
          tool: parsed.tool || 'unknown',
        },
      }
    }

    return { status: 200, body: { ok: true, mock: true } }
  }

  // 404 for anything else
  return { status: 404, body: { error: 'Not found', mock: true } }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const response = await handleGatewayRequest({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
  })

  json(res, response.body, response.status)
}

export function startGateway(port = getGatewayPort(), options: StartGatewayOptions = {}): Promise<ImitationCrabGateway> {
  const chatMode = getChatMode()
  const toolMode = getToolMode()
  const registerSignals = options.registerSignals ?? true

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error(`${timestamp()} ERROR:`, err)
        json(res, { error: 'Internal mock error' }, 500)
      })
    })

    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    })

    wss.on('connection', (ws: WsClient) => {
      console.log(`${timestamp()} WS connected`)
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'imitation-crab' },
      }))

      ws.on('message', (raw: Buffer) => {
        let frame: { id?: string; method?: string; params?: Record<string, unknown> }
        try {
          frame = JSON.parse(raw.toString())
        } catch {
          return
        }
        const id = typeof frame.id === 'string' ? frame.id : ''
        const method = typeof frame.method === 'string' ? frame.method : ''
        const params = frame.params ?? {}
        handleGatewayRpcRequest(method, params, { requestId: id, push: (pushed) => ws.send(JSON.stringify(pushed)) })
          .then((response) => {
            ws.send(JSON.stringify({
              type: 'res',
              id,
              ok: response.ok,
              ...(response.ok ? { payload: response.payload } : { error: response.error }),
            }))
          })
          .catch((err) => {
            ws.send(JSON.stringify({
              type: 'res',
              id,
              ok: false,
              error: { message: err instanceof Error ? err.message : String(err) },
            }))
          })
      })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[gateway] Port ${port} is already in use`)
        reject(err)
      } else {
        reject(err)
      }
    })

    const close = async (): Promise<void> => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      for (const client of wss.clients) client.terminate()
      wss.close()
      if (!server.listening) return
      await new Promise<void>((closeResolve, closeReject) => {
        server.close((err) => {
          if (err) closeReject(err)
          else closeResolve()
        })
      })
    }

    const shutdown = () => {
      console.log('\n[gateway] Shutting down...')
      close().catch((err) => {
        console.error('[gateway] Shutdown failed:', err)
      })
    }

    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`
      console.log(`[gateway] Mock OpenClaw gateway listening on ${url}`)
      console.log(`[gateway] Chat mode: ${chatMode}`)
      console.log(`[gateway] Tool mode: ${toolMode}`)
      if (registerSignals) {
        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)
      }
      resolve({ port, url, close })
    })
  })
}
