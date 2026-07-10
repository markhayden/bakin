/**
 * Abort-ladder probe: does ANY abort surface stop an explicit-sessionId run?
 *
 * Starts an `agent` RPC with `sessionId` ONLY (the pre-fix Bakin dispatch
 * shape), then walks the abort ladder mid-run: `chat.abort {sessionKey,runId}`
 * → `sessions.abort {runId}` → `sessions.abort {key}`. On OpenClaw 2026.6.11
 * every rung misses (upstream openclaw#TBD-abort-registration): the ack omits
 * `sessionKey`, the run is never registered in the chat-abort registry, and it
 * streams to natural completion. Fixture provenance for
 * tests/fixtures/openclaw-gateway-frames/abort-explicit-session.jsonl.
 *
 * Re-run against a NEWER OpenClaw to re-verify the defect: if a rung starts
 * aborting the run, upstream fixed registration — delete the workaround pin
 * (tests/dev/openclaw-workaround-regressions.test.ts) and the mock mirror.
 *
 * Usage (never point this at the production ~/.openclaw gateway):
 *   OPENCLAW_HOME=<throwaway>/.openclaw bun scripts/instance/abort-ladder-probe.ts \
 *     --url ws://127.0.0.1:39400 --token <gateway-token> --agent recorder \
 *     --out /tmp/abort-ladder.jsonl
 *
 * Boundary: dev-rig module (scripts/instance/*), exempt from provider-boundary rules.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { buildDeviceConnectFields, loadDeviceAuth } from '../../packages/adapter-openclaw/src/device-auth'
import { registerSecretValue, sanitizeFrameValue } from './frame-sanitize'

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const url = arg('--url', 'ws://127.0.0.1:39400')
const token = arg('--token', process.env.OPENCLAW_GATEWAY_TOKEN ?? '')
const agentId = arg('--agent', 'recorder')
const outPath = arg('--out', '/tmp/abort-ladder.jsonl')

const deviceInfo = loadDeviceAuth()
if (!deviceInfo) {
  console.error('no device identity found under OPENCLAW_HOME — pre-approve one first (scripts/instance/device-approve.ts)')
  process.exit(1)
}
registerSecretValue(token, deviceInfo.deviceId, deviceInfo.deviceToken)

const lines: Array<{ ts: number; dir: 'in' | 'out'; frame: unknown }> = []
const record = (dir: 'in' | 'out', frame: unknown): void => {
  lines.push({ ts: Date.now(), dir, frame })
}

const ws = new WebSocket(url)
const send = (frame: Record<string, unknown>): void => {
  record('out', frame)
  console.log('OUT', JSON.stringify(frame).slice(0, 220))
  ws.send(JSON.stringify(frame))
}

const connectId = randomUUID()
const agentReqId = randomUUID()
const chatAbortId = randomUUID()
const sessAbortRunId = randomUUID()
const sessAbortKeyId = randomUUID()
const sessionId = randomUUID()
const prompt = 'Count slowly from 1 to 300, one number per line. Do not use tools.'
const idempotencyKey = `bakin:task:ladder1:d1:${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`
const explicitKey = `agent:${agentId}:explicit:${sessionId}`
let accepted: { runId?: string; sessionKey?: string } | null = null
let sawLifecycleEnd = false
let done = false

const finish = (why: string): void => {
  if (done) return
  done = true
  console.log('FINISH:', why, '| lifecycleEnd seen:', sawLifecycleEnd)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.map((l) => JSON.stringify(sanitizeFrameValue(l))).join('\n') + '\n')
  setTimeout(() => {
    try {
      ws.close()
    } catch {
      // socket already closed
    }
    process.exit(0)
  }, 500)
}
setTimeout(() => finish('hard timeout'), 150_000)

ws.addEventListener('message', (event) => {
  const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
  let frame: Record<string, unknown>
  try {
    frame = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  record('in', frame)
  const payload = (frame.payload ?? {}) as Record<string, unknown>

  if (frame.type === 'event' && frame.event === 'connect.challenge') {
    const nonce = String((frame.payload as Record<string, unknown> | undefined)?.nonce ?? '')
    const fields = buildDeviceConnectFields(deviceInfo, {
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      nonce,
      platform: process.platform,
      gatewayToken: token,
    })
    const auth: Record<string, unknown> = { token }
    if (fields.deviceToken) auth.deviceToken = fields.deviceToken
    send({
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 1,
        maxProtocol: 10,
        client: { id: 'gateway-client', displayName: 'Bakin Abort Ladder Probe', version: '1.0.0', platform: process.platform, mode: 'backend' },
        caps: ['tool-events'],
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth,
        device: fields.device,
      },
    })
    return
  }

  if (frame.type === 'event') {
    const p = frame.payload as { stream?: string; state?: string; data?: { phase?: string } } | undefined
    if (frame.event === 'agent' && p?.stream === 'lifecycle') {
      console.log('EVT lifecycle', p.data?.phase)
      if (p.data?.phase === 'end') sawLifecycleEnd = true
    }
    if (frame.event === 'chat') console.log('EVT chat', p?.state)
    return
  }

  if (frame.type !== 'res') return
  if (frame.id === connectId) {
    if (frame.ok !== true) {
      console.log('CONNECT FAILED', JSON.stringify(frame).slice(0, 300))
      finish('connect failed')
      return
    }
    console.log('CONNECTED protocol', (payload as { protocol?: number }).protocol)
    send({ type: 'req', id: agentReqId, method: 'agent', params: { agentId, message: prompt, deliver: false, timeout: 180, idempotencyKey, sessionId } })
    return
  }
  if (frame.id === agentReqId) {
    console.log('AGENT RES', JSON.stringify(frame).slice(0, 320))
    if (frame.ok === true && payload.status === 'accepted') {
      accepted = { runId: payload.runId as string, sessionKey: payload.sessionKey as string | undefined }
      console.log('ACK sessionKey present?', 'sessionKey' in payload)
      // Rung 1 at +3s: chat.abort (production shape — the defect makes this miss)
      setTimeout(() => {
        send({ type: 'req', id: chatAbortId, method: 'chat.abort', params: { sessionKey: accepted?.sessionKey ?? explicitKey, runId: accepted?.runId } })
      }, 3000)
      return
    }
    finish(`agent final: ${JSON.stringify(payload).slice(0, 200)}`)
    return
  }
  if (frame.id === chatAbortId) {
    console.log('CHAT.ABORT RES >>>', JSON.stringify(frame))
    if ((payload as { aborted?: boolean }).aborted !== true) {
      // Rung 2: sessions.abort by runId
      setTimeout(() => send({ type: 'req', id: sessAbortRunId, method: 'sessions.abort', params: { runId: accepted?.runId } }), 1000)
    }
    return
  }
  if (frame.id === sessAbortRunId) {
    console.log('SESSIONS.ABORT(runId) RES >>>', JSON.stringify(frame))
    if (!(payload as { abortedRunId?: string }).abortedRunId) {
      // Rung 3: sessions.abort by key
      setTimeout(() => send({ type: 'req', id: sessAbortKeyId, method: 'sessions.abort', params: { key: explicitKey, agentId } }), 1000)
    }
    return
  }
  if (frame.id === sessAbortKeyId) {
    console.log('SESSIONS.ABORT(key) RES >>>', JSON.stringify(frame))
  }
})
ws.addEventListener('close', () => finish('socket closed'))
ws.addEventListener('error', () => console.log('WS ERROR'))
