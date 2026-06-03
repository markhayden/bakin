import { describe, it, expect, mock } from 'bun:test'
import { PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { gunzipSync } from 'zlib'
import { dispatchWebHandler } from '../../packages/host/src/api/_adapter'
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  DEFAULT_MAX_WEB_REQUEST_BODY_BYTES,
} from '../../src/core/request-body'

function mockReq(opts: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
} = {}): IncomingMessage {
  const stream = new PassThrough()
  stream.end(opts.body ?? '')
  const req = stream as unknown as IncomingMessage
  req.method = opts.method ?? 'POST'
  req.url = opts.url ?? '/api/test'
  req.headers = {
    host: 'localhost:3737',
    ...opts.headers,
  }
  return req
}

function mockRes() {
  let body = ''
  const chunks: string[] = []
  const rawChunks: Buffer[] = []
  const waiters: Array<() => void> = []
  const notify = () => {
    const pending = waiters.splice(0)
    for (const resolve of pending) resolve()
  }
  const res = {
    headersSent: false,
    writeHead: mock(() => {
      res.headersSent = true
    }),
    flushHeaders: mock(),
    write: mock((data?: string | Buffer) => {
      if (data) {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data)
        rawChunks.push(raw)
        const text = raw.toString('utf-8')
        chunks.push(text)
        body += text
      }
      notify()
      return true
    }),
    end: mock((data?: string | Buffer) => {
      if (data) {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data)
        rawChunks.push(raw)
        const text = raw.toString('utf-8')
        chunks.push(text)
        body += text
      }
      notify()
    }),
  } as unknown as ServerResponse & {
    headersSent: boolean
    writeHead: ReturnType<typeof mock>
    flushHeaders: ReturnType<typeof mock>
    write: ReturnType<typeof mock>
    end: ReturnType<typeof mock>
    _chunks: string[]
    _rawBody: Buffer
    _body: string
    _waitForChunkCount: (count: number) => Promise<void>
  }
  Object.defineProperty(res, '_body', { get: () => body })
  Object.defineProperty(res, '_rawBody', { get: () => Buffer.concat(rawChunks) })
  Object.defineProperty(res, '_chunks', { get: () => chunks })
  res._waitForChunkCount = async (count: number) => {
    while (chunks.length < count) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
  }
  return res
}

describe('dispatchWebHandler', () => {
  it('allows Web handler bodies above the JSON parser default limit', async () => {
    const req = mockReq({
      headers: { 'content-length': String(DEFAULT_MAX_REQUEST_BODY_BYTES + 1) },
      body: 'ok',
    })
    const res = mockRes()
    const handler = mock(() => new Response(JSON.stringify({ ok: true })))

    await dispatchWebHandler(req, res, handler)

    expect(handler).toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
  })

  it('compresses large text Web responses when the client accepts gzip', async () => {
    const req = mockReq({
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    })
    const res = mockRes()
    const handler = mock(() => Response.json({
      items: Array.from({ length: 500 }, (_, i) => ({
        id: `item-${i}`,
        text: 'same text repeated enough to make compression useful',
      })),
    }))

    await dispatchWebHandler(req, res, handler)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
    }))
    const decoded = gunzipSync(res._rawBody).toString('utf-8')
    expect(decoded).toContain('item-499')
  })

  it('does not compress with an encoding the client explicitly rejects', async () => {
    const req = mockReq({
      method: 'GET',
      headers: { 'accept-encoding': 'br;q=0, gzip;q=0' },
    })
    const res = mockRes()
    const body = JSON.stringify({ text: 'x'.repeat(5000) })
    const handler = mock(() => new Response(body, {
      headers: { 'Content-Type': 'application/json' },
    }))

    await dispatchWebHandler(req, res, handler)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.not.objectContaining({
      'Content-Encoding': expect.any(String),
    }))
    expect(res._body).toBe(body)
  })

  it('preserves existing Vary values when adding compression variance', async () => {
    const req = mockReq({
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    })
    const res = mockRes()
    const handler = mock(() => new Response(JSON.stringify({ text: 'x'.repeat(5000) }), {
      headers: {
        'Content-Type': 'application/json',
        Vary: 'Origin',
      },
    }))

    await dispatchWebHandler(req, res, handler)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Encoding': 'gzip',
      Vary: 'Origin, Accept-Encoding',
    }))
  })

  it('returns 413 and does not call the handler for oversize requests', async () => {
    const req = mockReq({
      headers: { 'content-length': String(DEFAULT_MAX_WEB_REQUEST_BODY_BYTES + 1) },
    })
    const res = mockRes()
    const handler = mock(() => new Response(JSON.stringify({ ok: true })))

    await dispatchWebHandler(req, res, handler)

    expect(handler).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' })
    expect(res._body).toContain('Request body too large')
  })

  it('streams Web response body chunks before the handler completes', async () => {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const req = mockReq({ method: 'GET', headers: { 'accept-encoding': 'gzip' } })
    const res = mockRes()
    const handler = mock(() => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
        c.enqueue(encoder.encode('event: activity\ndata: {"content":"first"}\n\n'))
      },
    }), {
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const pending = dispatchWebHandler(req, res, handler)
    await res._waitForChunkCount(1)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }))
    expect(res.writeHead).not.toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Encoding': 'gzip',
    }))
    expect(res.flushHeaders).toHaveBeenCalled()
    expect(res._chunks[0]).toContain('first')
    expect(res.end).not.toHaveBeenCalled()

    controller.enqueue(encoder.encode('event: done\ndata: {"content":"ok"}\n\n'))
    controller.close()
    await pending

    expect(res._body).toContain('event: done')
    expect(res.end).toHaveBeenCalled()
  })
})
