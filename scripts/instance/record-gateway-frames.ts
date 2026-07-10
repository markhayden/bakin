/**
 * Record raw OpenClaw gateway event frames for one agent turn → JSONL fixture.
 *
 * Connects a WebSocket to a (throwaway!) gateway, performs the device-auth
 * connect handshake (mode 'backend', role 'operator', caps ['tool-events'] so
 * tool-stream agent events are delivered), sends one `agent` RPC, and appends
 * EVERY frame — inbound verbatim, outbound as sent — to a JSONL file until the
 * final RPC response, plus a short grace window for trailing events.
 *
 * Fixture provenance for tests/fixtures/openclaw-gateway-frames/ (SPEC.md
 * prelaunch-hardening Appendix A / OQ2). Secrets (tokens, signatures, device
 * ids, keys) are sanitized before writing; structure is preserved.
 *
 * Usage (never point this at the production ~/.openclaw gateway):
 *   OPENCLAW_HOME=<throwaway>/.openclaw bun scripts/instance/record-gateway-frames.ts \
 *     --url ws://127.0.0.1:39400 --token <gateway-token> --agent recorder \
 *     --message "Reply with exactly: hello" --out tests/fixtures/openclaw-gateway-frames/text-turn.jsonl \
 *     [--abort-after-ms 2500]
 *
 * Boundary: dev-rig module (scripts/instance/*), exempt from provider-boundary rules.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { buildDeviceConnectFields, loadDeviceAuth } from '../../packages/adapter-openclaw/src/device-auth'
import { redactString, registerSecretValue, sanitizeFrameValue } from './frame-sanitize'

interface CliArgs {
  url: string
  token: string
  agent: string
  message: string
  out: string
  abortAfterMs: number | null
  graceMs: number
  timeoutMs: number
  /** Omit caps:["tool-events"] from connect — control run for caps gating. */
  noToolEventsCap: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null
  }
  const url = get('--url') ?? 'ws://127.0.0.1:39400'
  const token = get('--token') ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? ''
  const agent = get('--agent') ?? 'recorder'
  const message = get('--message')
  const out = get('--out')
  if (!message || !out) {
    console.error('usage: record-gateway-frames.ts --url ws://… --token <t> --agent <id> --message <m> --out <file.jsonl> [--abort-after-ms N]')
    process.exit(2)
  }
  const abortAfter = get('--abort-after-ms')
  return {
    url,
    token,
    agent,
    message,
    out,
    abortAfterMs: abortAfter ? Number(abortAfter) : null,
    graceMs: Number(get('--grace-ms') ?? 3000),
    timeoutMs: Number(get('--timeout-ms') ?? 240_000),
    noToolEventsCap: argv.includes('--no-tool-events-cap'),
  }
}

interface RecordedLine {
  ts: number
  dir: 'in' | 'out' | 'note'
  frame: unknown
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const lines: RecordedLine[] = []
  const record = (dir: RecordedLine['dir'], frame: unknown): void => {
    lines.push({ ts: Date.now(), dir, frame })
  }

  const deviceInfo = loadDeviceAuth()
  if (!deviceInfo) {
    console.error('no device identity found under OPENCLAW_HOME — pre-approve one first (scripts/instance/device-approve.ts)')
    process.exit(1)
  }
  registerSecretValue(args.token, deviceInfo.deviceId, deviceInfo.deviceToken)

  const ws = new WebSocket(args.url)
  const send = (frame: Record<string, unknown>): void => {
    record('out', frame)
    ws.send(JSON.stringify(frame))
  }

  const connectId = randomUUID()
  const agentReqId = randomUUID()
  const abortReqId = randomUUID()
  let accepted: { runId?: string; sessionKey?: string } | null = null
  let abortTimer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const finish = (note: string): void => {
    if (settled) return
    settled = true
    record('note', { note })
    setTimeout(() => {
      try { ws.close() } catch { /* already closed */ }
      mkdirSync(dirname(args.out), { recursive: true })
      const body = lines.map((l) => JSON.stringify(sanitizeFrameValue(l))).join('\n') + '\n'
      writeFileSync(args.out, redactString(body))
      console.log(`recorded ${lines.length} lines → ${args.out}`)
      process.exit(0)
    }, args.graceMs)
  }

  const hardTimeout = setTimeout(() => {
    record('note', { note: `hard timeout after ${args.timeoutMs}ms` })
    finish('timeout')
  }, args.timeoutMs)
  hardTimeout.unref?.()

  ws.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(raw) as Record<string, unknown>
    } catch {
      record('note', { note: 'unparseable frame', raw })
      return
    }
    record('in', frame)

    // 1. challenge → signed connect (v3 device auth; signature covers the gateway shared token)
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = String((frame.payload as Record<string, unknown> | undefined)?.nonce ?? '')
      const fields = buildDeviceConnectFields(deviceInfo, {
        clientId: 'gateway-client',
        clientMode: 'backend',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        nonce,
        platform: process.platform,
        gatewayToken: args.token,
      })
      const auth: Record<string, unknown> = { token: args.token }
      if (fields.deviceToken) auth.deviceToken = fields.deviceToken
      send({
        type: 'req',
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: 1,
          maxProtocol: 10,
          client: { id: 'gateway-client', displayName: 'Bakin Frame Recorder', version: '1.0.0', platform: process.platform, mode: 'backend' },
          caps: args.noToolEventsCap ? [] : ['tool-events'],
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          auth,
          device: fields.device,
        },
      })
      return
    }

    if (frame.type !== 'res') return
    const payload = (frame.payload ?? {}) as Record<string, unknown>

    // 2. connect ok → fire the agent RPC (mirrors adapter runtime.ts params)
    if (frame.id === connectId) {
      if (frame.ok !== true) {
        record('note', { note: 'connect failed' })
        finish('connect failed')
        return
      }
      send({
        type: 'req',
        id: agentReqId,
        method: 'agent',
        params: {
          agentId: args.agent,
          message: args.message,
          deliver: false,
          timeout: 180,
          idempotencyKey: `bakin-${randomUUID()}`,
        },
      })
      return
    }

    // 3. agent RPC answers twice on one id: accepted ack, then the final.
    if (frame.id === agentReqId) {
      if (frame.ok === true && payload.status === 'accepted') {
        accepted = { runId: payload.runId as string | undefined, sessionKey: payload.sessionKey as string | undefined }
        if (args.abortAfterMs !== null) {
          abortTimer = setTimeout(() => {
            send({
              type: 'req',
              id: abortReqId,
              method: 'chat.abort',
              params: { sessionKey: accepted?.sessionKey, runId: accepted?.runId },
            })
          }, args.abortAfterMs)
        }
        return
      }
      if (abortTimer) clearTimeout(abortTimer)
      finish(frame.ok === true ? 'final response' : 'final error response')
    }
  })

  ws.addEventListener('close', () => {
    record('note', { note: 'socket closed' })
    finish('socket closed')
  })
  ws.addEventListener('error', () => record('note', { note: 'socket error' }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
