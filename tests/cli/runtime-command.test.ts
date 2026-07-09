/**
 * `bakin runtime` / `bakin runtime use <adapter>` (P3.2) — CLI behavior over
 * a mocked HTTP layer: capability report rendering, switch success output
 * (roster carry + unmapped warnings + restart notice), and failure exit.
 */
import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cli-runtime-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

let getResponses: Record<string, unknown> = {}
let postCalls: Array<{ path: string; body: unknown }> = []
let postResponse: unknown = {}

mock.module('../../src/cli/http', () => ({
  apiGet: async (path: string) => getResponses[path],
  apiPost: async (path: string, body?: unknown) => {
    postCalls.push({ path, body })
    return postResponse
  },
  getCliRoster: async () => ({ agentIds: [] }),
}))
mock.module('../../src/cli/output', () => ({ print: () => {} }))

import { run } from '../../src/cli/commands/runtime'

const CAPABILITIES = {
  toolCalling: { mode: 'native', access: { style: 'in-process' } },
  delivery: { mode: 'unavailable' },
  imageGen: { mode: 'native' },
  memory: { mode: 'native' },
  sessions: { mode: 'native' },
  workspaceFiles: { mode: 'native' },
  input: { imageInput: false, audioInput: false },
}

let logLines: string[] = []
let errLines: string[] = []

beforeEach(() => {
  getResponses = {}
  postCalls = []
  postResponse = {}
  logLines = []
  errLines = []
})

function captureConsole() {
  const logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logLines.push(args.join(' ')) })
  const errSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errLines.push(args.join(' ')) })
  return () => { logSpy.mockRestore(); errSpy.mockRestore() }
}

describe('bakin runtime', () => {
  it('prints the capability report', async () => {
    getResponses['/api/runtime/capabilities'] = {
      adapter: 'pi',
      adapters: ['openclaw', 'pi'],
      runtime: { name: 'pi', version: '0.1.0' },
      capabilities: CAPABILITIES,
      toolAccess: { style: 'in-process', ok: true, issues: [] },
    }
    const restore = captureConsole()
    try {
      await run(['runtime'])
    } finally {
      restore()
    }
    const out = logLines.join('\n')
    expect(out).toContain('Active runtime: pi')
    expect(out).toContain('openclaw, pi')
    expect(out).toContain('native (in-process)')
    expect(out).toContain('delivery')
    expect(out).toContain('unavailable')
    expect(out).toContain('Tool access:    ok')
  })
})

describe('bakin runtime use', () => {
  it('prints the switch report with unmapped-model warnings and the restart notice', async () => {
    postResponse = {
      ok: true,
      from: 'openclaw',
      to: 'pi',
      backupPath: '/tmp/backup.json',
      roster: {
        carried: [{ agentId: 'pixel', model: 'openai-codex/x' }],
        existing: ['main'],
        unmappedModels: [{ agentId: 'rolo', sourceModel: 'anthropic/claude-nope' }],
        failed: [],
      },
      sync: { drifted: true, findings: 2, syncedAgents: 3 },
      capabilities: CAPABILITIES,
      toolAccess: { style: 'in-process', ok: true, issues: [] },
      restartRequired: true,
    }
    const restore = captureConsole()
    try {
      await run(['runtime', 'use', 'pi'])
    } finally {
      restore()
    }
    expect(postCalls).toEqual([{ path: '/api/runtime/switch', body: { target: 'pi' } }])
    const out = logLines.join('\n')
    expect(out).toContain('Switched openclaw → pi')
    expect(out).toContain('carried 1, existing 1, failed 0')
    expect(out).toContain("rolo: model 'anthropic/claude-nope' has no equivalent on pi")
    expect(out).toContain('Agents re-projected: 3')
    expect(out).toContain('Restart required')
  })

  it('exits 1 with the restore state on failure', async () => {
    postResponse = {
      ok: false,
      from: 'openclaw',
      to: 'pi',
      error: 'forced failure',
      restored: true,
      backupPath: '/tmp/backup.json',
    }
    const restore = captureConsole()
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    try {
      await expect(run(['runtime', 'use', 'pi'])).rejects.toThrow('exit:1')
    } finally {
      exitSpy.mockRestore()
      restore()
    }
    const err = errLines.join('\n')
    expect(err).toContain('Switch failed: forced failure')
    expect(err).toContain('Previous runtime (openclaw) was restored')
  })

  it('exits 1 on a missing adapter argument', async () => {
    const restore = captureConsole()
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    try {
      await expect(run(['runtime', 'use'])).rejects.toThrow('exit:1')
      expect(postCalls).toEqual([])
    } finally {
      exitSpy.mockRestore()
      restore()
    }
  })
})
