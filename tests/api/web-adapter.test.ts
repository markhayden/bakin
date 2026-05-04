import { describe, it, expect, mock } from 'bun:test'
import { PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'
import { dispatchWebHandler } from '../../packages/host/src/api/_adapter'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '../../src/core/request-body'

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
  const res = {
    headersSent: false,
    writeHead: mock(),
    end: mock((data?: string | Buffer) => {
      if (data) body = Buffer.isBuffer(data) ? data.toString('utf-8') : data
    }),
  } as unknown as ServerResponse & {
    headersSent: boolean
    writeHead: ReturnType<typeof mock>
    end: ReturnType<typeof mock>
    _body: string
  }
  Object.defineProperty(res, '_body', { get: () => body })
  return res
}

describe('dispatchWebHandler', () => {
  it('returns 413 and does not call the handler for oversize requests', async () => {
    const req = mockReq({
      headers: { 'content-length': String(DEFAULT_MAX_REQUEST_BODY_BYTES + 1) },
    })
    const res = mockRes()
    const handler = mock(() => new Response(JSON.stringify({ ok: true })))

    await dispatchWebHandler(req, res, handler)

    expect(handler).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' })
    expect(res._body).toContain('Request body too large')
  })
})
