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
import { settleFor, waitUntil } from '../../helpers/wait'

function fakeTransport() {
  const sent: Array<string | Uint8Array> = []
  const transport: SocketTransport & { closedWith?: [number, string] } = {
    send(data) { sent.push(data) },
    close(code, reason) { this.closedWith = [code, reason] },
  }
  return { transport, sent }
}

describe('createPluginSocket', () => {
  it('sends frames until the connection is closed', () => {
    const { transport, sent } = fakeTransport()
    const { socket, closed } = createPluginSocket(transport)
    expect(socket.send('a')).toBe(true)
    expect(socket.send(new Uint8Array([1]))).toBe(true)
    closed(1000, '')
    expect(socket.send('late')).toBe(false)
    expect(sent).toEqual(['a', new Uint8Array([1])])
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

  it('reports close once and ignores frames after it', () => {
    const { transport } = fakeTransport()
    const { socket, closed, deliver } = createPluginSocket(transport)
    const closes: Array<[number, string]> = []
    const got: unknown[] = []
    socket.onClose((code, reason) => { closes.push([code, reason]) })
    socket.onMessage((data) => { got.push(data) })
    closed(1001, 'going away')
    closed(1006, '')
    deliver('late')
    expect(closes).toEqual([[1001, 'going away']])
    expect(got).toEqual([])
  })

  it('close defaults to a normal closure', () => {
    const { transport } = fakeTransport()
    const { socket } = createPluginSocket(transport)
    socket.close()
    expect(transport.closedWith).toEqual([1000, ''])
  })

  it('runs every close listener even when one throws', () => {
    const { transport } = fakeTransport()
    const { socket, closed } = createPluginSocket(transport)
    const ran: string[] = []
    socket.onClose(() => { throw new Error('cleanup bug') })
    socket.onClose(() => { ran.push('second') })
    expect(() => closed(1000, '')).not.toThrow()
    expect(ran).toEqual(['second'])
  })
})
