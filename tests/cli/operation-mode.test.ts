/**
 * D11 mode selection (#895): explicit URL → server-only; a live lock → its
 * server with its secret; no lock → in-process; refused before send → local
 * (lock) or an error (BAKIN_URL); anything after send → an error.
 */
import { describe, expect, it, mock } from 'bun:test'
import { CLI_SECRET_HEADER, runInOperationMode, selectOperationMode, ServerUnreachableError } from '../../src/cli/operation-mode'

const refused = () => Object.assign(new Error('Unable to connect. Is the computer able to access the url?'), { code: 'ConnectionRefused' })

describe('selectOperationMode', () => {
  it('an explicit BAKIN_URL is server-only and never carries the lock secret — even a loopback URL at the lock port', () => {
    const mode = selectOperationMode({ BAKIN_URL: 'http://127.0.0.1:4100/' }, { pid: 1, port: 4100, cliSecret: 's' })
    expect(mode).toEqual({ kind: 'server', source: 'env', baseUrl: 'http://127.0.0.1:4100', headers: {} })
  })

  it('a live lock on a non-default port targets that port with the lock secret', () => {
    expect(selectOperationMode({}, { pid: 1, port: 4242, cliSecret: 'abc' })).toEqual({
      kind: 'server', source: 'lock', baseUrl: 'http://localhost:4242', headers: { [CLI_SECRET_HEADER]: 'abc' },
    })
  })

  it('a lock without a secret targets the server without one', () => {
    expect(selectOperationMode({}, { pid: 1, port: 4242 })).toMatchObject({ kind: 'server', headers: {} })
  })

  it('no live lock (absent, dead pid, invalid port) runs in-process', () => {
    expect(selectOperationMode({}, null)).toEqual({ kind: 'local' })
    expect(selectOperationMode({}, { pid: 1, port: 0 })).toEqual({ kind: 'local' })
  })
})

describe('runInOperationMode', () => {
  it('a lock-chosen server refused before anything was sent falls back to in-process', async () => {
    const local = mock(async () => 'local')
    const result = await runInOperationMode(
      { kind: 'server', source: 'lock', baseUrl: 'http://localhost:4242', headers: {} },
      { server: async (t) => { await t.fetch('/api/x', { method: 'POST' }); return 'server' }, local },
      (async () => { throw refused() }),
    )
    expect(result).toBe('local')
    expect(local).toHaveBeenCalledTimes(1)
  })

  it('an explicit BAKIN_URL refused is an error, never in-process', async () => {
    const local = mock(async () => 'local')
    const run = runInOperationMode(
      { kind: 'server', source: 'env', baseUrl: 'http://10.0.0.5:3737', headers: {} },
      { server: async (t) => { await t.fetch('/api/x'); return 'server' }, local },
      (async () => { throw refused() }),
    )
    await expect(run).rejects.toBeInstanceOf(ServerUnreachableError)
    expect(local).not.toHaveBeenCalled()
  })

  it('a failure after a request reached the server is an error, never in-process', async () => {
    const local = mock(async () => 'local')
    let calls = 0
    const run = runInOperationMode(
      { kind: 'server', source: 'lock', baseUrl: 'http://localhost:4242', headers: {} },
      {
        server: async (t) => {
          await t.fetch('/api/start', { method: 'POST' })
          await t.fetch('/api/operations/x')
          return 'server'
        },
        local,
      },
      (async () => {
        calls += 1
        if (calls === 1) return new Response('{}', { status: 202 })
        throw refused()
      }),
    )
    await expect(run).rejects.toThrow('Unable to connect')
    expect(local).not.toHaveBeenCalled()
  })

  it('a server error response is the error, not a fallback', async () => {
    const local = mock(async () => 'local')
    const run = runInOperationMode(
      { kind: 'server', source: 'lock', baseUrl: 'http://localhost:4242', headers: {} },
      { server: async (t) => { const res = await t.fetch('/api/x'); if (!res.ok) throw new Error(`HTTP ${res.status}`); return 'server' }, local },
      (async () => new Response('boom', { status: 500 })),
    )
    await expect(run).rejects.toThrow('HTTP 500')
    expect(local).not.toHaveBeenCalled()
  })

  it('sends the lock secret on every request to a lock-chosen server', async () => {
    const seen: Array<string | null> = []
    await runInOperationMode(
      { kind: 'server', source: 'lock', baseUrl: 'http://localhost:4242', headers: { [CLI_SECRET_HEADER]: 'abc' } },
      { server: async (t) => { await t.fetch('/api/x', { headers: { 'X-Bakin-Origin': 'cli' } }); return 'server' }, local: async () => 'local' },
      (async (_url: string, init?: RequestInit) => { seen.push(new Headers(init?.headers).get(CLI_SECRET_HEADER)); return new Response('{}') }),
    )
    expect(seen).toEqual(['abc'])
  })

  it('local mode never touches the network', async () => {
    const fetchImpl = mock(async () => new Response('{}'))
    expect(await runInOperationMode({ kind: 'local' }, { server: async () => 'server', local: async () => 'local' }, fetchImpl)).toBe('local')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
