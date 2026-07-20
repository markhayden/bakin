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
  concurrency: { sameAgentTurns: 'serialized' },
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

  it('renders workspace carry, stays-behind lines, and a no-credentials warning', async () => {
    postResponse = {
      ok: true,
      from: 'openclaw',
      to: 'pi',
      backupPath: null,
      roster: {
        carried: [{ agentId: 'pixel', model: 'openai-codex/x', subagentModel: 'openai-codex/x-mini' }],
        existing: [],
        unmappedModels: [{ agentId: 'pixel', sourceModel: 'openai/tiny', field: 'subagentModel' }],
        failed: [],
      },
      workspaces: {
        carried: [{ agentId: 'pixel', files: 3, bytes: 120 }],
        skills: [{ agentId: 'pixel', carried: 1, skippedPackageManaged: 1 }],
        skippedExisting: ['main'],
        failed: [{ agentId: 'pixel', path: 'memory/x.md', error: 'denied' }],
      },
      cantCarry: [
        { concern: 'cron', detail: 'runtime-owned cron jobs stay behind — the target runtime has no cron surface', count: 2 },
        { concern: 'sessions', detail: 'runtime session context resets' },
      ],
      credentials: { llmProviders: [] },
      sync: null,
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
    const out = logLines.join('\n')
    expect(out).toContain('Workspace content: carried 3 file(s) + 1 skill(s) across 1 agent(s)')
    expect(out).toContain('existing on target (workspaces untouched): main')
    expect(out).toContain('✗ pixel memory/x.md: denied')
    expect(out).toContain("subagent model 'openai/tiny' has no equivalent on pi")
    expect(out).toContain('Stays behind:')
    expect(out).toContain('✗ cron (2): runtime-owned cron jobs stay behind')
    expect(out).toContain("'pi' has NO provider credentials")
  })

  it('--dry-run posts dryRun and renders the preview wording, no restart notice', async () => {
    postResponse = {
      ok: true,
      dryRun: true,
      from: 'openclaw',
      to: 'pi',
      backupPath: null,
      roster: { carried: [{ agentId: 'pixel' }], existing: ['main'], unmappedModels: [], failed: [] },
      workspaces: { carried: [{ agentId: 'pixel', files: 2, bytes: 64 }], skills: [], skippedExisting: [], failed: [] },
      cantCarry: [],
      credentials: { llmProviders: ['openai-codex'] },
      sync: null,
      capabilities: CAPABILITIES,
      toolAccess: null,
      restartRequired: false,
    }
    const restore = captureConsole()
    try {
      await run(['runtime', 'use', 'pi', '--dry-run'])
    } finally {
      restore()
    }
    expect(postCalls).toEqual([{ path: '/api/runtime/switch', body: { target: 'pi', dryRun: true } }])
    const out = logLines.join('\n')
    expect(out).toContain("Dry run — previewing a switch to 'pi'")
    expect(out).toContain('Would switch openclaw → pi')
    expect(out).toContain('Roster: would carry 1, existing 1, failed 0')
    expect(out).toContain('Workspace content: would carry 2 file(s)')
    expect(out).toContain('Target credentials: openai-codex')
    expect(out).toContain('Dry run — nothing was changed')
    expect(out).not.toContain('Restart required')
  })

  it('--no-copy-workspaces posts copyWorkspaces: false; flags may precede the target', async () => {
    postResponse = {
      ok: true, from: 'openclaw', to: 'pi', backupPath: null,
      roster: { carried: [], existing: [], unmappedModels: [], failed: [] },
      workspaces: null, cantCarry: null, credentials: null, sync: null,
      capabilities: CAPABILITIES,
      toolAccess: { style: 'in-process', ok: true, issues: [] },
      restartRequired: true,
    }
    const restore = captureConsole()
    try {
      await run(['runtime', 'use', '--no-copy-workspaces', 'pi'])
    } finally {
      restore()
    }
    expect(postCalls).toEqual([{ path: '/api/runtime/switch', body: { target: 'pi', copyWorkspaces: false } }])
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

  it('rejects unknown flags with exit 1 BEFORE posting — a typo like --dryrun must not run a real switch', async () => {
    const restore = captureConsole()
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    try {
      await expect(run(['runtime', 'use', 'pi', '--dryrun'])).rejects.toThrow('exit:1')
      expect(postCalls).toEqual([])
      expect(errLines.join('\n')).toContain('--dryrun')
    } finally {
      exitSpy.mockRestore()
      restore()
    }
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
