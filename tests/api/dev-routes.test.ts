/**
 * Tests for the /api/dev/{events,notify} handlers.
 *
 * Exercises the handlers directly (not through an HTTP server) by calling
 * the exported functions with constructed Request / mocked ServerResponse
 * objects. Covers the BAKIN_DEV gate, zod validation, the client Set
 * lifecycle, and the broadcast fan-out.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'events'
import type { IncomingMessage, ServerResponse } from 'http'

// Per CLAUDE.md testing rules — defensive content-dir mocks even though
// the dev-route handlers don't touch the filesystem. Transitive imports
// can surprise you.
mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-dev-routes-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-dev-routes-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import {
  handleDevSse,
  broadcastDev,
  getDevClientCount,
} from '../../packages/host/src/api/dev/events'
import { post as notifyPost } from '../../packages/host/src/api/dev/notify'

// ---------- Mock IncomingMessage / ServerResponse ----------

interface WriteCall {
  chunk: string
}

interface HeadCall {
  status: number
  headers: Record<string, string>
}

function makeRes(): ServerResponse & {
  _head?: HeadCall
  _writes: WriteCall[]
  _ended: boolean
} {
  const writes: WriteCall[] = []
  let head: HeadCall | undefined
  let ended = false
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      head = { status, headers }
      return res
    },
    write(chunk: string) {
      writes.push({ chunk })
      return true
    },
    end(chunk?: string) {
      if (chunk) writes.push({ chunk })
      ended = true
      return res
    },
    get _head() { return head },
    _writes: writes,
    get _ended() { return ended },
  }
  return res as unknown as ServerResponse & {
    _head?: HeadCall
    _writes: WriteCall[]
    _ended: boolean
  }
}

class MockReq extends EventEmitter {
  _emit(event: string): void { this.emit(event) }
}

function makeReq(): IncomingMessage & { _emit: (ev: string) => void } {
  return new MockReq() as unknown as IncomingMessage & { _emit: (ev: string) => void }
}

// ---------- BAKIN_DEV env lifecycle ----------

const prevDev = process.env.BAKIN_DEV

beforeEach(() => {
  delete process.env.BAKIN_DEV
})

afterEach(() => {
  if (prevDev === undefined) delete process.env.BAKIN_DEV
  else process.env.BAKIN_DEV = prevDev
})

// ---------- notify.post ----------

describe('POST /api/dev/notify', () => {
  it('returns 404 when BAKIN_DEV is unset', async () => {
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'dev:ready' }),
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(404)
  })

  it('returns 200 when BAKIN_DEV=1 and payload is a valid dev:ready', async () => {
    process.env.BAKIN_DEV = '1'
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'dev:ready' }),
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('returns 200 for a valid dev:reload event with a scope', async () => {
    process.env.BAKIN_DEV = '1'
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'dev:reload', scope: 'shell' }),
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(200)
  })

  it('returns 400 when the payload is missing type', async () => {
    process.env.BAKIN_DEV = '1'
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'shell' }),
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/invalid event shape/i)
  })

  it('returns 400 when a known type carries an invalid scope', async () => {
    process.env.BAKIN_DEV = '1'
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // scope 'nonsense' isn't in the DevScope enum
      body: JSON.stringify({ type: 'dev:reload', scope: 'nonsense' }),
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on malformed JSON', async () => {
    process.env.BAKIN_DEV = '1'
    const req = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    })
    const res = await notifyPost(req)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/invalid json/i)
  })

  it('a notify call with a connected SSE client delivers the event', async () => {
    process.env.BAKIN_DEV = '1'
    const req = makeReq()
    const res = makeRes()
    handleDevSse(req, res)
    const initialWrites = res._writes.length

    const notifyReq = new Request('http://localhost/api/dev/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'dev:reload', scope: 'shell' }),
    })
    const notifyRes = await notifyPost(notifyReq)
    expect(notifyRes.status).toBe(200)

    // The reload event lands on the connected client.
    const delivered = res._writes.slice(initialWrites).map((w) => w.chunk).join('')
    expect(delivered).toContain('data: {"type":"dev:reload","scope":"shell"}')

    // Clean up: close the SSE client so the next test starts empty.
    req._emit('close')
  })
})

// ---------- handleDevSse ----------

describe('GET /api/dev/events', () => {
  it('returns 404 when BAKIN_DEV is unset and does not register a client', () => {
    const before = getDevClientCount()
    const req = makeReq()
    const res = makeRes()
    handleDevSse(req, res)
    expect(res._head?.status).toBe(404)
    expect(getDevClientCount()).toBe(before)
  })

  it('returns 200 text/event-stream and registers the client when BAKIN_DEV=1', () => {
    process.env.BAKIN_DEV = '1'
    const before = getDevClientCount()
    const req = makeReq()
    const res = makeRes()
    handleDevSse(req, res)
    expect(res._head?.status).toBe(200)
    expect(res._head?.headers['Content-Type']).toBe('text/event-stream')
    expect(getDevClientCount()).toBe(before + 1)
    // dev:ready is written immediately so the client confirms the channel.
    const all = res._writes.map((w) => w.chunk).join('')
    expect(all).toContain('data: {"type":"dev:ready"}')
    req._emit('close')
  })

  it('removes the client from the Set when req emits close', () => {
    process.env.BAKIN_DEV = '1'
    const before = getDevClientCount()
    const req = makeReq()
    const res = makeRes()
    handleDevSse(req, res)
    expect(getDevClientCount()).toBe(before + 1)
    req._emit('close')
    expect(getDevClientCount()).toBe(before)
  })
})

// ---------- broadcastDev ----------

describe('broadcastDev', () => {
  it('is a no-op when BAKIN_DEV is unset', () => {
    // No connected clients; calling broadcastDev without BAKIN_DEV simply
    // does nothing and does not throw.
    expect(() => broadcastDev({ type: 'dev:ready' })).not.toThrow()
  })

  it('writes data: {json}\\n\\n to every connected client', () => {
    process.env.BAKIN_DEV = '1'
    const req1 = makeReq()
    const res1 = makeRes()
    const req2 = makeReq()
    const res2 = makeRes()
    handleDevSse(req1, res1)
    handleDevSse(req2, res2)
    const beforeWrites1 = res1._writes.length
    const beforeWrites2 = res2._writes.length

    broadcastDev({ type: 'dev:css' })

    const new1 = res1._writes.slice(beforeWrites1).map((w) => w.chunk).join('')
    const new2 = res2._writes.slice(beforeWrites2).map((w) => w.chunk).join('')
    expect(new1).toBe('data: {"type":"dev:css"}\n\n')
    expect(new2).toBe('data: {"type":"dev:css"}\n\n')

    req1._emit('close')
    req2._emit('close')
  })

  it('does not throw when there are no connected clients', () => {
    process.env.BAKIN_DEV = '1'
    // No handleDevSse calls yet, so clients Set is empty.
    expect(() => broadcastDev({ type: 'dev:ready' })).not.toThrow()
  })
})
