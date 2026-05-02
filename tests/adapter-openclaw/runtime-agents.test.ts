import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('OpenClaw runtime agents', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-agent-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = testDir
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', workspace: join(testDir, 'workspace') },
        ],
      },
    }), 'utf-8')
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('prunes orphaned conventional agent dirs when OpenClaw reports the agent missing', async () => {
    const fakeOpenClaw = join(testDir, 'openclaw')
    writeFileSync(fakeOpenClaw, '#!/bin/sh\necho "Agent \\"patch\\" not found." >&2\nexit 1\n')
    chmodSync(fakeOpenClaw, 0o755)

    const agentDir = join(testDir, 'agents', 'patch')
    const workspaceDir = join(testDir, 'workspaces', 'patch')
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(join(workspaceDir, 'skills'), { recursive: true })

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: fakeOpenClaw } })

    await expect(runtime.agents.remove('patch')).resolves.toBeUndefined()
    expect(existsSync(agentDir)).toBe(false)
    expect(existsSync(workspaceDir)).toBe(false)
  })

  it('does not prune main agent dirs', async () => {
    const fakeOpenClaw = join(testDir, 'openclaw')
    writeFileSync(fakeOpenClaw, '#!/bin/sh\necho "Agent \\"main\\" not found." >&2\nexit 1\n')
    chmodSync(fakeOpenClaw, 0o755)

    const mainAgentDir = join(testDir, 'agents', 'main')
    const mainWorkspaceDir = join(testDir, 'workspaces', 'main')
    mkdirSync(mainAgentDir, { recursive: true })
    mkdirSync(mainWorkspaceDir, { recursive: true })

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: fakeOpenClaw } })

    await expect(runtime.agents.remove('main')).resolves.toBeUndefined()
    expect(existsSync(mainAgentDir)).toBe(true)
    expect(existsSync(mainWorkspaceDir)).toBe(true)
  })
})
