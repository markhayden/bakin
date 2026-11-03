/**
 * Plugin socket routes on a REAL booted server (Bun 1.4.3, node:http
 * upgrade + ws): a fixture user plugin declares socket routes; a real `ws`
 * client proves admission, frames, close tracking,
 * disable-while-connected (1012) and server shutdown (1001).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { realFetch, startIsolatedServer, type IsolatedServer } from '../../helpers/isolated-server'
import { waitUntil } from '../../helpers/wait'

const PLUGIN = 'socket-fixture'
const MANIFEST = {
  id: PLUGIN,
  name: 'Socket fixture',
  version: '1.0.0',
  bakin: '*',
  description: 'Socket route integration fixture',
  permissions: [],
  contributes: {
    apiRoutes: [
      { method: 'GET', path: '/closed', summary: 'Closed connection count' },
    ],
    socketRoutes: [{ path: '/echo', summary: 'Echo frames' }],
  },
}
const DIST = `
let closed = 0
const plugin = {
  id: '${PLUGIN}', name: 'Socket fixture', version: '1.0.0',
  routes: [
    { method: 'GET', path: '/closed', summary: 'Closed connection count', handler: function() { return Response.json({ closed }) } },
  ],
  socketRoutes: [
    {
      path: '/echo', summary: 'Echo frames',
      admit: function(request) { return request.headers.get('x-deny') ? new Response('denied by plugin', { status: 409 }) : undefined },
      open: function(socket, request) {
        socket.send('hello ' + new URL(request.url).searchParams.get('id'))
        socket.onMessage(function(data) { socket.send(typeof data === 'string' ? 'echo:' + data : data) })
        socket.onClose(function() { closed++ })
      },
    },
  ],
  activate: function() {},
}
module.exports = plugin
module.exports.default = plugin
`

let server: IsolatedServer
let origin: string

function installFixture(home: string): void {
  const dir = join(home, 'plugins', PLUGIN)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify(MANIFEST))
  writeFileSync(join(dir, 'dist', 'index.js'), DIST)
  writeFileSync(join(home, 'plugins', 'lock.json'), JSON.stringify({ version: 1, plugins: { [PLUGIN]: {
    source: dir, type: 'local', ref: '', commitSha: '', installedAt: new Date().toISOString(), version: '1.0.0', permissions: [], manifestSha: 'fixture',
  } } }))
}

beforeAll(async () => {
  server = await startIsolatedServer({
    settings: { dispatch: { paused: true } },
    env: { OPENCLAW_HOME: undefined },
    prepareHome: installFixture,
  })
  origin = server.baseUrl
}, 90_000)
afterAll(async () => { if (process.env.DUMP_LOGS) console.error((await server?.logs())?.slice(-6000)); await server?.stop() })

function connect(path: string, headers: Record<string, string> = { Origin: origin }) {
  return new Promise<{ ws: WebSocket; frames: Array<string | Buffer> } | { status: number; body: string }>((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace('http', 'ws')}${path}`, { headers })
    const frames: Array<string | Buffer> = []
    ws.on('message', (data, isBinary) => { frames.push(isBinary ? (data as Buffer) : data.toString()) })
    ws.on('open', () => resolve({ ws, frames }))
    ws.on('unexpected-response', (_req, res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    ws.on('error', reject)
  })
}

async function open(path: string) {
  const result = await connect(path)
  if (!('ws' in result)) throw new Error(`refused ${result.status}: ${result.body}`)
  return result
}

describe('plugin socket routes on a booted server', () => {

  it('round-trips text and binary frames and sees the upgrade request', async () => {
    const { ws, frames } = await open(`/api/plugins/${PLUGIN}/echo?id=s1`)
    ws.send('ping')
    ws.send(Buffer.from([1, 2, 3]))
    await waitUntil(() => frames.length === 3, { label: 'hello + two echoes' })
    expect(frames.slice(0, 2)).toEqual(['hello s1', 'echo:ping'])
    expect(Buffer.from(frames[2] as Buffer)).toEqual(Buffer.from([1, 2, 3]))
    ws.close()
    await waitUntil(async () => ((await (await realFetch(`${origin}/api/plugins/${PLUGIN}/closed`)).json()) as { closed: number }).closed >= 1, { label: 'plugin saw the close' })
  })

  it('refuses cross-origin upgrades, plugin refusals and unknown routes before the plugin opens', async () => {
    expect(await connect(`/api/plugins/${PLUGIN}/echo`, { Origin: 'http://evil.example' })).toEqual({ status: 403, body: 'Cross-origin socket refused' })
    expect(await connect(`/api/plugins/${PLUGIN}/echo`, { Origin: origin, 'x-deny': '1' })).toEqual({ status: 409, body: 'denied by plugin' })
    expect(await connect(`/api/plugins/${PLUGIN}/nope`)).toMatchObject({ status: 404 })
  })

  it('closes live sockets 1012 when the plugin is disabled', async () => {
    const { ws } = await open(`/api/plugins/${PLUGIN}/echo?id=s3`)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    const res = await realFetch(`${origin}/api/plugins/disable`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: PLUGIN }) })
    expect(res.status).toBe(200)
    expect(await closed).toBe(1012)
    expect(await connect(`/api/plugins/${PLUGIN}/echo`)).toMatchObject({ status: 404 })
    await realFetch(`${origin}/api/plugins/enable`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginId: PLUGIN }) })
  })

  it('closes live sockets 1001 when the server shuts down', async () => {
    const { ws } = await open(`/api/plugins/${PLUGIN}/echo?id=s4`)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    await server.stop()
    expect(await closed).toBe(1001)
  })
})
