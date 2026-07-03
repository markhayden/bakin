/**
 * Durable image idempotency (SPEC §8 test #5, single-bill leg).
 *
 * The old completed-cache was in-memory with a 5-minute TTL: a watchdog
 * supersede + re-dispatch spaced >5min (or any server restart) re-billed an
 * identical call — the image double-bill. Completed results now persist in
 * the execution ledger: no TTL, survives restarts, first write wins.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-img-idem-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { runBilledImageCall, imageCallSignature, type ImageCallKey } from '../../../plugins/images/lib/idempotency'
import type { ExecToolResult } from '@bakin/core/plugin-types'
import { getIdempotent } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'

function makeKey(overrides: Partial<ImageCallKey> = {}): ImageCallKey {
  return {
    taskId: 'task-img',
    op: 'generate',
    source: null,
    promptHash: 'prompt-a',
    provider: 'openai',
    model: 'gpt-image-1',
    width: 1024,
    height: 1024,
    quality: 'high',
    references: '',
    ...overrides,
  }
}

let bills = 0
const billedCall = (assetId: string) =>
  mock(async (): Promise<ExecToolResult> => {
    bills++
    return { ok: true, assetId } as unknown as ExecToolResult
  })

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  bills = 0
})

afterEach(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('durable image idempotency', () => {
  it('an identical replay after a RESTART returns the first asset for $0 (no TTL)', async () => {
    const key = makeKey()
    const first = await runBilledImageCall(key, billedCall('asset-1'))
    expect((first as { assetId?: string }).assetId).toBe('asset-1')
    expect(bills).toBe(1)

    // Server restart: the in-memory maps die; the ledger does not.
    closeDb()

    const replay = await runBilledImageCall(key, billedCall('asset-2'))
    expect((replay as { assetId?: string }).assetId).toBe('asset-1') // first result, not a re-bill
    expect(bills).toBe(1)
  })

  it('failures are never cached — a genuine retry re-issues', async () => {
    const key = makeKey({ promptHash: 'prompt-fail' })
    const failing = mock(async (): Promise<ExecToolResult> => {
      bills++
      return { ok: false, error: 'provider 500' } as unknown as ExecToolResult
    })

    const first = await runBilledImageCall(key, failing)
    expect(first.ok).toBe(false)

    const retry = await runBilledImageCall(key, billedCall('asset-after-retry'))
    expect((retry as { assetId?: string }).assetId).toBe('asset-after-retry')
    expect(bills).toBe(2) // fail + successful retry; never a third
  })

  it('a NEW task with identical content bills again — deliberate repeats are respected', async () => {
    await runBilledImageCall(makeKey({ taskId: 'task-a' }), billedCall('asset-a'))
    await runBilledImageCall(makeKey({ taskId: 'task-b' }), billedCall('asset-b'))
    expect(bills).toBe(2)
  })

  it('persists coordination facts only — no prompt content in the ledger row', async () => {
    const key = makeKey({ promptHash: 'prompt-content' })
    const full = {
      ok: true, assetId: 'asset-c', version: 1, width: 1024, height: 1024,
      promptHash: 'prompt-content',
      prompt: 'SECRET PROMPT TEXT', providerText: 'PROVIDER COMMENTARY',
    } as unknown as ExecToolResult

    // The caller of the FIRST run still receives the full result.
    const first = await runBilledImageCall(key, async () => full)
    expect((first as { prompt?: string }).prompt).toBe('SECRET PROMPT TEXT')

    // The persisted ledger row carries no content — coordination facts only.
    const row = getIdempotent(imageCallSignature(key))
    const json = JSON.stringify(row)
    expect(json).not.toContain('SECRET PROMPT TEXT')
    expect(json).not.toContain('PROVIDER COMMENTARY')
    const stored = row?.result as { assetId?: string; promptHash?: string }
    expect(stored.assetId).toBe('asset-c')
    expect(stored.promptHash).toBe('prompt-content')

    // A ledger replay returns the stripped row (asset identity intact).
    closeDb()
    const replay = await runBilledImageCall(key, billedCall('asset-x'))
    expect((replay as { assetId?: string }).assetId).toBe('asset-c')
    expect((replay as { prompt?: string }).prompt).toBeUndefined()
    expect(bills).toBe(0)
  })

  it('the persisted row is allowlist-built — an unknown future field never reaches the ledger', async () => {
    const key = makeKey({ promptHash: 'prompt-allowlist' })
    const full = {
      ok: true, assetId: 'asset-d', version: 1, width: 512, height: 512,
      promptHash: 'prompt-allowlist',
      futureDebugTranscript: 'CONTENT NOBODY STRIPPED', // not in any denylist
    } as unknown as ExecToolResult

    await runBilledImageCall(key, async () => full)

    const row = getIdempotent(imageCallSignature(key))
    expect(JSON.stringify(row)).not.toContain('CONTENT NOBODY STRIPPED')
    expect((row?.result as { assetId?: string }).assetId).toBe('asset-d')
  })

  it('concurrent identical calls share one in-flight promise (one bill)', async () => {
    const key = makeKey({ promptHash: 'prompt-conc' })
    let release: (() => void) | null = null
    const slow = mock(async (): Promise<ExecToolResult> => {
      bills++
      await new Promise<void>((r) => { release = r })
      return { ok: true, assetId: 'asset-conc' } as unknown as ExecToolResult
    })

    const a = runBilledImageCall(key, slow)
    const b = runBilledImageCall(key, slow)
    release!()
    const [ra, rb] = await Promise.all([a, b])
    expect((ra as { assetId?: string }).assetId).toBe('asset-conc')
    expect(rb).toBe(ra)
    expect(bills).toBe(1)
  })
})
