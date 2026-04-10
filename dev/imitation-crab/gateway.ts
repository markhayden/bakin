/**
 * Mock OpenClaw HTTP gateway.
 * Handles the three endpoints Bakin uses:
 *   GET  /health
 *   POST /v1/chat/completions
 *   POST /tools/invoke
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'

const PORT = 18789
const CHAT_MODE = process.env.OPENCLAW_MOCK_CHAT_MODE || 'canned'

// Agent name lookup for canned responses
const AGENT_NAMES: Record<string, string> = {
  main: 'Main Operator',
  main-operator: 'Main Operator',
  pixel: 'Pixel',
  rolo: 'Rolo',
  chef: 'Chef',
  explorer: 'Explorer',
  trainer: 'Trainer',
  coach: 'Coach',
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

export async function handleGatewayRequest(req: GatewayRequest): Promise<GatewayResponse> {
  const method = req.method || 'GET'
  const url = req.url || '/'

  console.log(`${timestamp()} ${method} ${url}`)

  // GET /health
  if (url === '/health' && method === 'GET') {
    return { status: 200, body: { status: 'ok', mock: true } }
  }

  // POST /v1/chat/completions
  if (url === '/v1/chat/completions' && method === 'POST') {
    const body = req.body || ''
    const agentHeader = req.headers?.['x-openclaw-agent-id']
    const agentId = (Array.isArray(agentHeader) ? agentHeader[0] : agentHeader) || 'unknown'
    const agentName = AGENT_NAMES[agentId] || agentId

    let parsed: { messages?: Array<{ content?: string }> } = {}
    try { parsed = JSON.parse(body) } catch { /* */ }

    const userMessage = parsed.messages?.[0]?.content || ''

    let reply: string
    switch (CHAT_MODE) {
      case 'echo':
        reply = `[mock:${agentName}] ${userMessage}`
        break
      case 'error':
        return { status: 500, body: { error: 'Mock error mode' } }
      case 'canned':
      default:
        reply = `[mock:${agentName}] Acknowledged. Task understood — working on it.`
    }

    console.log(`  → agent=${agentId} message=${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}`)

    return {
      status: 200,
      body: {
        choices: [{
          message: {
            role: 'assistant',
            content: reply,
          },
        }],
      },
    }
  }

  // POST /tools/invoke
  if (url === '/tools/invoke' && method === 'POST') {
    const body = req.body || ''
    let parsed: { tool?: string; args?: unknown } = {}
    try { parsed = JSON.parse(body) } catch { /* */ }

    console.log(`  → tool=${parsed.tool || 'unknown'} args=${JSON.stringify(parsed.args || {}).slice(0, 100)}`)

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

export function startGateway(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error(`${timestamp()} ERROR:`, err)
        json(res, { error: 'Internal mock error' }, 500)
      })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[gateway] Port ${PORT} is already in use`)
        reject(err)
      } else {
        reject(err)
      }
    })

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[gateway] Mock OpenClaw gateway listening on http://127.0.0.1:${PORT}`)
      console.log(`[gateway] Chat mode: ${CHAT_MODE}`)
      resolve()
    })

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n[gateway] Shutting down...')
      server.close()
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
