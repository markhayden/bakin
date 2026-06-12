/**
 * sessions.storeStats() — read-only per-agent session-store disk stats.
 *
 * Feeds the health plugin's `session-store` growth check (#435). The walk
 * must never throw: agents without a sessions dir are skipped, and a
 * missing or malformed sessions.json reports storeEntries=0 while the
 * dir's files still count toward fileCount/diskBytes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const contentDir = mkdtempSync(join(tmpdir(), 'bakin-session-stats-content-'))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
afterAll(() => rmSync(contentDir, { recursive: true, force: true }))

describe('OpenClaw runtime sessions.storeStats', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-session-stats-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = testDir
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedAgent(agentId: string, opts: { store?: string; artifacts?: Record<string, string>; sessionsDir?: boolean }) {
    const agentDir = join(testDir, 'agents', agentId)
    mkdirSync(agentDir, { recursive: true })
    if (opts.sessionsDir === false) return
    const sessionsDir = join(agentDir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    if (opts.store !== undefined) writeFileSync(join(sessionsDir, 'sessions.json'), opts.store, 'utf-8')
    for (const [name, content] of Object.entries(opts.artifacts ?? {})) {
      writeFileSync(join(sessionsDir, name), content, 'utf-8')
    }
  }

  it('reports entries, file count, and disk bytes per agent', async () => {
    seedAgent('main', {
      store: JSON.stringify({
        'agent:main:explicit:a': { sessionId: 'a' },
        'agent:main:explicit:b': { sessionId: 'b' },
      }),
      artifacts: { 'a.jsonl': 'x'.repeat(100), 'b.jsonl': 'y'.repeat(50), 'orphan.jsonl': 'z'.repeat(25) },
    })
    seedAgent('scout', { store: '{}' })

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const stats = (await runtime.sessions.storeStats?.()) ?? []

    const main = stats.find((s) => s.agentId === 'main')
    expect(main).toBeDefined()
    expect(main?.storeEntries).toBe(2)
    expect(main?.fileCount).toBe(4) // sessions.json + 3 artifacts
    const expectedBytes =
      JSON.stringify({ 'agent:main:explicit:a': { sessionId: 'a' }, 'agent:main:explicit:b': { sessionId: 'b' } }).length + 175
    expect(main?.diskBytes).toBe(expectedBytes)

    const scout = stats.find((s) => s.agentId === 'scout')
    expect(scout?.storeEntries).toBe(0)
    expect(scout?.fileCount).toBe(1)
  })

  it('skips agents without a sessions dir and tolerates a missing store', async () => {
    seedAgent('no-sessions', { sessionsDir: false })
    seedAgent('no-store', { artifacts: { 'stray.jsonl': 'abc' } })

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const stats = (await runtime.sessions.storeStats?.()) ?? []

    expect(stats.find((s) => s.agentId === 'no-sessions')).toBeUndefined()
    const noStore = stats.find((s) => s.agentId === 'no-store')
    expect(noStore?.storeEntries).toBe(0)
    expect(noStore?.fileCount).toBe(1)
    expect(noStore?.diskBytes).toBe(3)
  })

  it('reports storeEntries=0 for a malformed store without throwing', async () => {
    seedAgent('broken', { store: '{not json', artifacts: { 's.jsonl': '1234' } })

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const stats = (await runtime.sessions.storeStats?.()) ?? []

    const broken = stats.find((s) => s.agentId === 'broken')
    expect(broken?.storeEntries).toBe(0)
    expect(broken?.fileCount).toBe(2)
  })

  it('returns an empty list when no agents dir exists', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    expect((await runtime.sessions.storeStats?.()) ?? []).toEqual([])
  })
})
