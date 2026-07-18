/**
 * Context-report engine (#357) — per-source startup-context measurement.
 * Static dispatch sections come from the REAL prompt builders (measurement
 * path == production path), dynamic blocks are reported as configured caps,
 * workspace stats arrive via the adapter capability, and observed tokens
 * come from the execution ledger. Names + numbers only — never content.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-context-report-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({
    dispatch: {
      intervalMs: 1000, maxRetries: 3, failureCooldownMs: 1000, transientCooldownMs: 500,
      maxDispatched: 500, oversizedOutputBytes: 128 * 1024, maxConcurrentTurns: 3, maxTurnsPerAgent: 1,
    },
    agentPackages: {
      lessonsRetrieval: { enabled: true, injectIntoDispatch: true, maxLessons: 3, maxCharacters: 8000 },
    },
  }),
}))

import { buildAgentContextReport } from '../../src/core/context-report'
import { recordRunCost } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

type WorkspaceStat = { name: string; bytes: number; mtimeMs: number; kind: 'canonical' | 'skill' | 'memory' }

function fakeRuntime(stats: WorkspaceStat[] | null | 'absent') {
  return {
    agents: {
      ...(stats === 'absent' ? {} : { workspaceFileStats: async () => stats }),
    },
  } as never
}

const DEPS = { contentDir: testDir, mainAgentId: 'main' }

describe('buildAgentContextReport', () => {
  it('measures static dispatch sections via the real builders with chars/4 estimates', async () => {
    const report = await buildAgentContextReport('jessica', { ...DEPS, runtime: fakeRuntime([]) })

    const taskSources = report.dispatch.task.sections.map((s) => s.source)
    expect(taskSources).toEqual(expect.arrayContaining(['output-discipline', 'task-commands', 'shared-tool-docs']))
    const wfSources = report.dispatch.workflow.sections.map((s) => s.source)
    expect(wfSources).toEqual(expect.arrayContaining(['identity', 'hard-constraints', 'commands', 'stop']))

    for (const s of [...report.dispatch.task.sections, ...report.dispatch.workflow.sections]) {
      expect(s.bytes).toBeGreaterThan(0)
      // approxTokens = ceil(chars/4); chars <= bytes (UTF-8, em-dashes are 3 bytes/1 char)
      expect(s.approxTokens).toBeGreaterThan(0)
      expect(s.approxTokens).toBeLessThanOrEqual(Math.ceil(s.bytes / 4))
    }
    expect(report.dispatch.task.totalBytes).toBe(report.dispatch.task.sections.reduce((n, s) => n + s.bytes, 0))
    expect(report.tokenEstimateNote).toContain('approximate')
  })

  it('reports dynamic blocks as configured caps, never fabricated sizes', async () => {
    const report = await buildAgentContextReport('jessica', { ...DEPS, runtime: fakeRuntime([]) })
    expect(report.dispatch.dynamicCaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'lessons', maxBytes: 8000, setting: 'agentPackages.lessonsRetrieval.maxCharacters', appliesTo: 'both' }),
        expect.objectContaining({ source: 'workflow-context', maxBytes: 16384, setting: 'dispatch.maxWorkflowContextBytes', appliesTo: 'workflow' }),
      ]),
    )
    // Workflow-only caps never inflate the TASK dispatch estimate.
    expect(report.dispatch.estimatedMaxTaskBytes).toBe(
      report.dispatch.task.totalBytes +
        report.dispatch.dynamicCaps.filter((c) => c.appliesTo !== 'workflow').reduce((n, c) => n + c.maxBytes, 0),
    )
  })

  it('joins workspace stats with managed-block bytes from the sync receipt', async () => {
    const receiptsDir = join(testDir, 'packages', 'receipts')
    mkdirSync(receiptsDir, { recursive: true })
    writeFileSync(
      join(receiptsDir, 'jessica.json'),
      JSON.stringify({
        agentId: 'jessica', syncedAt: 'x', state: 'managed', checkOnly: false,
        blocks: [{ file: 'AGENTS.md', action: 'recomposed', sections: ['global', 'role:subagent'], bytes: 120 }],
        projections: [], skipped: [], verification: { status: 'ok', findings: [] },
      }),
      'utf-8',
    )
    const report = await buildAgentContextReport('jessica', {
      ...DEPS,
      runtime: fakeRuntime([
        { name: 'AGENTS.md', bytes: 500, mtimeMs: 1, kind: 'canonical' },
        { name: 'skills/voice/SKILL.md', bytes: 300, mtimeMs: 1, kind: 'skill' },
      ]),
    })

    expect(report.workspace.available).toBe(true)
    expect(report.workspace.totalBytes).toBe(800)
    const agentsMd = report.workspace.files.find((f) => f.name === 'AGENTS.md')
    expect(agentsMd).toMatchObject({ bytes: 500, managedBlockBytes: 120 })
    expect(report.workspace.files.find((f) => f.name === 'skills/voice/SKILL.md')?.managedBlockBytes).toBeUndefined()
  })

  it('degrades to unavailable when the runtime lacks the capability or has no workspace', async () => {
    const absent = await buildAgentContextReport('jessica', { ...DEPS, runtime: fakeRuntime('absent') })
    expect(absent.workspace.available).toBe(false)
    expect(absent.workspace.files).toEqual([])

    const missing = await buildAgentContextReport('jessica', { ...DEPS, runtime: fakeRuntime(null) })
    expect(missing.workspace.available).toBe(false)
  })

  it('grounds with observed dispatch-run tokens (cache detail included, non-dispatch excluded)', async () => {
    recordRunCost({ workClass: null,
      runId: 'task:obs1:d1', taskId: 'obs1', agent: 'jessica', model: 'm',
      inputTokens: 9000, outputTokens: 100, totalTokens: 9100,
      cacheReadTokens: 8000, cacheWriteTokens: 500, costUsdMicros: 10, occurredAt: 1_700_000_000_000,
    })
    recordRunCost({ workClass: null, runId: 'turn:obs-watchdog', agent: 'jessica', model: 'm', inputTokens: 50, outputTokens: 5, totalTokens: 55, costUsdMicros: 1, occurredAt: 1_700_000_001_000 })

    const report = await buildAgentContextReport('jessica', { ...DEPS, runtime: fakeRuntime([]) })
    expect(report.observed.label).toContain('observed turn input')
    expect(report.observed.runs).toHaveLength(1)
    expect(report.observed.runs[0]).toMatchObject({ runId: 'task:obs1:d1', inputTokens: 9000, cacheReadTokens: 8000, cacheWriteTokens: 500 })
  })

  it('returns empty observed runs for an agent with no dispatch history', async () => {
    const report = await buildAgentContextReport('fresh-agent', { ...DEPS, runtime: fakeRuntime([]) })
    expect(report.observed.runs).toEqual([])
  })
})
