/**
 * Mock OpenClaw gateway.
 * Handles the HTTP endpoints Bakin uses plus the Gateway RPC contract used
 * by chat:
 *   GET  /health
 *   POST /tools/invoke
 *   RPC  agent
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { getChatMode, getGatewayPort, getToolMode } from './env'

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

export async function handleGatewayRpcRequest(method: string, params: Record<string, unknown>): Promise<GatewayRpcResponse> {
  if (method === 'connect') {
    return {
      ok: true,
      payload: { auth: { scopes: Array.isArray(params.scopes) ? params.scopes : [] } },
    }
  }

  if (method === 'agent') {
    const agentId = typeof params.agentId === 'string' && params.agentId.length > 0 ? params.agentId : 'unknown'
    const agentName = AGENT_NAMES[agentId] || agentId
    const userMessage = typeof params.message === 'string' ? params.message : ''

    let reply: string
    switch (getChatMode()) {
      case 'echo':
        reply = `[mock:${agentName}] ${userMessage}`
        break
      case 'error':
        return { ok: false, error: { message: 'Mock error mode', code: 'mock_error' } }
      case 'canned':
      default:
        reply = `[mock:${agentName}] Acknowledged. Task understood — working on it.`
    }

    console.log(`  → rpc=agent agent=${agentId} message=${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}`)
    return {
      ok: true,
      payload: {
        runId: 'mock-run',
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
        handleGatewayRpcRequest(method, params)
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
