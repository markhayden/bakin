/**
 * Pure in-memory idempotency registry for billed image calls — no filesystem,
 * no content-dir, no runtime. Guards against the client-timeout double-bill:
 * a retried identical billed call must NOT issue a second provider call.
 */
import { describe, it, expect } from 'bun:test'
import {
  imageCallSignature,
  createIdempotencyRegistry,
  type ImageCallKey,
} from '../../../plugins/images/lib/idempotency'

const baseKey: ImageCallKey = {
  taskId: 'task-1',
  op: 'generate',
  source: null,
  promptHash: 'sha256:abc',
  provider: 'openai',
  model: 'gpt-image-2',
  width: 1024,
  height: 1536,
  quality: 'standard',
  references: '',
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('imageCallSignature', () => {
  it('is stable for identical keys', () => {
    expect(imageCallSignature(baseKey)).toBe(imageCallSignature({ ...baseKey }))
  })

  it('differs when any field differs', () => {
    const sig = imageCallSignature(baseKey)
    expect(imageCallSignature({ ...baseKey, op: 'edit' })).not.toBe(sig)
    expect(imageCallSignature({ ...baseKey, promptHash: 'sha256:def' })).not.toBe(sig)
    expect(imageCallSignature({ ...baseKey, model: 'other' })).not.toBe(sig)
    expect(imageCallSignature({ ...baseKey, width: 512 })).not.toBe(sig)
    expect(imageCallSignature({ ...baseKey, source: 'a.png' })).not.toBe(sig)
    expect(imageCallSignature({ ...baseKey, taskId: 'task-2' })).not.toBe(sig)
  })

  it('same prompt with different references is not a duplicate (#418)', () => {
    const withRefs = imageCallSignature({ ...baseKey, references: '20260601-a@1' })
    const otherRefs = imageCallSignature({ ...baseKey, references: '20260601-b@2' })
    const noRefs = imageCallSignature({ ...baseKey, references: '' })
    expect(withRefs).not.toBe(noRefs)
    expect(withRefs).not.toBe(otherRefs)
    // Identical reference sets dedupe as before.
    expect(imageCallSignature({ ...baseKey, references: '20260601-a@1' })).toBe(withRefs)
  })
})

describe('createIdempotencyRegistry', () => {
  it('dedups concurrent identical calls to a single fn invocation', async () => {
    const reg = createIdempotencyRegistry<{ ok: true; n: number }>()
    let calls = 0
    const fn = async () => { calls++; await delay(10); return { ok: true as const, n: calls } }
    const [a, b] = await Promise.all([reg.run('sig', fn), reg.run('sig', fn)])
    expect(calls).toBe(1)
    expect(a).toBe(b) // same result object — second caller got the first's result
  })

  it('returns the cached result for an identical call within TTL (no re-issue)', async () => {
    const reg = createIdempotencyRegistry<{ ok: true }>()
    let calls = 0
    const fn = async () => { calls++; return { ok: true as const } }
    await reg.run('sig', fn)
    await reg.run('sig', fn)
    expect(calls).toBe(1)
  })

  it('issues separate calls for distinct signatures', async () => {
    const reg = createIdempotencyRegistry<{ ok: true }>()
    let calls = 0
    const fn = async () => { calls++; return { ok: true as const } }
    await reg.run('sig-a', fn)
    await reg.run('sig-b', fn)
    expect(calls).toBe(2)
  })

  it('does not cache a non-cacheable (failed) result — a later call re-issues', async () => {
    const reg = createIdempotencyRegistry<{ ok: boolean }>()
    let calls = 0
    const fn = async () => { calls++; return { ok: false } }
    await reg.run('sig', fn, { cacheable: r => r.ok })
    await reg.run('sig', fn, { cacheable: r => r.ok })
    expect(calls).toBe(2)
  })

  it('does not cache a thrown error — a later call re-issues', async () => {
    const reg = createIdempotencyRegistry<{ ok: true }>()
    let calls = 0
    const fn = async () => { calls++; throw new Error('boom') }
    await expect(reg.run('sig', fn)).rejects.toThrow('boom')
    await expect(reg.run('sig', fn)).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })

  it('re-issues once the cached result has expired (TTL)', async () => {
    let t = 1000
    const reg = createIdempotencyRegistry<{ ok: true }>({ ttlMs: 100, now: () => t })
    let calls = 0
    const fn = async () => { calls++; return { ok: true as const } }
    await reg.run('sig', fn)          // calls=1, cached until t=1100
    t = 1050; await reg.run('sig', fn) // within TTL → cached
    expect(calls).toBe(1)
    t = 1200; await reg.run('sig', fn) // expired → re-issue
    expect(calls).toBe(2)
  })
})
