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
    expect(await res.json()).toEqual({ stored: [] })
  })

  it('sets, lists (masked), and deletes a provider key', async () => {
    const setRes = await post(
      new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai', apiKey: 'sk-secret' }) }),
      url(),
    )
    expect(await setRes.json()).toMatchObject({ ok: true, provider: 'openai', stored: true })

    const listRes = await get(new Request(url()), url())
    const listed = await listRes.json()
    expect(listed).toEqual({ stored: ['openai'] })
    // The value is never returned.
    expect(JSON.stringify(listed)).not.toContain('sk-secret')

    const delRes = await del(new Request(url('?provider=openai'), { method: 'DELETE' }), url('?provider=openai'))
    expect(await delRes.json()).toMatchObject({ ok: true, removed: true })
    expect(await (await get(new Request(url()), url())).json()).toEqual({ stored: [] })
  })

  it('rejects a set with a missing provider or key', async () => {
    const noProvider = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ apiKey: 'x' }) }), url())
    expect(noProvider.status).toBe(400)
    const noKey = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai' }) }), url())
    expect(noKey.status).toBe(400)
  })
})
