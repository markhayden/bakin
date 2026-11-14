import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir } from '../../src/core/content-dir'
import { del, get, post } from '../../packages/host/src/api/secrets'
import { settleFor, waitUntil } from '../helpers/wait'

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

  it('saving a slot a pack declares re-runs that pack\'s login probe (provider-integrations §4.1)', async () => {
    const probeDir = join(testDir, 'onpath')
    const marker = join(testDir, 'probe-ran.txt')
    mkdirSync(probeDir, { recursive: true })
    writeFileSync(join(probeDir, 'slotprobe'), `#!/bin/sh\necho ran >> "${marker}"\nexit 0\n`)
    chmodSync(join(probeDir, 'slotprobe'), 0o755)
    const originalPath = process.env.PATH
    const originalBrave = process.env.BRAVE_SEARCH_API_KEY
    process.env.PATH = `${probeDir}:${originalPath}`
    try {
      const dir = join(testDir, 'packages', 'skill-packs', 'slotpack@1.0.0')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
        id: 'slotpack', kind: 'skill-pack', name: 'Slot', version: '1.0.0', capability: 'slot', contributions: { skills: ['skills/x'] },
        secrets: [{ name: 'SLOT_TOKEN', description: 'x', required: false, secretSlot: 'skills.slotpack.SLOT_TOKEN' }],
        requires: {
          prereqs: [{ name: 'slot cli', kind: 'binary', probe: 'slotprobe', help: 'https://x.dev' }],
          login: [{ name: 'Slot account', probe: ['slotprobe', 'status'], setup: 'slotprobe login', help: 'https://x.dev' }],
        },
      }))
      writeFileSync(join(testDir, 'packages', 'lock.json'), JSON.stringify({ version: 1, packages: {
        'slotpack@1.0.0': { kind: 'skill-pack', version: '1.0.0', source: 'github:x/y#packs/slotpack', ref: 'main', commitSha: 'c'.repeat(40), installedAt: new Date().toISOString(), projections: [] },
      } }))
      const res = await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'skills.slotpack', name: 'SLOT_TOKEN', value: 'v' }) }), url())
      expect(res.status).toBe(200)
      await waitUntil(() => existsSync(marker), { label: 'login probe re-ran after the secret save' })
      // An unrelated slot re-runs nothing.
      rmSync(marker, { force: true })
      await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'brave', name: 'apiKey', value: 'v' }) }), url())
      await settleFor(150, 'an unrelated slot must not re-run the probe — absence cannot be polled for')
      expect(existsSync(marker)).toBe(false)
    } finally {
      process.env.PATH = originalPath
      // The brave save live-injects BRAVE_SEARCH_API_KEY (D18); never leak it into the next test.
      if (originalBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY
      else process.env.BRAVE_SEARCH_API_KEY = originalBrave
    }
  })

  it('starts empty', async () => {
    const res = await get(new Request(url()), url())
    expect(await res.json()).toMatchObject({ stored: [], secrets: {} })
  })

  describe('declared slots', () => {
    const originalToken = process.env.DISCORD_BOT_TOKEN
    afterEach(() => {
      if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN
      else process.env.DISCORD_BOT_TOKEN = originalToken
    })

    it('lists every declared slot with its status, never a value', async () => {
      delete process.env.DISCORD_BOT_TOKEN
      const listed = await (await get(new Request(url()), url())).json()
      const discord = listed.slots.find((slot: { provider: string; name: string }) => slot.provider === 'discord' && slot.name === 'botToken')
      expect(discord).toMatchObject({
        label: 'Discord bot token',
        envVar: 'DISCORD_BOT_TOKEN',
        owner: { href: '/settings?tab=channels' },
        status: { present: false, source: null },
      })
      expect(listed.slots.some((slot: { provider: string }) => slot.provider === 'brave')).toBe(true)

      await post(new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'discord', name: 'botToken', value: 'tok-secret' }) }), url())
      const afterStore = await (await get(new Request(url()), url())).json()
      expect(afterStore.slots.find((slot: { provider: string }) => slot.provider === 'discord').status).toEqual({ present: true, source: 'store' })
      expect(JSON.stringify(afterStore)).not.toContain('tok-secret')

      process.env.DISCORD_BOT_TOKEN = 'tok-env'
      const afterEnv = await (await get(new Request(url()), url())).json()
      expect(afterEnv.slots.find((slot: { provider: string }) => slot.provider === 'discord').status).toEqual({ present: true, source: 'env' })
      expect(JSON.stringify(afterEnv)).not.toContain('tok-env')
    })
  })

  it('sets, lists (masked), and deletes a provider key', async () => {
    const setRes = await post(
      new Request(url(), { method: 'POST', body: JSON.stringify({ provider: 'openai', apiKey: 'sk-secret' }) }),
      url(),
    )
    expect(await setRes.json()).toMatchObject({ ok: true, provider: 'openai', stored: true })

    const listRes = await get(new Request(url()), url())
    const listed = await listRes.json()
    expect(listed).toMatchObject({ stored: ['openai'], secrets: { openai: ['apiKey'] } })
    // The value is never returned.
    expect(JSON.stringify(listed)).not.toContain('sk-secret')

    const delRes = await del(new Request(url('?provider=openai'), { method: 'DELETE' }), url('?provider=openai'))
    expect(await delRes.json()).toMatchObject({ ok: true, removed: true })
    expect(await (await get(new Request(url()), url())).json()).toMatchObject({ stored: [], secrets: {} })
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
    expect(await (await get(new Request(url()), url())).json()).toMatchObject({ stored: [], secrets: {} })
  })
})
