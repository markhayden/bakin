import { describe, expect, it, mock } from 'bun:test'

// Per CLAUDE.md — defensive content-dir mocks even for pure adapter tests.
const contentDirMock = () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-plugin-socket-noop')
  return { getContentDir: () => base, getBakinPaths: () => ({ root: base, db: join(base, 'bakin.db') }) }
}
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { createPluginSocket, type SocketTransport } from '../../../packages/core/src/routing/socket'

function fakeTransport() {
  const sent: Array<{ data: string | Uint8Array; done: (err?: Error) => void }> = []
  const transport: SocketTransport & { buffered: number; closedWith?: [number, string] } = {
    buffered: 0,
    get bufferedAmount() { return this.buffered },
    send(data, done) { this.buffered += typeof data === 'string' ? data.length : data.byteLength; sent.push({ data, done }) },
    close(code, reason) { this.closedWith = [code, reason] },
  }
  /** Simulate the network flushing the oldest queued frame. */
  const flush = () => {
    const next = sent.shift()!
    transport.buffered -= typeof next.data === 'string' ? next.data.length : next.data.byteLength
    next.done()
  }
  return { transport, sent, flush }
}

describe('createPluginSocket', () => {
  it('queues frames while under the bound and refuses (without queueing) once over it', () => {
    const { transport, sent } = fakeTransport()
    const { socket } = createPluginSocket(transport, { sendBound: 10 })

    expect(socket.send('12345')).toBe(true)
    expect(socket.send(new Uint8Array(6))).toBe(true)
    expect(socket.bufferedBytes).toBe(11)
    expect(socket.send('x')).toBe(false)
    expect(sent).toHaveLength(2)
  })

  it('fires drain once the queue falls to half the bound after a refused send', () => {
    const { transport, flush } = fakeTransport()
    const { socket } = createPluginSocket(transport, { sendBound: 10 })
    let drains = 0
    socket.onDrain(() => { drains++ })
    socket.send('1234')
    socket.send('1234567')
    expect(socket.send('x')).toBe(false)

    flush()
    expect(drains).toBe(0)
    flush()
    expect(drains).toBe(1)
  })

  it('does not fire drain when no send was refused', () => {
    const { transport, flush } = fakeTransport()
    const { socket } = createPluginSocket(transport, { sendBound: 10 })
    let drains = 0
    socket.onDrain(() => { drains++ })
    socket.send('1')
    flush()
    expect(drains).toBe(0)
  })

  it('delivers incoming frames and closes 1011 when a message listener throws', () => {
    const { transport } = fakeTransport()
    const { socket, deliver } = createPluginSocket(transport)
    const got: Array<string | Uint8Array> = []
    socket.onMessage((data) => { got.push(data) })
    deliver('hello')
    deliver(new Uint8Array([1]))
    expect(got).toEqual(['hello', new Uint8Array([1])])

    socket.onMessage(() => { throw new Error('boom') })
    deliver('x')
    expect(transport.closedWith).toEqual([1011, 'Plugin socket handler failed'])
  })

  it('reports close once and refuses sends afterwards', () => {
    const { transport } = fakeTransport()
    const { socket, closed } = createPluginSocket(transport)
    const closes: Array<[number, string]> = []
    socket.onClose((code, reason) => { closes.push([code, reason]) })
    closed(1001, 'going away')
    closed(1006, '')
    expect(closes).toEqual([[1001, 'going away']])
    expect(socket.send('late')).toBe(false)
  })

  it('close defaults to a normal closure', () => {
    const { transport } = fakeTransport()
    const { socket } = createPluginSocket(transport)
    socket.close()
    expect(transport.closedWith).toEqual([1000, ''])
  })
})
