/**
 * Socket routes through the published harness, written the way an external
 * author would: only `@makinbakin/sdk` imports. The harness socket shares the
 * host's PluginSocket implementation (messages, close, failures).
 */
import { describe, expect, it } from 'bun:test'
import { definePlugin, defineSocketRoute } from '@makinbakin/sdk'
import { activatePlugin, connectTestSocket, findSocketRoute } from '@makinbakin/sdk/testing'

const echo = defineSocketRoute({
  path: '/echo',
  summary: 'Echo frames back',
  admit: (request) => (request.headers.get('x-test-key') === 'nope' ? new Response('no', { status: 403 }) : undefined),
  open: (socket) => {
    socket.onMessage((data) => { socket.send(typeof data === 'string' ? `echo:${data}` : data) })
  },
})

const plugin = definePlugin({ id: 'echoer', name: 'Echoer', version: '0.1.0', activate: () => {}, socketRoutes: [echo] })

describe('socket routes in the SDK harness', () => {
  it('collects declarative socket routes on activation', async () => {
    const harness = await activatePlugin(plugin)
    expect(findSocketRoute(harness.socketRoutes, '/echo')).toBe(echo)
    harness.dispose()
  })

  it('round-trips text and binary frames', async () => {
    const connection = await connectTestSocket(echo)
    if (!connection.ok) throw new Error('refused')
    connection.client.send('hi')
    connection.client.send(new Uint8Array([7]))
    expect(connection.client.received).toEqual(['echo:hi', new Uint8Array([7])])
  })

  it('reports the admission refusal without opening', async () => {
    const connection = await connectTestSocket(echo, new Request('http://localhost/', { headers: { 'x-test-key': 'nope' } }))
    expect(connection.ok).toBe(false)
    if (!connection.ok) expect(connection.response.status).toBe(403)
  })

  it('records a server-side close', async () => {
    const closer = defineSocketRoute({ path: '/close', summary: 'Close at once', open: (socket) => { socket.close(4000, 'bye') } })
    const connection = await connectTestSocket(closer)
    if (!connection.ok) throw new Error('refused')
    expect(connection.client.closed).toEqual({ code: 4000, reason: 'bye' })
  })
})
