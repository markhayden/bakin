/**
 * Workaround-shape probe: an `agent` RPC sent with BOTH `sessionId` and
 * `sessionKey: agent:<agent>:explicit:<sessionId>` (Bakin's post-fix threaded
 * dispatch shape) registers in the gateway's chat-abort registry — the ack
 * carries the sessionKey and `chat.abort {sessionKey, runId}` stops the run
 * (`aborted:true`, lifecycle `stopReason:'aborted'`). Fixture provenance for
 * tests/fixtures/openclaw-gateway-frames/abort-sessionkey-addressed.jsonl.
 *
 * Re-run against a NEWER OpenClaw to re-verify the workaround still holds
 * (openclaw#TBD-abort-registration). Companion: abort-ladder-probe.ts proves
 * the DEFECT (sessionId-only shape); this proves the FIX shape.
 *
 * Usage (never point this at the production ~/.openclaw gateway):
 *   OPENCLAW_HOME=<throwaway>/.openclaw bun scripts/instance/abort-workaround-probe.ts \
 *     --url ws://127.0.0.1:39400 --token <gateway-token> --agent recorder \
 *     --out /tmp/abort-workaround.jsonl
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
const outPath = arg('--out', '/tmp/abort-workaround.jsonl')

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
  console.log('OUT', JSON.stringify(frame).slice(0, 200))
  ws.send(JSON.stringify(frame))
}

const connectId = randomUUID()
const agentReqId = randomUUID()
const abortId = randomUUID()
const cliSessionId = randomUUID()
const sessionKey = `agent:${agentId}:explicit:${cliSessionId}`
const prompt = 'Count slowly from 1 to 300, one number per line. Do not use tools.'
const idempotencyKey = `bakin:task:wkprobe1:d1:${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`
let accepted: { runId?: string; sessionKey?: string } | null = null
let done = false

const finish = (why: string): void => {
  if (done) return
  done = true
  console.log('FINISH:', why)
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
setTimeout(() => finish('hard timeout'), 120_000)

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
        client: { id: 'gateway-client', displayName: 'Bakin Abort Workaround Probe', version: '1.0.0', platform: process.platform, mode: 'backend' },
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
    const p = frame.payload as { stream?: string; state?: string; data?: { phase?: string; aborted?: boolean; stopReason?: string } } | undefined
    if (frame.event === 'agent' && p?.stream === 'lifecycle') {
      console.log('EVT lifecycle', p.data?.phase, 'aborted:', p.data?.aborted, 'stopReason:', p.data?.stopReason ?? '')
    }
    if (frame.event === 'chat') console.log('EVT chat', p?.state)
    return
  }

  if (frame.type !== 'res') return
  if (frame.id === connectId) {
    if (frame.ok !== true) {
      console.log('CONNECT FAILED')
      finish('connect failed')
      return
    }
    console.log('CONNECTED protocol', (payload as { protocol?: number }).protocol)
    send({
      type: 'req',
      id: agentReqId,
      method: 'agent',
      params: { agentId, message: prompt, deliver: false, timeout: 120, idempotencyKey, sessionKey, sessionId: cliSessionId },
    })
    return
  }
  if (frame.id === agentReqId) {
    console.log('AGENT RES', JSON.stringify(frame).slice(0, 300))
    if (frame.ok === true && payload.status === 'accepted') {
      accepted = { runId: payload.runId as string, sessionKey: payload.sessionKey as string | undefined }
      console.log('ACK sessionKey:', payload.sessionKey ?? '(absent)')
      setTimeout(() => {
        send({ type: 'req', id: abortId, method: 'chat.abort', params: { sessionKey: accepted?.sessionKey ?? sessionKey, runId: accepted?.runId } })
      }, 3000)
      return
    }
    const p = payload as { status?: string; stopReason?: string; summary?: string }
    finish(`agent final: status=${String(p.status)} stopReason=${String(p.stopReason ?? '')} summary=${String(p.summary ?? '')}`)
    return
  }
  if (frame.id === abortId) console.log('CHAT.ABORT RES >>>', JSON.stringify(frame))
})
ws.addEventListener('close', () => finish('socket closed'))
ws.addEventListener('error', () => console.log('WS ERROR'))
