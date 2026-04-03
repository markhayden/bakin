import { describe, it, expect, vi } from 'vitest'
import { Readable, PassThrough } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import {
  parseJsonBody,
  validateJsonContentType,
  jsonResponse,
  handleJsonPost,
} from '../../src/core/middleware'

/** Create a mock IncomingMessage from a string body. */
function mockReq(opts: {
  body?: string
  method?: string
  contentType?: string
} = {}): IncomingMessage {
  const stream = new PassThrough()
  if (opts.body !== undefined) {
    stream.end(opts.body)
  } else {
    stream.end()
  }
  const req = stream as unknown as IncomingMessage
  req.method = opts.method || 'GET'
  req.headers = {}
  if (opts.contentType) req.headers['content-type'] = opts.contentType
  return req
}

/** Create a mock ServerResponse that captures writeHead + end calls. */
function mockRes() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  return res
}

describe('middleware', () => {
  // -------------------------------------------------------------------------
  // parseJsonBody
  // -------------------------------------------------------------------------

  describe('parseJsonBody', () => {
    it('parses valid JSON body', async () => {
      const req = mockReq({ body: '{"key":"value"}' })
      const result = await parseJsonBody(req)
      expect(result).toEqual({ key: 'value' })
    })

    it('returns null for invalid JSON', async () => {
      const req = mockReq({ body: '{ broken' })
      const result = await parseJsonBody(req)
      expect(result).toBeNull()
    })

    it('returns null for empty body', async () => {
      const req = mockReq({ body: '' })
      const result = await parseJsonBody(req)
      expect(result).toBeNull()
    })

    it('returns null on stream error', async () => {
      const stream = new PassThrough()
      const req = stream as unknown as IncomingMessage
      req.method = 'POST'
      req.headers = {}

      const promise = parseJsonBody(req)
      stream.emit('error', new Error('stream broke'))
      const result = await promise
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // validateJsonContentType
  // -------------------------------------------------------------------------

  describe('validateJsonContentType', () => {
    it('returns true for GET requests regardless of content type', () => {
      const req = mockReq({ method: 'GET' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(true)
      expect(res.writeHead).not.toHaveBeenCalled()
    })

    it('returns true for POST with application/json', () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(true)
    })

    it('returns true for POST with application/json; charset=utf-8', () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json; charset=utf-8' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(true)
    })

    it('returns false and sends 400 for POST without json content type', () => {
      const req = mockReq({ method: 'POST', contentType: 'text/plain' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(false)
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    })

    it('returns false for POST with no content type header', () => {
      const req = mockReq({ method: 'POST' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(false)
    })

    it('validates PUT requests', () => {
      const req = mockReq({ method: 'PUT', contentType: 'text/html' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(false)
    })

    it('validates DELETE requests', () => {
      const req = mockReq({ method: 'DELETE', contentType: 'application/json' })
      const res = mockRes()
      expect(validateJsonContentType(req, res)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // jsonResponse
  // -------------------------------------------------------------------------

  describe('jsonResponse', () => {
    it('sends JSON with correct status and content type', () => {
      const res = mockRes()
      jsonResponse(res, 200, { ok: true })
      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }))
    })

    it('handles error status codes', () => {
      const res = mockRes()
      jsonResponse(res, 404, { error: 'not found' })
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
    })
  })

  // -------------------------------------------------------------------------
  // handleJsonPost
  // -------------------------------------------------------------------------

  describe('handleJsonPost', () => {
    it('calls handler with parsed body and sends result', async () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json', body: '{"name":"test"}' })
      const res = mockRes()
      const handler = vi.fn().mockResolvedValue({ created: true })

      await handleJsonPost(req, res, handler)

      expect(handler).toHaveBeenCalledWith({ name: 'test' })
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      const body = JSON.parse(res.end.mock.calls[0][0])
      expect(body).toEqual({ created: true })
    })

    it('returns 400 when content type is wrong', async () => {
      const req = mockReq({ method: 'POST', contentType: 'text/plain', body: '{}' })
      const res = mockRes()
      const handler = vi.fn()

      await handleJsonPost(req, res, handler)

      expect(handler).not.toHaveBeenCalled()
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    })

    it('returns 400 when body is invalid JSON', async () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json', body: '{ broken' })
      const res = mockRes()
      const handler = vi.fn()

      await handleJsonPost(req, res, handler)

      expect(handler).not.toHaveBeenCalled()
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
      const body = JSON.parse(res.end.mock.calls[0][0])
      expect(body.error).toContain('Invalid JSON')
    })

    it('returns 500 when handler throws', async () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json', body: '{"ok":true}' })
      const res = mockRes()
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await handleJsonPost(req, res, handler)

      expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object))
      const body = JSON.parse(res.end.mock.calls[0][0])
      expect(body.error).toContain('handler boom')
    })

    it('returns { ok: true } when handler returns void', async () => {
      const req = mockReq({ method: 'POST', contentType: 'application/json', body: '{}' })
      const res = mockRes()
      const handler = vi.fn().mockResolvedValue(undefined)

      await handleJsonPost(req, res, handler)

      const body = JSON.parse(res.end.mock.calls[0][0])
      expect(body).toEqual({ ok: true })
    })
  })
})
