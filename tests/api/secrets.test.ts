import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir } from '../../src/core/content-dir'
import { del, get, post } from '../../packages/host/src/api/secrets'

const url = (q = '') => new URL(`http://localhost/api/secrets${q}`)

describe('/api/secrets', () => {
  let testDir: string
  const originalHome = process.env.BAKIN_HOME

  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-api-secrets-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    process.env.BAKIN_HOME = testDir
    resetContentDir()
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalHome
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    const res = await get(new Request(url()), url())
    expect(await res.json()).toEqual({ stored: [], secrets: {} })
  })

  it('sets, lists (masked), and deletes a provider key', async () => {
    const setRes = await post(
      new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai', apiKey: 'sk-secret' }) }),
      url(),
    )
    expect(await setRes.json()).toMatchObject({ ok: true, provider: 'openai', stored: true })

    const listRes = await get(new Request(url()), url())
    const listed = await listRes.json()
    expect(listed).toEqual({ stored: ['openai'], secrets: { openai: ['apiKey'] } })
    // The value is never returned.
    expect(JSON.stringify(listed)).not.toContain('sk-secret')

    const delRes = await del(new Request(url('?provider=openai'), { method: 'DELETE' }), url('?provider=openai'))
    expect(await delRes.json()).toMatchObject({ ok: true, removed: true })
    expect(await (await get(new Request(url()), url())).json()).toEqual({ stored: [], secrets: {} })
  })

  it('rejects a set with a missing provider or key', async () => {
    const noProvider = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ apiKey: 'x' }) }), url())
    expect(noProvider.status).toBe(400)
    const noKey = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai' }) }), url())
    expect(noKey.status).toBe(400)
  })

  describe('named secrets', () => {
    it('sets a named secret and lists names per provider (masked)', async () => {
      const setRes = await post(
        new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'discord', name: 'botToken', value: 'tok-secret' }) }),
        url(),
      )
      expect(await setRes.json()).toMatchObject({ ok: true, provider: 'discord', name: 'botToken', stored: true })

      const listed = await (await get(new Request(url()), url())).json()
      expect(listed.secrets).toEqual({ discord: ['botToken'] })
      // apiKey-view unchanged: discord has no apiKey
      expect(listed.stored).toEqual([])
      expect(JSON.stringify(listed)).not.toContain('tok-secret')
    })

    it('legacy apiKey body shape still works and appears in both views', async () => {
      await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai', apiKey: 'sk-1' }) }), url())
      const listed = await (await get(new Request(url()), url())).json()
      expect(listed.stored).toEqual(['openai'])
      expect(listed.secrets).toEqual({ openai: ['apiKey'] })
    })

    it('deletes one named secret via ?provider=&name=', async () => {
      await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'discord', name: 'botToken', value: 't1' }) }), url())
      await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'discord', name: 'appId', value: 'a1' }) }), url())
      const q = '?provider=discord&name=botToken'
      const delRes = await del(new Request(url(q), { method: 'DELETE' }), url(q))
      expect(await delRes.json()).toMatchObject({ ok: true, removed: true })
      const listed = await (await get(new Request(url()), url())).json()
      expect(listed.secrets).toEqual({ discord: ['appId'] })
    })

    it('rejects an invalid secret name', async () => {
      const bad = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'discord', name: '__proto__', value: 'x' }) }), url())
      expect(bad.status).toBe(400)
      const badDel = await del(new Request(url('?provider=discord&name=bad name!'), { method: 'DELETE' }), url('?provider=discord&name=bad name!'))
      expect(badDel.status).toBe(400)
    })
  })

  it('rejects an invalid/reserved provider id and an oversized key', async () => {
    const reserved = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: '__proto__', apiKey: 'x' }) }), url())
    expect(reserved.status).toBe(400)
    const oversized = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai', apiKey: 'a'.repeat(9000) }) }), url())
    expect(oversized.status).toBe(400)
    expect(await (await get(new Request(url()), url())).json()).toEqual({ stored: [], secrets: {} })
  })
})
