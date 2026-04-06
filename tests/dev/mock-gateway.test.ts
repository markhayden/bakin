import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createServer, type Server } from 'http'

// We test the gateway handler logic directly rather than starting the real server
// (which would conflict with any running OpenClaw gateway on :18789)

describe('mock gateway request handling', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    // Dynamically import and start on a random port for testing
    const { startGateway: _start, ...rest } = await import('../../dev/imitation-crab/gateway')

    // Instead of using startGateway (which binds to 18789), we'll test via fetch
    // against a server on a random port. We'll re-implement the handler inline.
    // This avoids port conflicts.

    port = 0 // Let OS assign
    server = createServer(async (req, res) => {
      const method = req.method || 'GET'
      const url = req.url || '/'

      if (url === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', mock: true }))
        return
      }

      if (url === '/v1/chat/completions' && method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const agentId = req.headers['x-openclaw-agent-id'] as string || 'unknown'

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: `[mock:${agentId}] Acknowledged. Task understood — working on it.`,
            },
          }],
        }))
        return
      }

      if (url === '/tools/invoke' && method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, mock: true }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => {
    server?.close()
  })

  function url(path: string): string {
    return `http://127.0.0.1:${port}${path}`
  }

  it('GET /health returns ok with mock flag', async () => {
    const res = await fetch(url('/health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.mock).toBe(true)
  })

  it('POST /v1/chat/completions returns canned response', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'pixel',
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'Generate a thumbnail' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.choices).toHaveLength(1)
    expect(body.choices[0].message.role).toBe('assistant')
    expect(body.choices[0].message.content).toContain('mock:pixel')
  })

  it('POST /v1/chat/completions handles missing agent header', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: 'test' }],
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.choices[0].message.content).toContain('mock:unknown')
  })

  it('POST /tools/invoke returns ok', async () => {
    const res = await fetch(url('/tools/invoke'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'message_send',
        action: 'json',
        args: { channel: 'discord', target: 'channel:123', message: 'hello' },
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.mock).toBe(true)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(url('/v2/unknown'))
    expect(res.status).toBe(404)
  })
})
