/**
 * agents.workspaceFileStats() — read-only size stats for the files OpenClaw
 * loads at session start (canonical bootstrap files, skills, memory notes).
 * Names + sizes only: content never crosses the adapter boundary (#357).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const contentDir = mkdtempSync(join(tmpdir(), 'bakin-workspace-stats-content-'))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, db: join(contentDir, 'bakin.db') }),
}))
afterAll(() => rmSync(contentDir, { recursive: true, force: true }))

describe('OpenClaw runtime agents.workspaceFileStats', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-workspace-stats-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = testDir
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  function workspace(agentId: string): string {
    return join(testDir, 'workspaces', agentId)
  }

  it('reports canonical files, skills, and memory notes with byte sizes', async () => {
    const root = workspace('jessica')
    mkdirSync(join(root, 'skills', 'brand-voice'), { recursive: true })
    mkdirSync(join(root, 'memory'), { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), 'a'.repeat(500), 'utf-8')
    writeFileSync(join(root, 'SOUL.md'), 's'.repeat(200), 'utf-8')
    writeFileSync(join(root, 'skills', 'brand-voice', 'SKILL.md'), 'k'.repeat(300), 'utf-8')
    writeFileSync(join(root, 'memory', '2026-07-01.md'), 'm'.repeat(100), 'utf-8')
    // Non-canonical stray files are NOT session-start context — excluded.
    writeFileSync(join(root, 'notes.txt'), 'x'.repeat(999), 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const stats = (await runtime.agents.workspaceFileStats?.('jessica')) ?? []

    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'AGENTS.md', bytes: 500, kind: 'canonical' }),
        expect.objectContaining({ name: 'SOUL.md', bytes: 200, kind: 'canonical' }),
        expect.objectContaining({ name: join('skills', 'brand-voice', 'SKILL.md'), bytes: 300, kind: 'skill' }),
        expect.objectContaining({ name: join('memory', '2026-07-01.md'), bytes: 100, kind: 'memory' }),
      ]),
    )
    expect(stats.find((s) => s.name === 'notes.txt')).toBeUndefined()
    expect(stats.every((s) => typeof s.mtimeMs === 'number')).toBe(true)
    // Stats only — the shape must never carry content.
    expect(stats.every((s) => !('content' in s))).toBe(true)
  })

  it('omits canonical files that do not exist on disk', async () => {
    const root = workspace('sparse')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), 'a', 'utf-8')

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const stats = (await runtime.agents.workspaceFileStats?.('sparse')) ?? []

    expect(stats.map((s) => s.name)).toEqual(['AGENTS.md'])
  })

  it('returns null when the agent workspace does not exist', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    expect(await runtime.agents.workspaceFileStats?.('ghost')).toBeNull()
  })
})
