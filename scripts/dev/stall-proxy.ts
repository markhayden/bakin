#!/usr/bin/env bun
/**
 * A CONNECT proxy that relays the first N bytes a server sends through each
 * tunnel, then stops forwarding while keeping both sockets open — the exact
 * shape of the margo incident (2026-09-21: the registry answered, sent part
 * of the libvips tarball, then the body never moved again). For the manual
 * operations check (#895 PR3): point an isolated Bakin at it with
 * HTTPS_PROXY and watch a media repair report bytes, go quiet, go stuck,
 * retry with a fresh request and fail — in the browser and in
 * `bakin doctor --fix`.
 *
 *   bun scripts/dev/stall-proxy.ts --port 8899 --bytes 65536 [--match registry.npmjs.org] [--every]
 *
 * --bytes   bytes relayed from the server before the tunnel stalls (default 64 KiB)
 * --match   only stall tunnels to hosts containing this text (others relay fully)
 * --every   stall every matching tunnel; by default only the FIRST stalls, so a
 *           fresh-request retry succeeds (the recovery path)
 *
 * Never point a real home at it: it is for isolated boots only.
 */
import { createServer, connect, type Socket } from 'node:net'

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback
}

const port = Number(flag('port', '8899'))
const stallAfter = Number(flag('bytes', String(64 * 1024)))
const match = flag('match', '')
const every = process.argv.includes('--every')
let stalledOnce = false

function tunnel(client: Socket, host: string, targetPort: number, head: Buffer): void {
  const shouldStall = (!match || host.includes(match)) && (every || !stalledOnce)
  if (shouldStall) stalledOnce = true
  const upstream = connect(targetPort, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    client.pipe(upstream)
  })
  let relayed = 0
  upstream.on('data', (chunk: Buffer) => {
    if (!shouldStall) {
      client.write(chunk)
      return
    }
    const room = stallAfter - relayed
    if (room > 0) client.write(room >= chunk.length ? chunk : chunk.subarray(0, room))
    relayed += chunk.length
    if (relayed >= stallAfter && room > 0) {
      console.log(`[stall-proxy] ${host}:${targetPort} stalled after ${stallAfter} bytes — sockets stay open`)
    }
  })
  const close = () => { client.destroy(); upstream.destroy() }
  upstream.on('error', close)
  client.on('error', close)
  upstream.on('end', () => { if (!shouldStall) client.end() })
  client.on('end', () => upstream.end())
  console.log(`[stall-proxy] CONNECT ${host}:${targetPort}${shouldStall ? ' (will stall)' : ''}`)
}

const server = createServer((client) => {
  let buffered = Buffer.alloc(0)
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    const end = buffered.indexOf('\r\n\r\n')
    if (end < 0) return
    client.off('data', onData)
    const [requestLine = ''] = buffered.subarray(0, end).toString('latin1').split('\r\n')
    const [method, target = ''] = requestLine.split(' ')
    if (method !== 'CONNECT') {
      client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
      return
    }
    const [host = '', portText = '443'] = target.split(':')
    tunnel(client, host, Number(portText), buffered.subarray(end + 4))
  }
  client.on('data', onData)
  client.on('error', () => client.destroy())
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[stall-proxy] listening on 127.0.0.1:${port}; relaying ${stallAfter} bytes then stalling ${every ? 'every' : 'the first'} ${match ? `"${match}" ` : ''}tunnel`)
})
