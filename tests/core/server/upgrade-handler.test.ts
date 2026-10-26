/**
 * Plugin socket upgrades over a REAL node:http server and `ws` client:
 * same-origin admission, plugin admission, routing by plugin id + path,
 * binary/text frames, tracking for sweep/shutdown, and refusals that never
 * reach the plugin.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import type { PluginSocket, SocketRoute } from '@makinbakin/sdk/types'

const testDir = join(tmpdir(), `bakin-test-upgrade-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import { createUpgradeHandler, type SocketRouteRegistry } from '../../../src/core/server/upgrade-handler'
import { waitUntil } from '../../helpers/wait'

const opened: PluginSocket[] = []
const tracked = new Set<{ close(code: number, reason: string): void }>()
const routes: Record<string, SocketRoute> = {
  'echo /live': {
    path: '/live',
    summary: 'Echo',
    admit: (request) => (request.headers.get('x-deny') ? new Response('denied', { status: 409 }) : undefined),
    open: (socket, request) => {
      opened.push(socket)
      socket.send(`hello ${new URL(request.url).searchParams.get('id')}`)
      socket.onMessage((data) => { socket.send(typeof data === 'string' ? `echo:${data}` : data) })
    },
  },
  'echo /boom': { path: '/boom', summary: 'Throws', open: () => { throw new Error('open failed') } },
}
const registry: SocketRouteRegistry = {
  findSocketRoute: (pluginId, path) => routes[`${pluginId} ${path}`] ?? null,
  trackSocket: (_pluginId, socket) => { tracked.add(socket); return () => { tracked.delete(socket) } },
}

let server: Server
let base: string
beforeAll(async () => {
  server = createServer((_req, res) => { res.end('http') })
  server.on('upgrade', createUpgradeHandler(registry))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  base = `127.0.0.1:${port}`
})
afterAll(() => { server.close() })
afterEach(() => { opened.length = 0 })

function connect(path: string, headers: Record<string, string> = { Origin: `http://${base}` }): Promise<{ ws: WebSocket; messages: Array<string | Buffer> } | { status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}${path}`, { headers })
    const messages: Array<string | Buffer> = []
    ws.on('message', (data, isBinary) => { messages.push(isBinary ? data as Buffer : data.toString()) })
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('unexpected-response', (_req, res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    ws.on('error', reject)
  })
}

describe('createUpgradeHandler', () => {
  it('routes by plugin id and path, passes the request, and carries text and binary frames', async () => {
    const result = await connect('/api/plugins/echo/live?id=s1')
    if (!('ws' in result)) throw new Error(`refused ${result.status}`)
    const { ws, messages } = result
    ws.send('ping')
    ws.send(Buffer.from([1, 2, 3]))
    await waitUntil(() => messages.length === 3, { label: 'three frames' })
    expect(messages[0]).toBe('hello s1')
    expect(messages[1]).toBe('echo:ping')
    expect(Buffer.from(messages[2] as Buffer)).toEqual(Buffer.from([1, 2, 3]))
    expect(tracked.size).toBe(1)
    ws.close()
    await waitUntil(() => tracked.size === 0, { label: 'untracked after close' })
  })

  it('refuses a cross-origin upgrade before the plugin sees it', async () => {
    expect(await connect('/api/plugins/echo/live', { Origin: 'http://evil.example' })).toEqual({ status: 403, body: 'Cross-origin socket refused' })
    expect(await connect('/api/plugins/echo/live', {})).toEqual({ status: 403, body: 'Cross-origin socket refused' })
    expect(opened).toHaveLength(0)
  })

  it('answers 404 for unknown plugins, routes and non-plugin paths', async () => {
    expect(await connect('/api/plugins/echo/nope')).toMatchObject({ status: 404 })
    expect(await connect('/api/plugins/ghost/live')).toMatchObject({ status: 404 })
    expect(await connect('/api/tasks')).toMatchObject({ status: 404 })
  })

  it('relays the plugin admission refusal with its status and body', async () => {
    expect(await connect('/api/plugins/echo/live', { Origin: `http://${base}`, 'x-deny': '1' })).toEqual({ status: 409, body: 'denied' })
    expect(opened).toHaveLength(0)
  })

  it('closes the connection 1011 when open throws', async () => {
    const result = await connect('/api/plugins/echo/boom')
    if (!('ws' in result)) throw new Error(`refused ${result.status}`)
    const code = await new Promise<number>((resolve) => result.ws.on('close', (c) => resolve(c)))
    expect(code).toBe(1011)
  })

  it('closes with the registry when the plugin is swept', async () => {
    const result = await connect('/api/plugins/echo/live?id=s2')
    if (!('ws' in result)) throw new Error(`refused ${result.status}`)
    const closed = new Promise<[number, string]>((resolve) => result.ws.on('close', (c, r) => resolve([c, r.toString()])))
    await waitUntil(() => tracked.size === 1, { label: 'tracked' })
    for (const socket of [...tracked]) socket.close(1012, 'Plugin restarting')
    expect(await closed).toEqual([1012, 'Plugin restarting'])
  })
})
